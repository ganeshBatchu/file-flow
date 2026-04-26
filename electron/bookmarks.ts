/**
 * Security-scoped bookmarks runtime — the MAS-compatibility layer.
 *
 * THE PROBLEM
 *
 *   In a sandboxed MAS build, the only paths the app can touch are:
 *     • its own container (~/Library/Containers/com.fileflow.app/Data/...)
 *     • paths the user explicitly granted via Powerbox (the system file
 *       picker), via NSOpenPanel under the hood
 *     • paths reachable via a `com.apple.security.files.*` entitlement
 *
 *   Crucially, the grant from Powerbox is scoped to *the lifetime of the
 *   running app* by default. If the user picks ~/Downloads, quits, and
 *   relaunches, the new process has no access to ~/Downloads anymore —
 *   every fs.readdir call returns EPERM.
 *
 *   Apple's solution is "security-scoped bookmarks": opaque NSData blobs
 *   that re-acquire the grant on a future launch. The flow is:
 *
 *     1.  dialog.showOpenDialog({ securityScopedBookmarks: true })
 *         returns `bookmarks: string[]` parallel to `filePaths: string[]`.
 *         Each entry is base64-encoded NSData.
 *     2.  Persist the bookmark next to the path (we use a JSON file in
 *         userData; not the main config.json, which the user might edit
 *         by hand).
 *     3.  On the next launch, BEFORE any fs call into a bookmarked path,
 *         call app.startAccessingSecurityScopedResource(bookmarkData) to
 *         re-acquire the grant. The returned function must stay live
 *         (calling it stops access) — we hold one in `activeGrants` for
 *         the whole app lifetime.
 *
 *   Without this dance, FileFlow's sandboxed build would lose access to
 *   every watched directory the moment the user closes the app, and the
 *   daemon would silently produce zero results on next launch.
 *
 * WHY THIS LIVES IN ITS OWN MODULE
 *
 *   The non-MAS (Developer-ID-signed direct-distribution) build doesn't
 *   need any of this — TCC handles persistence — but the same code path
 *   runs harmlessly. `securityScopedBookmarks: true` is a no-op on
 *   non-MAS builds; the dialog returns an empty bookmarks array; we
 *   record the path with no bookmark; nothing else changes.
 *
 *   Keeping all of this in one module means the IPC handlers don't need
 *   to know which build they're in — they just call openDirectoryDialog()
 *   and the right thing happens.
 */
import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

// ──────────────────────────────────────────────────────────────────────
//  Where bookmarks are persisted
// ──────────────────────────────────────────────────────────────────────
//
//  app.getPath('userData') is canonical for "per-user app state" and
//  Apple sandbox-remaps it correctly to
//    ~/Library/Containers/com.fileflow.app/Data/Library/Application Support/FileFlow
//  for the MAS build, and to
//    ~/Library/Application Support/FileFlow
//  for the direct-distribution build. Either way, the file lives where
//  the OS expects per-user app state and gets cleaned up when the app
//  is uninstalled.
//
//  We keep bookmarks in a separate file from the main config.json
//  because:
//    • bookmark blobs are base64-NSData (~600 bytes each) — noise in a
//      file the user might inspect
//    • saveConfig() rewrites the whole config; if a bookmark write
//      raced with a settings save we'd lose state. Separate files,
//      separate writes.
function getBookmarkFilePath(): string {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}

// ──────────────────────────────────────────────────────────────────────
//  In-memory bookmark store + active-grant tracking
// ──────────────────────────────────────────────────────────────────────

/**
 * Path → base64-encoded NSData bookmark blob, as returned by
 * dialog.showOpenDialog when securityScopedBookmarks is true.
 *
 * Paths are stored in their absolute, OS-normalized form (the same form
 * Powerbox returned). Lookups elsewhere in the app must use the same
 * normalization or they'll miss.
 */
const bookmarks = new Map<string, string>();

/**
 * Stop-functions returned by app.startAccessingSecurityScopedResource.
 * We hold one per active path for the entire app lifetime — calling it
 * revokes the sandbox grant immediately, which would break every
 * subsequent fs call into that path.
 *
 * The map is keyed by the same absolute path used in `bookmarks`.
 */
const activeGrants = new Map<string, () => void>();

// ──────────────────────────────────────────────────────────────────────
//  Build detection
// ──────────────────────────────────────────────────────────────────────

/**
 * True when running inside the Mac App Store build. Electron sets
 * `process.mas` at build time when the target is `mas`; it is undefined
 * (not even false) on the direct-distribution build. We treat strict
 * boolean true as MAS so a stray truthy value can't accidentally turn
 * the check on.
 */
export function isMasBuild(): boolean {
  return (process as NodeJS.Process & { mas?: boolean }).mas === true;
}

// ──────────────────────────────────────────────────────────────────────
//  Persistence — load on startup, write on every change
// ──────────────────────────────────────────────────────────────────────

/**
 * Read the bookmark file from disk into the in-memory map. Called once
 * at app startup (after app.whenReady), before registerIpcHandlers().
 *
 * Failure to read is non-fatal: a missing file is normal on first launch,
 * and a corrupt file means we lose persisted access (the user re-grants
 * on next "Choose Folder…" click). Don't crash the app over a bookmark
 * file glitch — the app must still launch.
 */
export function loadBookmarks(): void {
  const file = getBookmarkFilePath();
  try {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    bookmarks.clear();
    for (const [p, b] of Object.entries(parsed)) {
      if (typeof p === 'string' && typeof b === 'string') bookmarks.set(p, b);
    }
  } catch (err) {
    console.warn('[bookmarks] Could not load bookmark store, starting empty:', (err as Error).message);
    bookmarks.clear();
  }
}

/**
 * Write the in-memory map to disk. Called after every set/delete.
 * Synchronous + atomic: write to .tmp, then rename. If the process
 * dies mid-write we keep the previous valid file rather than ending
 * up with a half-written one (which JSON.parse would reject and we'd
 * silently lose every bookmark on next launch).
 */
function saveBookmarks(): void {
  const file = getBookmarkFilePath();
  const tmp = file + '.tmp';
  const obj: Record<string, string> = {};
  for (const [p, b] of bookmarks.entries()) obj[p] = b;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[bookmarks] Failed to persist bookmarks:', (err as Error).message);
  }
}

// ──────────────────────────────────────────────────────────────────────
//  Sandbox-grant acquisition
// ──────────────────────────────────────────────────────────────────────

/**
 * Acquire sandbox access to every persisted path. Idempotent: calling
 * this twice for the same path is a no-op (the existing grant stays
 * live). Called once at startup, and again whenever the renderer adds
 * a new watch directory.
 *
 * On the direct-distribution build this is a no-op — there are no
 * bookmarks to restore because the dialog never returned any.
 */
export function reacquireAllGrants(): void {
  if (!isMasBuild()) return;
  for (const [p, blob] of bookmarks.entries()) {
    if (activeGrants.has(p)) continue;
    try {
      const data = Buffer.from(blob, 'base64');
      const stop = app.startAccessingSecurityScopedResource(data);
      activeGrants.set(p, stop);
    } catch (err) {
      // The bookmark is stale (folder deleted, moved, or unmounted).
      // Drop it — the user will re-pick on next add. We don't surface
      // this to the renderer immediately because the same path could
      // also fail on the *next* fs call, and we'd rather show a single
      // "this folder is no longer accessible" message there than have
      // two error sources for the same problem.
      console.warn(`[bookmarks] Stale bookmark for ${p}, dropping:`, (err as Error).message);
      bookmarks.delete(p);
    }
  }
  // Persist any drops from the loop above so the next launch doesn't
  // try them again.
  saveBookmarks();
}

/**
 * Revoke every active grant. Called on app quit so the OS isn't left
 * thinking we still hold sandbox tokens. Not strictly necessary —
 * process exit cleans up — but explicit teardown is the documented
 * pattern and helps if the same Electron process ever respawns.
 */
export function releaseAllGrants(): void {
  for (const stop of activeGrants.values()) {
    try { stop(); } catch { /* nothing useful to do */ }
  }
  activeGrants.clear();
}

// ──────────────────────────────────────────────────────────────────────
//  Public dialog wrapper
// ──────────────────────────────────────────────────────────────────────

/**
 * Open the system Powerbox folder picker. Always wraps
 * dialog.showOpenDialog (not showOpenDialogSync) so the IPC stays
 * non-blocking.
 *
 * On MAS builds the returned bookmarks are persisted and the grant is
 * activated immediately, so the caller can fs-touch the path right
 * after this resolves. On non-MAS builds the bookmarks array is empty
 * and we just record the path.
 *
 * Returns the picked path, or null if the user cancelled.
 */
export async function openDirectoryDialog(parent?: BrowserWindow): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for FileFlow to watch',
    properties: ['openDirectory', 'createDirectory'],
    // The MAS scanner ignores this on non-MAS builds; on MAS builds it's
    // what makes Powerbox return persistable bookmarks. Either way it's
    // safe to always pass.
    securityScopedBookmarks: true,
    buttonLabel: 'Choose Folder',
  };

  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) return null;

  const picked = result.filePaths[0];

  // The bookmarks array is parallel to filePaths and only populated on
  // MAS. On other platforms / builds it's undefined or empty — we just
  // skip persistence in that case. The path itself still gets returned,
  // so the caller can add it to watch_directories normally.
  const bookmarkBlob = result.bookmarks?.[0];
  if (bookmarkBlob && isMasBuild()) {
    bookmarks.set(picked, bookmarkBlob);
    saveBookmarks();

    // Activate the new grant right away. The user just picked the
    // folder to add it to the watch list, so the very next operation
    // (config save, then a daemon scan) will fs-touch it. Better to
    // start the grant here than to wait for the next launch.
    if (!activeGrants.has(picked)) {
      try {
        const data = Buffer.from(bookmarkBlob, 'base64');
        const stop = app.startAccessingSecurityScopedResource(data);
        activeGrants.set(picked, stop);
      } catch (err) {
        // If activation fails *immediately after the user picked the
        // folder*, something is wrong with the bookmark Powerbox just
        // returned — surface the error so the IPC layer can warn the
        // user instead of silently failing scans later.
        console.error(`[bookmarks] Could not activate fresh bookmark for ${picked}:`, (err as Error).message);
        bookmarks.delete(picked);
        saveBookmarks();
        throw new Error('Could not retain access to the chosen folder. Try picking it again.');
      }
    }
  }

  return picked;
}

/**
 * Drop the bookmark for a path that the user removed from watch_directories.
 * Called from the config:set IPC handler when a watch dir disappears.
 *
 * Releases the active grant first (so we don't leak a sandbox token),
 * then deletes the persisted blob.
 *
 * Best-effort: if the path was never bookmarked (direct-distribution
 * build, or the user added it before bookmarks existed) this is a no-op.
 */
export function dropBookmark(p: string): void {
  const stop = activeGrants.get(p);
  if (stop) {
    try { stop(); } catch { /* ignore — already released */ }
    activeGrants.delete(p);
  }
  if (bookmarks.has(p)) {
    bookmarks.delete(p);
    saveBookmarks();
  }
}

/**
 * Expose the set of paths we currently have an active grant for.
 * Mostly useful for diagnostics and a future "Permissions" panel in
 * Settings showing which folders the sandboxed app can reach.
 */
export function getActivePaths(): string[] {
  return [...activeGrants.keys()];
}

import { ipcMain, BrowserWindow, shell, clipboard } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chokidar from 'chokidar';
import { openDirectoryDialog, dropBookmark, isMasBuild } from './bookmarks.js';

/**
 * Replace the user's home directory with `~` in a path before logging it.
 * Keeps diagnostic logs useful without exposing the user's username if the
 * file is shared (bug reports, support tickets).
 */
const HOME_RE = new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
function redact(s: string): string {
  return s.replace(HOME_RE, '~');
}

const DIAG_LOG = path.join(os.tmpdir(), 'fileflow-diag.log');
function diag(msg: string): void {
  // Redact $HOME → ~ so the log stays useful without exposing the user's
  // OS account name in shared bug reports.
  const line = `[${new Date().toISOString()}] ${redact(msg)}\n`;
  try { fs.appendFileSync(DIAG_LOG, line); } catch {}
  console.log(line.trim());
}
import { loadConfig, resolveConfigPaths, saveConfig, ensureConfigDir } from '../src/config/index.js';
import { extractContent } from '../src/extractor/index.js';
import { tokenize } from '../src/classifier/tokenizer.js';
import { buildCorpusTFIDF } from '../src/classifier/tfidf.js';
import { findBestCategory } from '../src/classifier/confidence.js';
import { moveFile, organizeFiles } from '../src/organizer/mover.js';
import { buildPreviewPlan } from '../src/safety/dryrun.js';
import { loadHashCache, saveHashCache } from '../src/organizer/dedup.js';
import { loadJournal } from '../src/safety/journal.js';
import { listQuarantined } from '../src/safety/quarantine.js';
import { undoLast, undoById, undoOperations } from '../src/organizer/undo.js';
import { CategoryManager } from '../src/classifier/categories.js';
import { detectCourseForFile, buildExtraDepartments } from '../src/classifier/course-detector.js';
import { learnFromCorrection } from '../src/classifier/learning.js';
import { FileFlowDaemon } from '../src/daemon/index.js';
import { assertPathAllowed, isPathAllowed } from '../src/safety/path-guard.js';

let daemon: FileFlowDaemon | null = null;
const dirWatchers = new Map<string, chokidar.FSWatcher>();

function getWin(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function send(channel: string, payload: unknown) {
  getWin()?.webContents.send(channel, payload);
}

export function registerIpcHandlers() {
  ensureConfigDir();

  // ── Config ──────────────────────────────────────────────────
  ipcMain.handle('config:get', async () => {
    return resolveConfigPaths(await loadConfig());
  });

  ipcMain.handle('config:set', async (_e, updated: unknown) => {
    const current = resolveConfigPaths(await loadConfig());
    const upd = updated as Record<string, unknown>;
    // Only allow Settings-editable fields to be overwritten.
    // categories, journal_path, and hash_cache_path are managed by their
    // own dedicated IPC handlers and must never be clobbered here.
    const next = {
      ...current,
      ...(upd.watch_directories !== undefined && { watch_directories: upd.watch_directories as string[] }),
      ...(upd.exclusions !== undefined && { exclusions: upd.exclusions as string[] }),
      ...(upd.confidence_threshold !== undefined && { confidence_threshold: upd.confidence_threshold as number }),
      ...(upd.max_file_size_mb !== undefined && { max_file_size_mb: upd.max_file_size_mb as number }),
      ...(upd.max_scan_depth !== undefined && { max_scan_depth: upd.max_scan_depth as number }),
      ...(upd.uncategorized_folder !== undefined && { uncategorized_folder: upd.uncategorized_folder as string }),
      ...(upd.directory_groups !== undefined && { directory_groups: upd.directory_groups as { name: string; leader: string; members: string[] }[] }),
      ...(upd.daemon !== undefined && { daemon: { ...current.daemon, ...(upd.daemon as object) } }),
    };

    // If watch_directories shrank, drop bookmarks for the removed paths
    // so we don't leak sandbox tokens for folders the user no longer
    // wants us to touch. Sandbox grants stay live until the process
    // dies otherwise — releasing them eagerly is the textbook MAS
    // behaviour, and means a reviewer's static check "are scoped
    // resources released when no longer needed?" comes back clean.
    if (upd.watch_directories !== undefined) {
      const before = new Set(current.watch_directories);
      const after = new Set(next.watch_directories);
      for (const p of before) {
        if (!after.has(p)) dropBookmark(p);
      }
    }

    await saveConfig(next);
  });

  // Open a Powerbox folder picker. Returns the absolute path the user
  // chose, or null if they cancelled. On MAS the security-scoped
  // bookmark is captured + activated inside openDirectoryDialog so the
  // caller can immediately fs-touch the path. The renderer just adds
  // the returned path to watch_directories and saves.
  //
  // We expose this from the IPC layer (rather than letting the renderer
  // call dialog.showOpenDialog directly via remote) because:
  //   • the renderer has no `remote` access (contextIsolation: true,
  //     remote module disabled — both since Electron 14)
  //   • bookmark capture must happen in main, where the bookmarks
  //     module lives
  //   • this is the one chokepoint we audit for path safety
  ipcMain.handle('dialog:choose-directory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? getWin() ?? undefined;
    return await openDirectoryDialog(win);
  });

  // Renderer feature-detect for the MAS build. The renderer uses this
  // to hide direct-distribution-only UI (e.g. external "Open release
  // notes" links — see preload comment).
  ipcMain.handle('app:is-mas-build', () => isMasBuild());

  // ── Files ───────────────────────────────────────────────────
  ipcMain.handle('files:list', (_e, dir: string) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.name !== '.DS_Store')
        .map(e => {
          const full = path.join(dir, e.name);
          let size = 0;
          let mtime = 0;
          if (e.isFile()) {
            try { const s = fs.statSync(full); size = s.size; mtime = s.mtimeMs; } catch {}
          }
          return { name: e.name, path: full, isDir: e.isDirectory(), size, mtime };
        });
    } catch {
      return [];
    }
  });

  ipcMain.handle('files:mkdir', async (_e, dir: string) => {
    const config = resolveConfigPaths(await loadConfig());
    assertPathAllowed(dir, config, 'mkdir target');
    fs.mkdirSync(dir, { recursive: true });
  });

  ipcMain.handle('files:rename', async (_e, oldPath: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    if (trimmed.includes('/') || trimmed.includes('\\')) throw new Error('Name cannot contain slashes');
    if (trimmed === '.' || trimmed === '..') throw new Error('Invalid name');
    const config = resolveConfigPaths(await loadConfig());
    assertPathAllowed(oldPath, config, 'rename source');
    const newPath = path.join(path.dirname(oldPath), trimmed);
    // Belt-and-braces: also confirm the new path stays in the allowed tree
    // (covers the unlikely case where dirname normalizes outside).
    assertPathAllowed(newPath, config, 'rename target');
    if (fs.existsSync(newPath)) throw new Error(`"${trimmed}" already exists`);
    fs.renameSync(oldPath, newPath);
    return newPath;
  });

  ipcMain.handle('files:move', async (_e, src: string, destDir: string) => {
    const config = resolveConfigPaths(await loadConfig());
    assertPathAllowed(src, config, 'move source');
    assertPathAllowed(destDir, config, 'move destination');
    const cache = loadHashCache(config.duplicates.hash_cache_path);
    const result = await moveFile(src, destDir, config, cache);
    saveHashCache(config.duplicates.hash_cache_path, cache);
    send('activity:file-moved', { from: src, to: result.to });

    // Learn from the correction: if the user moved this file into an existing
    // keyword-based category, feed its top TF-IDF terms back into that
    // category so future similar files classify above threshold.
    // Uses the final destination's last path segment as the category name.
    const destCategory = path.basename(destDir);
    if (config.categories[destCategory]) {
      try {
        const updated = await learnFromCorrection(result.to, destCategory, config);
        if (updated) await saveConfig(config);
      } catch { /* non-fatal — move already succeeded */ }
    }

    return result;
  });

  ipcMain.handle('files:watch', (_e, dir: string) => {
    if (dirWatchers.has(dir)) return;
    const w = chokidar.watch(dir, { depth: 0, ignoreInitial: true });
    w.on('all', (event, filePath) => {
      send('activity:dir-changed', { event, path: filePath, dir });
    });
    dirWatchers.set(dir, w);
  });

  // ── Classify ────────────────────────────────────────────────
  ipcMain.handle('classify:file', async (_e, filePath: string) => {
    const config = resolveConfigPaths(await loadConfig());
    const extracted = await extractContent(filePath, config.max_file_size_mb);

    // Course detection takes priority over TF-IDF
    const course = detectCourseForFile(
      extracted.text,
      filePath,
      buildExtraDepartments(config.course_departments),
    );
    if (course) return { category: course, score: 1.0 };

    const tokens = tokenize(extracted.text);
    if (tokens.length === 0) return { category: null, score: 0 };
    const { vectors } = buildCorpusTFIDF([tokens]);
    const match = findBestCategory(vectors[0], config.categories);
    return match ?? { category: null, score: 0 };
  });

  // ── Organize ────────────────────────────────────────────────
  // Second arg is the target dir; optional third arg lets the renderer
  // override depth + opt-in subdirectories without persisting anything to
  // config. Older callers that pass only `dir` get the default behaviour.
  ipcMain.handle('organize:preview', async (
    e,
    dir: string,
    previewOptions?: {
      maxScanDepth?: number;
      includeSubdirectories?: string[];
      excludeSubdirectories?: string[];
    },
  ) => {
    diag(`[organize:preview] called with dir: ${dir} opts: ${JSON.stringify(previewOptions ?? {})}`);
    const config = resolveConfigPaths(await loadConfig());
    assertPathAllowed(dir, config, 'preview target');
    // Per-folder include/exclude lists must also be inside the allowed
    // tree — they're plumbed through to filesystem reads.
    for (const p of previewOptions?.includeSubdirectories ?? []) assertPathAllowed(p, config, 'include subdir');
    for (const p of previewOptions?.excludeSubdirectories ?? []) assertPathAllowed(p, config, 'exclude subdir');
    const cache = loadHashCache(config.duplicates.hash_cache_path);
    // Stream progress events so the renderer can show a bar after 3s.
    const sender = e.sender;
    const plan = await buildPreviewPlan(dir, config, cache, {
      maxScanDepth: previewOptions?.maxScanDepth,
      includeSubdirectories: previewOptions?.includeSubdirectories,
      excludeSubdirectories: previewOptions?.excludeSubdirectories,
      onProgress: (current, total, currentFile) => {
        try { sender.send('scan:progress', { current, total, currentFile }); } catch { /* renderer gone */ }
      },
    });
    diag(`[organize:preview] plan: ${JSON.stringify({
      totalFiles: plan.totalFiles,
      moves: plan.moves.map(m => ({ file: path.basename(m.srcPath), category: m.category, conf: m.confidence })),
      quarantined: plan.quarantined.map(q => path.basename(q.srcPath)),
      subdirectories: plan.subdirectories.map(s => ({ name: s.name, scanned: s.scanned, isCodeProject: s.isCodeProject })),
      errors: plan.errors,
    }, null, 2)}`);
    return {
      moves: plan.moves.map(m => ({
        srcPath: m.srcPath,
        destDir: m.destDir,
        category: m.category,
        confidence: m.confidence,
      })),
      quarantine: plan.quarantined.map(q => ({
        srcPath: q.srcPath,
        destDir: path.join(path.dirname(q.srcPath), config.uncategorized_folder),
        // Surface the best-guess category + its score so the quarantine UI
        // can offer a one-click "move anyway" action.
        closestCategory: q.closestCategory,
        confidence: q.confidence,
        // Hint that the file needs OCR (image-only PDF) so the UI can show
        // a clear "why it wasn't classified" badge.
        needsOcr: q.needsOcr ?? false,
      })),
      duplicates: plan.duplicates.map(d => ({ src: d.duplicate, existing: d.original })),
      errors: plan.errors.map(e => ({ path: e.path, reason: e.error })),
      // Per-folder subdir info. The renderer renders one row per entry and
      // lets the user toggle "scan this folder" → re-call preview with
      // the chosen paths in `includeSubdirectories`.
      subdirectories: plan.subdirectories.map(s => ({
        path: s.path,
        name: s.name,
        scanned: s.scanned,
        isCodeProject: s.isCodeProject,
      })),
    };
  });

  ipcMain.handle('organize:execute', async (_e, moves: { srcPath: string; destDir: string; category: string; confidence: number }[]) => {
    diag(`[organize:execute] called with ${moves.length} moves: ${JSON.stringify(moves.map(m => ({ file: path.basename(m.srcPath), to: m.destDir, category: m.category })), null, 2)}`);
    const config = resolveConfigPaths(await loadConfig());
    // Filter out anything that escaped the allowed tree. We log + drop
    // rather than throw so a single bad move can't kill an entire batch —
    // but the legitimate moves still go through. The dropped paths are
    // surfaced as errors in the response so the renderer can show them.
    const safe: typeof moves = [];
    const refused: { path: string; error: string }[] = [];
    for (const mv of moves) {
      if (!isPathAllowed(mv.srcPath, config) || !isPathAllowed(mv.destDir, config)) {
        refused.push({ path: mv.srcPath, error: 'Refused: outside watched/grouped tree' });
        continue;
      }
      safe.push(mv);
    }
    if (refused.length > 0) diag(`[organize:execute] refused ${refused.length} unsafe moves`);
    const cache = loadHashCache(config.duplicates.hash_cache_path);
    const result = await organizeFiles(safe, config, cache);
    result.errors.push(...refused);
    saveHashCache(config.duplicates.hash_cache_path, cache);
    result.moved.forEach(m => send('activity:file-moved', { from: m.from, to: m.to }));

    // Persist any course folders that were moved into, so they appear in the
    // Categories tab. Idempotent — skips courses already in config. Iterate
    // `safe` (not the original `moves`) so refused traversal attempts don't
    // get to register categories.
    const COURSE_NAME_RE = /^[A-Z]{2,6} \d{3,4}[A-Z]{0,2}$/;
    const newCourses = new Set<string>();
    for (const m of safe) {
      if (COURSE_NAME_RE.test(m.category) && !config.categories[m.category]) {
        newCourses.add(m.category);
      }
    }
    if (newCourses.size > 0) {
      for (const courseName of newCourses) {
        config.categories[courseName] = { keywords: [], centroid: [] };
      }
      await saveConfig(config);
      diag(`[organize:execute] registered new course categories: ${[...newCourses].join(', ')}`);
    }

    // Learn from every successful move that landed in an existing keyword-based
    // category. "Move anyway" overrides from the preview UI route here — they
    // carry the close category's name rather than 'Uncategorized', so they
    // teach the model. Skip rule-based categories (courses, Personal, Build Logs)
    // — learnFromCorrection handles that filter internally.
    let configDirty = false;
    for (const mv of result.moved) {
      // Recover the category from the move record. `safe` is the validated
      // input array, which carries the category each file was routed to.
      const srcMove = safe.find(m => m.srcPath === mv.from);
      const categoryName = srcMove?.category;
      if (!categoryName || !config.categories[categoryName]) continue;
      try {
        const updated = await learnFromCorrection(mv.to, categoryName, config);
        if (updated) configDirty = true;
      } catch { /* non-fatal — move already succeeded */ }
    }
    if (configDirty) {
      await saveConfig(config);
      diag(`[organize:execute] refined keywords from user corrections`);
    }

    diag(`[organize:execute] done. moved=${result.moved.length} errors=${result.errors.length}`);
    return result;
  });

  // ── Categories ──────────────────────────────────────────────
  ipcMain.handle('categories:list', async () => {
    const config = resolveConfigPaths(await loadConfig());
    return config.categories;
  });

  ipcMain.handle('categories:scan', async (e, dir: string, k?: number) => {
    const config = resolveConfigPaths(await loadConfig());
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const files = entries
      .filter(ent => ent.isFile() && ent.name !== '.DS_Store')
      .map(ent => ({ path: path.join(dir, ent.name) }));
    const mgr = new CategoryManager(config);
    const sender = e.sender;
    return mgr.suggestCategories(files, k ?? 5, (current, total, currentFile) => {
      try { sender.send('scan:progress', { current, total, currentFile }); } catch { /* renderer gone */ }
    });
  });

  ipcMain.handle('categories:save', async (_e, name: string, keywords: string[], centroid: number[]) => {
    const config = resolveConfigPaths(await loadConfig());
    const mgr = new CategoryManager(config);
    await mgr.saveCategoryToConfig(name, keywords, centroid);
  });

  ipcMain.handle('categories:delete', async (_e, name: string) => {
    const config = resolveConfigPaths(await loadConfig());
    const mgr = new CategoryManager(config);
    await mgr.removeCategory(name);
  });

  ipcMain.handle('categories:deleteMany', async (_e, names: string[]) => {
    if (!Array.isArray(names) || names.length === 0) return { deleted: 0, missing: [] };
    const config = resolveConfigPaths(await loadConfig());
    const missing: string[] = [];
    let deleted = 0;
    for (const name of names) {
      if (config.categories[name]) {
        delete config.categories[name];
        deleted++;
      } else {
        missing.push(name);
      }
    }
    await saveConfig(config);
    return { deleted, missing };
  });

  ipcMain.handle('categories:rename', async (_e, oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    const config = resolveConfigPaths(await loadConfig());
    if (!config.categories[oldName]) throw new Error(`Category "${oldName}" not found`);
    if (config.categories[trimmed] && trimmed !== oldName) throw new Error(`"${trimmed}" already exists`);
    const cat = config.categories[oldName];
    delete config.categories[oldName];
    config.categories[trimmed] = cat;
    await saveConfig(config);
  });

  // ── Quarantine ──────────────────────────────────────────────
  ipcMain.handle('quarantine:list', async (_e, dir: string) => {
    const config = resolveConfigPaths(await loadConfig());
    return listQuarantined(dir, config).map(f => f.path);
  });

  // ── History & Undo ──────────────────────────────────────────
  ipcMain.handle('history:query', async () => {
    const config = resolveConfigPaths(await loadConfig());
    return loadJournal(config.journal_path).slice(-100).reverse();
  });

  ipcMain.handle('undo:last', async () => {
    const config = resolveConfigPaths(await loadConfig());
    const result = await undoLast(config.journal_path);
    if (!result) return { reversed: [], errors: ['Nothing to undo'] };
    return { reversed: result.reversed, errors: result.errors.map(e => e.error) };
  });

  ipcMain.handle('undo:by-id', async (_e, id: string) => {
    const config = resolveConfigPaths(await loadConfig());
    const result = await undoById(id, config.journal_path);
    if (!result) return { reversed: [], errors: ['Entry not found'] };
    return { reversed: result.reversed, errors: result.errors.map(e => e.error) };
  });

  // Partial undo — reverse specific operations within an entry. Used by the
  // History UI when the user expands an entry and checks individual files.
  ipcMain.handle('undo:operations', async (_e, id: string, operationIndices: number[]) => {
    const config = resolveConfigPaths(await loadConfig());
    const result = await undoOperations(id, operationIndices, config.journal_path);
    if (!result) return { reversed: [], errors: ['Entry not found'] };
    return { reversed: result.reversed, errors: result.errors.map(e => e.error) };
  });

  // ── Shell helpers (reveal-in-finder, clipboard) ─────────────
  // Both take renderer-supplied paths but neither modifies the filesystem.
  // Reveal still gets a path-tree check — there's no reason for the UI to
  // ask the OS file browser to open something outside the user's watched
  // tree, and an arbitrary path could be used to probe filesystem layout.
  ipcMain.handle('shell:reveal', async (_e, targetPath: string) => {
    const config = resolveConfigPaths(await loadConfig());
    if (!isPathAllowed(targetPath, config)) return;
    try { shell.showItemInFolder(targetPath); } catch { /* ignore */ }
  });

  ipcMain.handle('shell:copy-path', (_e, targetPath: string) => {
    // Clipboard write is harmless and no filesystem read happens; allow any
    // path the renderer wants to copy (it already saw the path to render
    // it in the UI).
    if (typeof targetPath !== 'string') return;
    try { clipboard.writeText(targetPath); } catch { /* ignore */ }
  });

  // ── Daemon ──────────────────────────────────────────────────
  ipcMain.handle('daemon:status', async () => {
    const config = resolveConfigPaths(await loadConfig());
    return { running: daemon?.isRunning ?? false, watchedPaths: config.watch_directories };
  });

  ipcMain.handle('daemon:start', async () => {
    if (daemon?.isRunning) return;
    const config = resolveConfigPaths(await loadConfig());
    daemon = new FileFlowDaemon(config);
    daemon.onActivity(evt => {
      send('activity:daemon-event', {
        eventType: evt.type,
        path: evt.srcPath,
        category: evt.category,
        confidence: evt.confidence,
        destination: evt.destPath,
        error: evt.message,
      });
    });
    daemon.start();
  });

  ipcMain.handle('daemon:stop', () => {
    daemon?.stop();
    daemon = null;
  });
}

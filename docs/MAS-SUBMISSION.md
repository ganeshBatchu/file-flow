# Mac App Store submission guide

End-to-end runbook for shipping FileFlow on the Mac App Store.

This is the doc to read before running `npm run dist:mas` for real. The
code-side wiring (entitlements, privacy manifest, security-scoped
bookmarks, sandbox-compatible folder picker) is already done; what
remains is one-time Apple Developer setup, two certificates, an icon
upgrade, and the submission steps themselves.

---

## TL;DR — what you'll need

- **Apple Developer Program** membership ($99/year). The personal/free
  Apple ID is not enough; submission requires a paid account.
- **Two macOS signing certificates** in your login keychain:
  1. `3rd Party Mac Developer Application` — signs the .app bundle
     for the MAS target.
  2. `3rd Party Mac Developer Installer` — signs the .pkg wrapper
     that App Store Connect ingests.
  3. (For the direct-distribution .dmg you also need
     `Developer ID Application` and `Developer ID Installer`. Optional
     for the App Store path.)
- **An App Store Connect record** for `com.fileflow.app` with bundle
  ID, SKU, and SKU group.
- **A provisioning profile** (`embedded.provisionprofile`) generated
  from App Store Connect, dropped at `build/embedded.provisionprofile`
  before invoking electron-builder.
- **A 1024×1024 icon** at `resources/icon.png`. The current placeholder
  is 16×16 and will fail electron-builder's icon converter — see
  "Known blockers" below.

---

## What's already done in the codebase

- `electron-builder.yml` — adds the `mas` target, bundles
  `resources/**/*` (which carries the privacy manifest and entitlement
  files), and points at the universal arch so one .pkg covers both
  Apple Silicon and Intel.
- `resources/entitlements.mas.plist` — minimal sandboxed entitlements
  (sandbox + user-selected files + bookmarks + JIT for V8). Each key
  is commented with the reason; what's deliberately omitted is also
  called out.
- `resources/entitlements.mas.inherit.plist` — strictly smaller set for
  helper processes (renderer, GPU, plugin). Reviewers flag any helper
  with broader entitlements than it needs.
- `resources/entitlements.mac.plist` — direct-distribution variant.
  Adds `disable-library-validation` (for the unsigned ffmpeg dylib
  Electron loads) and the same user-selected/bookmarks pair as MAS so
  the same renderer/main code path works in both builds.
- `resources/PrivacyInfo.xcprivacy` — required-reason API declarations
  for FileTimestamp (we call `fs.statSync().mtime`), SystemBootTime,
  DiskSpace, and UserDefaults (Electron internals). Empty
  `NSPrivacyTracking` and `NSPrivacyCollectedDataTypes` arrays are
  present as explicit "we collect nothing" declarations.
- `electron/bookmarks.ts` — security-scoped-bookmarks runtime: captures
  bookmark blobs from `dialog.showOpenDialog`, persists them in
  `userData/bookmarks.json`, reacquires sandbox grants at app launch.
  All callers go through `openDirectoryDialog()`; no IPC handler calls
  `dialog.showOpenDialog` directly.
- `electron/main.ts` — calls `loadBookmarks()` + `reacquireAllGrants()`
  in `app.whenReady` before any IPC handler runs, and
  `releaseAllGrants()` on `before-quit`. Also denies external links on
  MAS (the network-client entitlement isn't shipped) and refuses
  in-page navigation to anything beyond `file://` and the dev server.
- `electron/ipc-handlers.ts` — exposes `dialog:choose-directory` (the
  Powerbox wrapper) and `app:is-mas-build` (renderer feature flag).
  When watch directories shrink in `config:set`, dropped paths get
  `dropBookmark()` called so we don't leak sandbox tokens.
- `gui/src/pages/Settings.tsx` — "Choose Folder…" button replaces the
  free-form text input. Hand-typing a path can't grant the sandbox a
  bookmark, so editing in place would silently fail every fs call;
  the new flow forces Trash + re-pick to change a watched directory.
- `scripts/notarize.ts` — afterSign hook for the .dmg build. Submits
  to Apple's notary service when `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set; skips
  silently otherwise (so local smoke builds don't fail). Skips the MAS
  bundle entirely (App Store handles its own scan).
- `package.json` — three new scripts: `dist:dmg`, `dist:mas`,
  `dist:mac` (both). The catch-all `dist` script still works.
- `@electron/notarize` is added as a devDependency.

---

## One-time Apple Developer setup

These steps happen once per developer account. Skip if you already
have a working signing setup.

### 1. Create the App Store Connect record

1. Sign in to <https://appstoreconnect.apple.com>.
2. **My Apps → +  → New App**.
3. Fill in:
   - **Platform**: macOS
   - **Name**: FileFlow
   - **Primary language**: English
   - **Bundle ID**: `com.fileflow.app` (must match `appId` in
     electron-builder.yml — if it doesn't, submission fails with
     "bundle identifier doesn't match").
   - **SKU**: anything unique to your account, e.g. `FILEFLOW001`.
4. Save. App Store Connect now knows the app exists; you'll fill in
   metadata (screenshots, description, pricing) before submission.

### 2. Generate the certificates

Easiest path is from Xcode:

1. Open Xcode → Settings → Accounts → your Apple ID → Manage
   Certificates.
2. Click `+` and create:
   - `Apple Distribution` (covers both 3rd Party Mac Developer
     Application and Developer ID Application — Xcode auto-splits).
   - Or generate the four individual ones from
     <https://developer.apple.com/account/resources/certificates/list>:
     * `Mac App Distribution`
     * `Mac Installer Distribution`
     * `Developer ID Application`
     * `Developer ID Installer`
3. Each certificate downloads as a .cer file. Double-click to import
   into the login keychain. electron-builder picks them up
   automatically by Common Name.

Verify:

```bash
security find-identity -v -p codesigning
```

Should list both `3rd Party Mac Developer Application: <name> (<team>)`
and `Developer ID Application: <name> (<team>)`.

### 3. Generate the provisioning profile

1. <https://developer.apple.com/account/resources/profiles/list>
2. **+ → Mac App Store Connect → Mac App Store** distribution profile.
3. App ID: `com.fileflow.app`. Certificate: the Mac App Distribution
   one you generated above.
4. Download the .provisionprofile and save as
   `build/embedded.provisionprofile` in the repo.
   electron-builder will pick it up because that's the path declared
   in `electron-builder.yml > mas.provisioningProfile`.
5. Don't commit the file — add `build/*.provisionprofile` to
   `.gitignore` if it isn't already.

### 4. Generate the app-specific password (for notarization)

The .dmg notarization step needs this; skip if you only ship via MAS.

1. <https://appleid.apple.com/account/manage> → Sign-In and
   Security → App-Specific Passwords.
2. **+** → label it `FileFlow Notarization`.
3. Save the generated password somewhere secure (e.g. 1Password). It
   only displays once.

---

## Build commands

```bash
# DMG only (direct distribution, notarized if APPLE_ID env vars set)
npm run dist:dmg

# MAS only (.pkg, ready for App Store ingestion)
npm run dist:mas

# Both
npm run dist:mac
```

For MAS builds the env vars are not needed — Apple's installer cert
in the keychain plus the provisioning profile in `build/` is the
complete input. For DMG builds:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABC1234567"
npm run dist:dmg
```

Output lands in `release/` (configured by `directories.output` in
electron-builder.yml).

---

## Submitting to App Store Connect

After `npm run dist:mas` finishes you'll have something like
`release/mac-universal/FileFlow-1.0.0-universal.pkg`.

1. Open **Transporter** (download free from Mac App Store if not
   installed).
2. Sign in with your Apple ID.
3. Drag the .pkg into the window and click **Deliver**.
4. The upload runs Apple's static scanner — this is where
   `ITMS-91053: Missing API declaration` warnings show up if the
   privacy manifest is incomplete. Fix any issues, rebuild, retry.
5. Once the upload succeeds, the build appears in App Store Connect
   under **My Apps → FileFlow → TestFlight** (or **App Store** if you
   skip TestFlight).
6. Add metadata (screenshots, description, keywords, category, age
   rating, support URL, privacy policy URL).
7. Click **Submit for Review**.

Review typically takes 1–2 days. Common rejection reasons for an
Electron app:

- **Hardened runtime missing on a helper binary** — fixed by
  electron-builder when you set `hardenedRuntime: true` in the
  `mac` block (we have this).
- **Sandbox violation** — the app tried to read a file it didn't have
  a bookmark for. Always go through `dialog:choose-directory`.
- **Library validation disabled** — only acceptable in the direct-
  distribution build; never for MAS. Our entitlements.mas.plist
  correctly omits this key.
- **Privacy manifest missing API declaration** — add the missing
  category to PrivacyInfo.xcprivacy.

---

## Known blockers (not yet fixed)

These are pre-existing issues not related to the MAS wiring; they
need to be addressed before the first real submission.

### Icon is 16×16

`resources/icon.png` is currently a 185-byte 16×16 placeholder. App
Store ingestion requires a 1024×1024 master that gets downscaled to
the various .icns sizes electron-builder generates internally.
electron-builder's app-builder helper currently chokes on the tiny
file ("flate: corrupt input before offset 13") regardless of MAS —
the .dmg build is also stuck behind it.

**Fix**: produce a 1024×1024 master PNG (transparent background, with
~80px of padding inside the canvas — Apple HIG recommends the icon
fills ~85% of the square). Replace `resources/icon.png`. The same
master file feeds both the .dmg and .pkg outputs.

### Author missing from package.json

electron-builder warned `author is missed in the package.json`. Not a
hard failure but App Store metadata expects a clear publisher name.
Add an `author` field to `package.json`:

```json
"author": {
  "name": "Your Name",
  "email": "you@example.com"
}
```

### Stale `build` field in package.json

`package.json` has a leftover `build` block that predates the
`electron-builder.yml`. electron-builder loads the YAML when present
and ignores the package.json field, but the duplicate is misleading.
Recommend deleting the `build` field once the YAML is validated to
have feature parity.

---

## Privacy policy URL

App Store Connect requires a public URL pointing at a privacy policy.
Our policy is short:

> FileFlow runs entirely on your device. It does not collect any
> personal data, does not transmit any data to remote servers, does
> not perform analytics or tracking, and does not contain any
> third-party SDKs. The only data it touches is the files in the
> directories you explicitly grant it access to via the system folder
> picker; it reorganizes those files according to rules you configure.

Host this on a personal site, GitHub Pages, or any plain HTML page;
paste the URL into App Store Connect → App Information → Privacy
Policy URL.

---

## Smoke test before submission

Run through this checklist on a clean macOS account (or a VM) to
catch sandbox violations before Apple does:

1. Install the .pkg from `release/mac-universal/`.
2. First launch — Settings should be empty; click **Choose Folder…**
   and pick `~/Documents`. Confirm a Powerbox dialog appears.
3. Click **Save Settings**. Quit the app.
4. Relaunch — confirm `~/Documents` is still in the watch list
   AND that running **Organize Now** successfully reads its
   contents. If reads fail with EPERM, the bookmark wasn't
   reacquired — check `~/Library/Containers/com.fileflow.app/Data/Library/Application Support/FileFlow/bookmarks.json`.
5. Add a second folder via Choose Folder, then remove the first.
   Quit + relaunch. Confirm the removed folder is no longer
   accessible (no zombie grant).
6. Try every menu item, every page transition, every settings field.
   Watch Console.app filtered to "FileFlow" for any
   `sandboxd: violation` messages.

If all six pass, the submission is good to upload.

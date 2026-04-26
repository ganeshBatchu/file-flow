import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createTray, destroyTray } from './tray.js';
import {
  loadBookmarks,
  reacquireAllGrants,
  releaseAllGrants,
  isMasBuild,
} from './bookmarks.js';

let mainWindow: BrowserWindow | null = null;
let daemonRunning = false;

// Track daemon state for tray
ipcMain.on('__daemon-state', (_e, running: boolean) => {
  daemonRunning = running;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#030712', // gray-950
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load renderer. DevTools are NOT auto-opened — they pop up over the
  // window and steal focus on every launch. Use Cmd-Option-I (or
  // Ctrl-Shift-I on Win/Linux) when you actually want them. Setting
  // FILEFLOW_DEVTOOLS=1 in the environment opts back in for debugging
  // a launch-time issue.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    if (process.env['FILEFLOW_DEVTOOLS'] === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open external links in browser, not Electron — but ONLY on the
  // direct-distribution build. The Mac App Store sandbox refuses
  // shell.openExternal calls without an explicit `com.apple.security.network.client`
  // entitlement, which we don't ship (FileFlow has no online features
  // and asking for the network entitlement would force a privacy review
  // for no real reason). On MAS we just deny the popup with no fallback;
  // the renderer is already CSP-locked to no remote origins so this only
  // bites on a stray `<a target="_blank">` someone added without thinking.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isMasBuild()) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Hard-deny in-page navigation to anything other than our bundled
  // file:// renderer or the dev server. Belt-and-braces against a stray
  // <a href="https://..."> that would otherwise replace the renderer
  // contents with a remote page (and on MAS would silently fail to load
  // anyway, leaving a blank window).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowedPrefixes = ['file://', 'http://localhost:', 'http://127.0.0.1:'];
    if (!allowedPrefixes.some((prefix) => url.startsWith(prefix))) {
      e.preventDefault();
    }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

app.whenReady().then(() => {
  // Bookmarks must be loaded + grants reacquired BEFORE registerIpcHandlers,
  // because the very first IPC call from the renderer (config:get) feeds
  // watch_directories into a daemon scan that fs.readdir's into them.
  // Without an active grant the read returns EPERM and the daemon
  // appears broken on every relaunch of the MAS build.
  //
  // On the direct-distribution build both calls are cheap no-ops —
  // the bookmark file is empty, isMasBuild() returns false, and
  // reacquireAllGrants short-circuits.
  loadBookmarks();
  reacquireAllGrants();

  registerIpcHandlers();
  createWindow();

  if (mainWindow) {
    const { update: updateTray } = createTray(
      mainWindow,
      () => daemonRunning,
      () => {
        // Toggle daemon via IPC from main side
        if (daemonRunning) {
          ipcMain.emit('daemon:stop-internal');
        } else {
          ipcMain.emit('daemon:start-internal');
        }
        mainWindow?.webContents.send('tray:toggle-daemon');
      },
    );

    // Update tray whenever daemon state changes
    mainWindow.webContents.on('did-finish-load', () => updateTray());
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('before-quit', () => {
  (app as typeof app & { isQuitting: boolean }).isQuitting = true;
  destroyTray();
  // Drop sandbox grants explicitly. Process exit cleans them up too,
  // but the MAS guidelines say to release scoped resources when no
  // longer needed, and explicit teardown also helps the singleton
  // case where Electron sometimes restarts the same app instance.
  releaseAllGrants();
});

app.on('window-all-closed', () => {
  // On macOS keep app alive in tray; on Windows/Linux quit
  if (process.platform !== 'darwin') app.quit();
});

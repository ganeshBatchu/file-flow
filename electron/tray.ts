import { Tray, Menu, app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;

export function createTray(win: BrowserWindow, isDaemonRunning: () => boolean, toggleDaemon: () => void) {
  // Use a default empty icon if resources aren't present yet
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('FileFlow');

  const update = () => {
    const running = isDaemonRunning();
    const menu = Menu.buildFromTemplate([
      { label: 'FileFlow', enabled: false },
      { type: 'separator' },
      {
        label: running ? '● Daemon Running' : '○ Daemon Stopped',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => {
          win.show();
          win.focus();
        },
      },
      {
        label: running ? 'Stop Daemon' : 'Start Daemon',
        click: toggleDaemon,
      },
      { type: 'separator' },
      {
        label: 'Quit FileFlow',
        click: () => app.quit(),
      },
    ]);
    tray!.setContextMenu(menu);
  };

  update();
  tray.on('click', () => {
    win.show();
    win.focus();
  });

  return { update };
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}

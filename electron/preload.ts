import { contextBridge, ipcRenderer } from 'electron';

// Expose a typed, safe bridge — no direct ipcRenderer access in renderer
contextBridge.exposeInMainWorld('fileflow', {
  invoke: <T>(channel: string, ...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    // Return cleanup fn
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  off: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.removeAllListeners(channel);
  },
});

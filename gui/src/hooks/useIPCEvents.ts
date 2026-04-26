import { useEffect, useRef } from 'react';
import { ipcEvents } from '../api.ts';

type IPCMessage = Record<string, unknown>;

const CHANNELS = [
  'activity:file-moved',
  'activity:daemon-event',
  'activity:dir-changed',
  'tray:toggle-daemon',
];

/**
 * Subscribe to all FileFlow IPC activity channels.
 * Replaces the WebSocket hook used in the web version.
 */
export function useIPCEvents(onMessage: (channel: string, msg: IPCMessage) => void) {
  const onMsg = useRef(onMessage);
  onMsg.current = onMessage;

  useEffect(() => {
    const cleanups = CHANNELS.map(channel =>
      ipcEvents.on(channel, (...args: unknown[]) => {
        const payload = (args[0] ?? {}) as IPCMessage;
        onMsg.current(channel, { ...payload, _channel: channel });
      }),
    );
    return () => cleanups.forEach(fn => fn?.());
  }, []);
}

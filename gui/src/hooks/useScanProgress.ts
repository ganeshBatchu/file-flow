import { useEffect, useState } from 'react';
import { ipcEvents } from '../api.ts';

export interface ScanProgress {
  current: number;
  total: number;
  currentFile: string;
}

/**
 * Subscribes to `scan:progress` IPC events and exposes them only after the
 * scan has been running for `delayMs` (default 3s) — short scans don't flash
 * a progress bar.
 *
 * @param scanning  Pass true while the RPC is in flight; flip to false when done.
 * @param delayMs   How long the scan must run before the bar becomes visible.
 */
export function useScanProgress(scanning: boolean, delayMs: number = 3000) {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [visible, setVisible] = useState(false);

  // Always subscribed — cheap, single-channel listener.
  useEffect(() => {
    const off = ipcEvents.on('scan:progress', (...args) => {
      const p = (args[0] ?? {}) as Partial<ScanProgress>;
      if (typeof p.current === 'number' && typeof p.total === 'number') {
        setProgress({
          current: p.current,
          total: p.total,
          currentFile: p.currentFile ?? '',
        });
      }
    });
    return () => { off?.(); };
  }, []);

  // 3-second visibility delay — keyed off the `scanning` flag.
  useEffect(() => {
    if (!scanning) {
      setVisible(false);
      setProgress(null);
      return;
    }
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [scanning, delayMs]);

  return { visible, progress };
}

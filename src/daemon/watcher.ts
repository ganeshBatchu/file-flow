import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import { isExcluded } from '../config/exclusions.js';
import { FileDebouncer } from './debouncer.js';
import type { FileFlowConfig } from '../config/schema.js';

export type FileEvent = {
  type: 'add' | 'change' | 'unlink';
  path: string;
};

export type WatcherEventHandler = (event: FileEvent) => void;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debouncer: FileDebouncer;
  private config: FileFlowConfig;
  private handler: WatcherEventHandler;
  private filesSeen = 0;

  constructor(config: FileFlowConfig, handler: WatcherEventHandler) {
    this.config = config;
    this.handler = handler;
    this.debouncer = new FileDebouncer(
      config.daemon.debounce_seconds,
      (filePath) => {
        this.filesSeen++;
        this.handler({ type: 'add', path: filePath });
      },
    );
  }

  /**
   * Start watching all configured directories.
   */
  start(): void {
    if (this.watcher) return;

    const watchPaths = this.config.watch_directories;

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      // Watch ONLY the top level of each watch directory. Files already
      // inside a subdirectory (like Documents/, software_engineer/, …)
      // are presumed organized — those subfolders are typically the
      // category folders the daemon itself created, and touching files
      // there races the user's own moves. Concretely: dragging a file
      // out of `Downloads/software_engineer/` via Finder briefly emits
      // `change` events on the source path; with recursive watching the
      // 2-second debouncer would fire before the move completed and
      // quarantine the half-moved file. depth:0 makes the daemon's
      // surface match the Organize Now preview's "top-level only by
      // default" semantics.
      depth: 0,
      // Let the OS signal that a write is finished before we react. The
      // previous code disabled this in favour of our 2s debouncer, but
      // the debouncer can't tell "user is dragging this file" from
      // "browser is finishing a download" — it just waits a fixed
      // amount of time. awaitWriteFinish polls until the file size has
      // been stable for the threshold, which is the correct signal.
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
      ignored: (filePath: string) => {
        const base = path.basename(filePath);
        // Always ignore hidden system files
        if (base.startsWith('.DS_Store') || base.startsWith('Thumbs.db')) return true;
        return false;
      },
    });

    // We deliberately listen only to `add`, not `change`. A `change`
    // event on a top-level file means the file was modified in place —
    // the user clearly wants it where it is. Reacting to `change` is
    // what makes the daemon race manual edits / moves. With
    // awaitWriteFinish above, `add` is held back until the file is
    // fully written, so we don't lose new downloads either.
    this.watcher.on('add', (filePath) => {
      if (this.shouldProcess(filePath)) {
        this.debouncer.schedule(filePath);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      this.debouncer.cancel(filePath);
      this.handler({ type: 'unlink', path: filePath });
    });

    this.watcher.on('error', (err) => {
      console.error('[FileWatcher] Error:', err);
    });
  }

  /**
   * Stop watching and cancel all pending debounced events.
   */
  stop(): void {
    this.debouncer.cancelAll();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  get isRunning(): boolean {
    return this.watcher !== null;
  }

  get totalFilesSeen(): number {
    return this.filesSeen;
  }

  /**
   * Update config (e.g. after settings change) and restart watcher.
   */
  updateConfig(config: FileFlowConfig): void {
    this.config = config;
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  private shouldProcess(filePath: string): boolean {
    // Find the base watch directory for exclusion matching
    const baseDir = this.config.watch_directories.find((d) =>
      filePath.startsWith(d),
    ) ?? this.config.watch_directories[0];

    // Defence in depth: even though chokidar is configured with depth:0,
    // some platforms emit transient events for files in nested folders
    // during a recursive scan or rename. Drop anything that isn't a
    // direct child of a watch directory.
    if (path.dirname(filePath) !== baseDir) return false;

    // Skip files inside the quarantine folder
    const uncatDir = path.join(baseDir, this.config.uncategorized_folder);
    if (filePath.startsWith(uncatDir)) return false;

    // Skip excluded patterns
    if (isExcluded(filePath, this.config.exclusions, baseDir)) return false;

    return true;
  }
}

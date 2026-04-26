// All calls go through the contextBridge — no fetch, no network
const ff = () => (window as Window & { fileflow: FileflowBridge }).fileflow;

interface FileflowBridge {
  invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>;
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
  off: (channel: string, listener: (...args: unknown[]) => void) => void;
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ff().invoke<T>(channel, ...args);

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface CategoryConfig {
  keywords: string[];
  centroid: number[];
}

export interface PlannedMove {
  srcPath: string;
  destDir: string;
  category: string;
  confidence: number;
}

export interface QuarantineItem {
  srcPath: string;
  destDir: string;
  /** The best-guess existing category (below confidence threshold). */
  closestCategory?: string | null;
  /** Score of that guess — rendered as a hint so the user can decide. */
  confidence?: number;
  /** True if the file looks like an image-only PDF that needs OCR. */
  needsOcr?: boolean;
}

export interface SubdirectoryInfo {
  path: string;
  name: string;
  /** Whether this subdir's contents were scanned in the current preview. */
  scanned: boolean;
  /** True if the subdir looks like a code-project root (.git, package.json, …). */
  isCodeProject: boolean;
}

export interface DryRunPlan {
  moves: PlannedMove[];
  quarantine: QuarantineItem[];
  duplicates: { src: string; existing: string }[];
  errors: { path: string; reason: string }[];
  /**
   * Immediate subdirectories of the scanned dir, with metadata for the UI's
   * per-folder opt-in toggles. Empty until the IPC bridge populates it.
   */
  subdirectories: SubdirectoryInfo[];
}

export interface PreviewOptions {
  /** Override config.max_scan_depth for this preview only. */
  maxScanDepth?: number;
  /** Per-folder opt-in: subdirectory paths to descend into. */
  includeSubdirectories?: string[];
  /** Per-folder opt-out: subdirectory paths to skip. Overrides include + depth. */
  excludeSubdirectories?: string[];
}

/**
 * Bundle of watched directories that share a single leader. Files arriving
 * in any member route into the leader's category tree instead of being
 * organized in place. See `src/config/groups.ts` for the routing logic.
 */
export interface DirectoryGroup {
  name: string;
  /** Absolute path; must be one of `members`. */
  leader: string;
  /** Absolute paths; should contain `leader`. */
  members: string[];
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  operations: { type: string; from?: string; to?: string; path?: string }[];
  category?: string;
  confidence?: number;
}

export interface SuggestedCategory {
  name: string;
  keywords: string[];
  centroid: number[];
  fileCount: number;
}

export const api = {
  // Config
  getConfig: () => invoke<Record<string, unknown>>('config:get'),
  setConfig: (config: unknown) => invoke('config:set', config),

  // Files
  listFiles: (dir: string) => invoke<FileEntry[]>('files:list', dir),
  mkdir: (dir: string) => invoke('files:mkdir', dir),
  moveFile: (src: string, destDir: string) => invoke('files:move', src, destDir),
  renameFile: (oldPath: string, newName: string) => invoke<string>('files:rename', oldPath, newName),
  watchDir: (dir: string) => invoke('files:watch', dir),

  // Classify
  classify: (filePath: string) =>
    invoke<{ category: string | null; score: number }>('classify:file', filePath),

  // Organize
  previewOrganize: (dir: string, options?: PreviewOptions) =>
    invoke<DryRunPlan>('organize:preview', dir, options),
  executeOrganize: (moves: PlannedMove[]) =>
    invoke<{ moved: { from: string; to: string; action: string }[]; errors: { path: string; error: string }[] }>('organize:execute', moves),

  // Categories
  getCategories: () => invoke<Record<string, CategoryConfig>>('categories:list'),
  scanCategories: (dir: string, k?: number) =>
    invoke<SuggestedCategory[]>('categories:scan', dir, k),
  saveCategory: (name: string, keywords: string[], centroid: number[]) =>
    invoke('categories:save', name, keywords, centroid),
  deleteCategory: (name: string) => invoke('categories:delete', name),
  deleteCategories: (names: string[]) =>
    invoke<{ deleted: number; missing: string[] }>('categories:deleteMany', names),
  renameCategory: (oldName: string, newName: string) => invoke('categories:rename', oldName, newName),

  // Quarantine
  getQuarantine: (dir: string) => invoke<string[]>('quarantine:list', dir),

  // History
  getHistory: () => invoke<JournalEntry[]>('history:query'),
  undo: (id?: string) =>
    id
      ? invoke<{ reversed: string[]; errors: string[] }>('undo:by-id', id)
      : invoke<{ reversed: string[]; errors: string[] }>('undo:last'),
  /** Partial undo: reverse only the specified operations within an entry. */
  undoOperations: (id: string, operationIndices: number[]) =>
    invoke<{ reversed: string[]; errors: string[] }>('undo:operations', id, operationIndices),

  // Shell helpers
  revealInFolder: (path: string) => invoke('shell:reveal', path),
  copyPath: (path: string) => invoke('shell:copy-path', path),

  // Daemon
  daemonStatus: () =>
    invoke<{ running: boolean; watchedPaths: string[] }>('daemon:status'),
  daemonStart: () => invoke('daemon:start'),
  daemonStop: () => invoke('daemon:stop'),

  // Native folder picker. Always use this in the MAS build — typing a
  // path into a text field can't grant the sandbox an access bookmark,
  // so a hand-typed watch directory will silently fail every fs call.
  // On the direct-distribution build it's still preferred (better UX
  // and the same code path) but the text field also works.
  // Returns null if the user cancelled.
  chooseDirectory: () => invoke<string | null>('dialog:choose-directory'),

  /**
   * Whether the current binary is the Mac App Store build. Used by the
   * UI to hide direct-distribution-only affordances (external links,
   * autoUpdater triggers, "Reveal log file in Finder" outside the
   * sandbox container, etc.).
   */
  isMasBuild: () => invoke<boolean>('app:is-mas-build'),
};

// Event listener helpers
export const ipcEvents = {
  on: (channel: string, listener: (...args: unknown[]) => void) =>
    ff().on(channel, listener),
};

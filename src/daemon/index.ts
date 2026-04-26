import fs from 'fs';
import path from 'path';
import { FileWatcher } from './watcher.js';
import { extractContent } from '../extractor/index.js';
import { tokenize } from '../classifier/tokenizer.js';
import { buildCorpusTFIDF } from '../classifier/tfidf.js';
import { findBestCategory, isAboveThreshold } from '../classifier/confidence.js';
import { detectCourseForFile, buildExtraDepartments } from '../classifier/course-detector.js';
import { detectFilenameHeuristic } from '../classifier/filename-heuristics.js';
import { classifyWithPersonas } from '../classifier/personas/index.js';
import { applyCustomRules } from '../classifier/custom-rules.js';
import { learnFromCorrection } from '../classifier/learning.js';
import { moveFile } from '../organizer/mover.js';
import { quarantineFile, getQuarantineDir } from '../safety/quarantine.js';
import { loadHashCache, saveHashCache, type HashCache } from '../organizer/dedup.js';
import { loadConfig, resolveConfigPaths, ensureConfigDir, saveConfig, type FileFlowConfig } from '../config/index.js';
import { resolveDestDir } from '../config/groups.js';

export interface DaemonActivity {
  timestamp: Date;
  type: 'move' | 'quarantine' | 'skip' | 'error' | 'dedup';
  srcPath: string;
  destPath?: string;
  category?: string;
  confidence?: number;
  message?: string;
}

export type ActivityListener = (activity: DaemonActivity) => void;

export class FileFlowDaemon {
  private config: FileFlowConfig;
  private watcher: FileWatcher;
  private cache: HashCache = {};
  private listeners: ActivityListener[] = [];
  private processing = new Set<string>();
  private filesOrganized = 0;
  private filesQuarantined = 0;
  private dupesFound = 0;
  // Debounced rescan of Uncategorized/. Coalesces rapid arrivals so a
  // burst of new files only kicks off one rescan after the last one
  // settles, rather than N redundant walks of the same folder.
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  // Set by `rescanUncategorized` while it's iterating, so the per-file
  // classify path can tell "this is a fresh arrival" from "this is a
  // retry of an already-quarantined file." Retries must NOT schedule
  // another rescan or call learnFromCorrection on themselves —
  // otherwise a single rescan loop could keep mutating categories and
  // re-firing forever.
  private rescanning = false;

  constructor(config: FileFlowConfig) {
    this.config = resolveConfigPaths(config);
    this.cache = loadHashCache(this.config.duplicates.hash_cache_path);
    this.watcher = new FileWatcher(this.config, (event) => {
      if (event.type === 'add') {
        this.handleNewFile(event.path);
      }
    });
  }

  static async create(): Promise<FileFlowDaemon> {
    ensureConfigDir();
    const config = await loadConfig();
    return new FileFlowDaemon(config);
  }

  onActivity(listener: ActivityListener): void {
    this.listeners.push(listener);
  }

  offActivity(listener: ActivityListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  start(): void {
    this.watcher.start();
  }

  stop(): void {
    this.watcher.stop();
    saveHashCache(this.config.duplicates.hash_cache_path, this.cache);
  }

  get isRunning(): boolean {
    return this.watcher.isRunning;
  }

  get stats() {
    return {
      filesSeen: this.watcher.totalFilesSeen,
      filesOrganized: this.filesOrganized,
      filesQuarantined: this.filesQuarantined,
      dupesFound: this.dupesFound,
      watchedPaths: this.config.watch_directories,
    };
  }

  async reloadConfig(): Promise<void> {
    const newConfig = await loadConfig();
    this.config = resolveConfigPaths(newConfig);
    this.cache = loadHashCache(this.config.duplicates.hash_cache_path);
    this.watcher.updateConfig(this.config);
  }

  private emit(activity: DaemonActivity): void {
    for (const listener of this.listeners) {
      try {
        listener(activity);
      } catch {
        // Never crash the daemon due to a listener error
      }
    }
  }

  private async handleNewFile(filePath: string): Promise<void> {
    // Prevent duplicate processing of the same file
    if (this.processing.has(filePath)) return;
    this.processing.add(filePath);

    try {
      await this.classifyAndOrganize(filePath);
    } finally {
      this.processing.delete(filePath);
      // Periodically flush cache
      if (this.filesOrganized % 10 === 0) {
        saveHashCache(this.config.duplicates.hash_cache_path, this.cache);
      }
    }
  }

  private async classifyAndOrganize(filePath: string): Promise<void> {
    // Guard against the watcher → debounce → classify race. Between the
    // moment chokidar enqueued this path and now (>= debounce_seconds
    // later) the user may have moved the file out themselves via Finder,
    // or another tool may have deleted it. Touching it now would either
    // produce a misleading "extraction failed" error or — worse, the
    // bug this guard was added for — quarantine a file the user was
    // already in the middle of moving. If it's gone, it's gone.
    try {
      if (!fs.existsSync(filePath)) return;
    } catch {
      return;
    }

    let text = '';
    try {
      const extracted = await extractContent(filePath, this.config.max_file_size_mb);
      text = extracted.text;
    } catch (err) {
      this.emit({
        timestamp: new Date(),
        type: 'error',
        srcPath: filePath,
        message: (err as Error).message,
      });
      return;
    }

    // File size is consumed by persona packs and the legacy filename
    // heuristic. Stat once and share — re-statting per classifier risked
    // racing the file's own move out from under us.
    let fileSize: number | undefined;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch {
      // leave undefined; classifiers that need size will skip themselves
    }

    const watchDir = this.getWatchDir(filePath);

    // ── Course number detection (highest priority) ────────────
    // A student's CS 3100 PDF should always route to CS 3100, regardless
    // of whether TF-IDF categories exist or would otherwise win.
    const extraDepts = buildExtraDepartments(this.config.course_departments);
    const courseFolder = detectCourseForFile(text, filePath, extraDepts);
    if (courseFolder) {
      const destDir = resolveDestDir(filePath, courseFolder, this.config.directory_groups, watchDir);
      try {
        const result = await moveFile(filePath, destDir, this.config, this.cache, courseFolder, 1.0);
        this.filesOrganized++;

        // Register the course in config so it appears in the Categories tab
        if (!this.config.categories[courseFolder]) {
          this.config.categories[courseFolder] = { keywords: [], centroid: [] };
          try { await saveConfig(this.config); } catch { /* never crash the daemon on save */ }
        }

        this.emit({
          timestamp: new Date(),
          type: result.action === 'skipped-duplicate' ? 'dedup' : 'move',
          srcPath: filePath,
          destPath: result.to,
          category: courseFolder,
          confidence: 1.0,
        });
        if (!this.rescanning) this.scheduleRescanUncategorized();
      } catch (err) {
        this.emit({
          timestamp: new Date(),
          type: 'error',
          srcPath: filePath,
          message: (err as Error).message,
        });
      }
      return;
    }

    // ── Persona pack classification ───────────────────────────
    // High-precision packs (software-engineer, lawyer, accountant, …) run
    // before TF-IDF so a file whose category was *defined* by a pack at
    // Organize Now time keeps routing the same way when it lands later via
    // the daemon. Without this, the canonical example fails: Organize Now
    // sends `installer.dmg` to `software_engineer/`, then the daemon —
    // which previously skipped persona packs — falls through to weak
    // single-doc TF-IDF and quarantines the next dmg the user drops in.
    const personaMatch = await classifyWithPersonas(
      { filePath, text, fileSizeBytes: fileSize },
      this.config.personas,
    );
    if (personaMatch) {
      const destDir = resolveDestDir(filePath, personaMatch.category, this.config.directory_groups, watchDir);
      try {
        const result = await moveFile(filePath, destDir, this.config, this.cache, personaMatch.category, personaMatch.confidence);
        this.filesOrganized++;

        // Auto-register so the category appears in the Categories tab. We
        // store an empty centroid because the pack doesn't classify by
        // keywords — the next file will be matched by the same pack, not
        // by TF-IDF on this entry.
        if (!this.config.categories[personaMatch.category]) {
          this.config.categories[personaMatch.category] = { keywords: [], centroid: [] };
          try { await saveConfig(this.config); } catch { /* never crash daemon on save */ }
        }

        this.emit({
          timestamp: new Date(),
          type: result.action === 'skipped-duplicate' ? 'dedup' : 'move',
          srcPath: filePath,
          destPath: result.to,
          category: personaMatch.category,
          confidence: personaMatch.confidence,
        });
        if (!this.rescanning) this.scheduleRescanUncategorized();
      } catch (err) {
        this.emit({
          timestamp: new Date(),
          type: 'error',
          srcPath: filePath,
          message: (err as Error).message,
        });
      }
      return;
    }

    // ── User-authored custom rules ────────────────────────────
    // After personas (so a too-broad rule can't silently override a pack
    // the user enabled) and before filename heuristics + TF-IDF (so a
    // targeted rule wins over fuzzy clustering).
    const customMatch = applyCustomRules(filePath, this.config.custom_rules);
    if (customMatch) {
      const destDir = resolveDestDir(filePath, customMatch.destination, this.config.directory_groups, watchDir);
      try {
        const result = await moveFile(filePath, destDir, this.config, this.cache, customMatch.destination, 0.95);
        this.filesOrganized++;

        if (!this.config.categories[customMatch.destination]) {
          this.config.categories[customMatch.destination] = { keywords: [], centroid: [] };
          try { await saveConfig(this.config); } catch { /* never crash daemon on save */ }
        }

        this.emit({
          timestamp: new Date(),
          type: result.action === 'skipped-duplicate' ? 'dedup' : 'move',
          srcPath: filePath,
          destPath: result.to,
          category: customMatch.destination,
          confidence: 0.95,
        });
        if (!this.rescanning) this.scheduleRescanUncategorized();
      } catch (err) {
        this.emit({
          timestamp: new Date(),
          type: 'error',
          srcPath: filePath,
          message: (err as Error).message,
        });
      }
      return;
    }

    // ── Filename-only heuristics (Personal, Build Logs) ───────
    // Legacy fallback retained for users with all persona packs disabled.
    const heuristicCategory = detectFilenameHeuristic(filePath, fileSize);
    if (heuristicCategory) {
      const destDir = resolveDestDir(filePath, heuristicCategory, this.config.directory_groups, watchDir);
      try {
        const result = await moveFile(filePath, destDir, this.config, this.cache, heuristicCategory, 0.9);
        this.filesOrganized++;

        // Auto-register the heuristic category so it appears in the Categories tab
        if (!this.config.categories[heuristicCategory]) {
          this.config.categories[heuristicCategory] = { keywords: [], centroid: [] };
          try { await saveConfig(this.config); } catch { /* never crash daemon on save */ }
        }

        this.emit({
          timestamp: new Date(),
          type: result.action === 'skipped-duplicate' ? 'dedup' : 'move',
          srcPath: filePath,
          destPath: result.to,
          category: heuristicCategory,
          confidence: 0.9,
        });
        if (!this.rescanning) this.scheduleRescanUncategorized();
      } catch (err) {
        this.emit({
          timestamp: new Date(),
          type: 'error',
          srcPath: filePath,
          message: (err as Error).message,
        });
      }
      return;
    }

    // ── No TF-IDF categories? quarantine ──────────────────────
    // Suppress this branch during rescan: the file is already inside
    // Uncategorized, re-quarantining would be a same-folder no-op move
    // and a duplicate activity event. Leaving the file in place is the
    // correct behaviour — the next organize-success will retry it.
    if (Object.keys(this.config.categories).length === 0) {
      if (this.rescanning) return;
      await quarantineFile(filePath, watchDir, this.config, this.cache);
      this.filesQuarantined++;
      this.emit({
        timestamp: new Date(),
        type: 'quarantine',
        srcPath: filePath,
        message: 'No categories defined',
      });
      return;
    }

    // ── TF-IDF classification ─────────────────────────────────
    const tokens = tokenize(text);
    const { vectors } = buildCorpusTFIDF([tokens]);
    const vector = vectors[0];

    const match = findBestCategory(vector, this.config.categories);
    const confidence = match?.score ?? 0;
    const category = match?.category ?? null;

    if (category && isAboveThreshold(confidence, this.config.confidence_threshold)) {
      const destDir = resolveDestDir(filePath, category, this.config.directory_groups, watchDir);
      try {
        const result = await moveFile(filePath, destDir, this.config, this.cache, category, confidence);

        if (result.action === 'skipped-duplicate') {
          this.dupesFound++;
          this.emit({
            timestamp: new Date(),
            type: 'dedup',
            srcPath: filePath,
            destPath: result.to,
            category,
            confidence,
          });
        } else {
          this.filesOrganized++;
          this.emit({
            timestamp: new Date(),
            type: 'move',
            srcPath: filePath,
            destPath: result.to,
            category,
            confidence,
          });

          // Online learning: pull the new file's top TF-IDF terms back into
          // the matched category. This is exactly the trick that makes the
          // single-doc weakness self-heal — once the daemon has organized a
          // few files into a category, that category accumulates real
          // discriminative keywords, and previously-quarantined siblings can
          // match on the next rescan. Skipped during rescan to avoid the
          // category drifting on every loop iteration.
          if (!this.rescanning) {
            try {
              const updated = await learnFromCorrection(result.to, category, this.config);
              if (updated) await saveConfig(this.config);
            } catch {
              // non-fatal: the move itself already succeeded
            }
          }
        }
        if (!this.rescanning) this.scheduleRescanUncategorized();
      } catch (err) {
        this.emit({
          timestamp: new Date(),
          type: 'error',
          srcPath: filePath,
          message: (err as Error).message,
        });
      }
    } else {
      // Same rescan suppression as the no-categories branch above. If the
      // file is already in Uncategorized and STILL doesn't clear the
      // threshold, it stays there silently — the next organize-success
      // will give it another shot once the category keywords have grown.
      if (this.rescanning) return;
      try {
        const quarantinedPath = await quarantineFile(
          filePath,
          watchDir,
          this.config,
          this.cache,
          category ?? undefined,
          confidence,
        );
        this.filesQuarantined++;
        this.emit({
          timestamp: new Date(),
          type: 'quarantine',
          srcPath: filePath,
          destPath: quarantinedPath,
          category: category ?? undefined,
          confidence,
        });
      } catch (err) {
        this.emit({
          timestamp: new Date(),
          type: 'error',
          srcPath: filePath,
          message: (err as Error).message,
        });
      }
    }
  }

  /**
   * Schedule a rescan of every watch directory's Uncategorized/ folder.
   * Coalesces rapid arrivals: if `scheduleRescanUncategorized` is called
   * twice in quick succession we restart the timer, so a burst of new
   * files results in a single rescan after the burst settles.
   *
   * Why ~1.5s: long enough to absorb the trailing edge of a multi-file
   * download (browser flushes them milliseconds apart but emits separate
   * events); short enough that a user dropping in one file sees the
   * Uncategorized retry happen visibly soon after the organize.
   */
  private scheduleRescanUncategorized(): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      void this.rescanUncategorized();
    }, 1500);
  }

  /**
   * Walk each watch directory's Uncategorized/ folder and run every file
   * back through `classifyAndOrganize`. The motivation: a file
   * quarantined yesterday, when categories were sparse, may now match —
   * either because new categories were created since (course detection,
   * persona registration, custom rules) OR because TF-IDF keyword lists
   * have grown via `learnFromCorrection` on subsequent siblings.
   *
   * The `rescanning` flag suppresses two things on this code path:
   *   1. Recursive rescan scheduling — without this guard, every file
   *      successfully retrieved from Uncategorized would schedule
   *      another rescan, walking the same shrinking set forever.
   *   2. `learnFromCorrection` — we don't want a quarantined file (which
   *      may have been a borderline match in the first place) to mutate
   *      the category it just barely cleared. Learning is a *user
   *      correction* signal, not a daemon-feedback signal.
   *
   * Files still in Uncategorized after the rescan stay there: the next
   * organize-success will retry them again automatically.
   */
  private async rescanUncategorized(): Promise<void> {
    if (this.rescanning) return;
    this.rescanning = true;
    try {
      for (const watchDir of this.config.watch_directories) {
        const uncatDir = getQuarantineDir(watchDir, this.config);
        if (!fs.existsSync(uncatDir)) continue;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(uncatDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          // Skip dotfiles like .DS_Store — same exclusion the watcher applies
          if (entry.name.startsWith('.')) continue;
          const filePath = path.join(uncatDir, entry.name);
          // Skip files currently being processed by the live watcher path,
          // otherwise the same file could be moved twice or — worse — read
          // and acted on after `moveFile` already removed it.
          if (this.processing.has(filePath)) continue;
          this.processing.add(filePath);
          try {
            await this.classifyAndOrganize(filePath);
          } finally {
            this.processing.delete(filePath);
          }
        }
      }
    } finally {
      this.rescanning = false;
    }
  }

  private getWatchDir(filePath: string): string {
    return (
      this.config.watch_directories.find((d) => filePath.startsWith(d)) ??
      this.config.watch_directories[0]
    );
  }
}

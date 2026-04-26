import fs from 'fs';
import path from 'path';
import { extractContent } from '../extractor/index.js';
import { tokenize } from '../classifier/tokenizer.js';
import { buildCorpusTFIDF } from '../classifier/tfidf.js';
import { findBestCategory, isAboveThreshold } from '../classifier/confidence.js';
import { detectCourseForFile, buildExtraDepartments } from '../classifier/course-detector.js';
import { detectFilenameHeuristic, isLikelyImageOnlyPdf } from '../classifier/filename-heuristics.js';
import { inferCoursesFromSiblings, inferCategoriesFromSiblings } from '../classifier/sibling-inference.js';
import { classifyWithPersonas } from '../classifier/personas/index.js';
import { applyCustomRules } from '../classifier/custom-rules.js';
import { wouldCollide } from '../organizer/conflict.js';
import { areIdentical, getCachedHash, type HashCache } from '../organizer/dedup.js';
import { isExcluded } from '../config/exclusions.js';
import { resolveDestDir } from '../config/groups.js';
import { isPathAllowed } from './path-guard.js';
import { isCodeProjectDir } from '../classifier/code-project.js';
import type { FileFlowConfig } from '../config/schema.js';

export interface PlannedMove {
  srcPath: string;
  destDir: string;
  destPath: string;
  category: string;
  confidence: number;
  collision: boolean;
  duplicate: boolean;
}

export interface PlannedQuarantine {
  srcPath: string;
  closestCategory: string | null;
  confidence: number;
  /**
   * True when the file appears to be an image-only PDF (no extractable text
   * but non-trivial file size). The UI can surface this as a hint that the
   * file needs OCR before it can be classified.
   */
  needsOcr?: boolean;
}

export interface DuplicatePair {
  original: string;
  duplicate: string;
  hash: string;
}

/**
 * One immediate subdirectory of the scanned target directory, with metadata
 * the UI uses to offer per-folder opt-in / opt-out toggles.
 */
export interface SubdirectoryInfo {
  /** Absolute path to the subdirectory. */
  path: string;
  /** Display name (basename). */
  name: string;
  /**
   * True if this subdirectory's contents were included in the current scan.
   * False means files inside it were not classified — useful for the UI to
   * render a "Scan this folder" affordance.
   */
  scanned: boolean;
  /**
   * True if the subdirectory looks like a code-project root (`.git`,
   * `package.json`, `Cargo.toml`, etc.). These are ALWAYS skipped unless the
   * user explicitly opts in via `includeSubdirectories`, because descending
   * into a project tree almost never matches user intent.
   */
  isCodeProject: boolean;
}

export interface PreviewPlan {
  moves: PlannedMove[];
  quarantined: PlannedQuarantine[];
  duplicates: DuplicatePair[];
  errors: { path: string; error: string }[];
  totalFiles: number;
  /**
   * Immediate subdirectories of `targetDir`, with scan-status metadata. The
   * UI uses this list to offer per-folder opt-in checkboxes; passing the
   * selected paths back as `options.includeSubdirectories` on a re-scan
   * forces those folders to be descended into.
   */
  subdirectories: SubdirectoryInfo[];
}

export interface PreviewOptions {
  /**
   * Override `config.max_scan_depth` for this preview only. If undefined,
   * falls back to the configured default. Capped at 8 by the schema.
   */
  maxScanDepth?: number;
  /**
   * Per-folder opt-in: absolute subdirectory paths to descend into even
   * when the depth limit (or code-project guard) would otherwise skip
   * them. Unknown paths are silently ignored.
   */
  includeSubdirectories?: string[];
  /**
   * Per-folder opt-out: absolute subdirectory paths to skip even when the
   * depth limit would otherwise descend. Overrides everything (including
   * `includeSubdirectories`) — the user explicitly said "don't touch this."
   */
  excludeSubdirectories?: string[];
  /**
   * Progress callback fired at the start of each file's processing.
   */
  onProgress?: (current: number, total: number, currentFile: string) => void;
}

/**
 * Scan a directory and classify all files without moving anything.
 * Returns a full preview plan that can be shown to the user before execution.
 *
 * Recursion is controlled by `config.max_scan_depth` (default 0 = top-level
 * only). For finer-grained control without changing the config, callers can
 * pass `options.maxScanDepth` (per-preview override) and/or
 * `options.includeSubdirectories` (force-include specific folders even when
 * the depth limit / code-project guard would otherwise skip them).
 */
export async function buildPreviewPlan(
  targetDir: string,
  config: FileFlowConfig,
  cache: HashCache,
  options?: PreviewOptions,
): Promise<PreviewPlan> {
  const plan: PreviewPlan = {
    moves: [],
    quarantined: [],
    duplicates: [],
    errors: [],
    totalFiles: 0,
    subdirectories: [],
  };

  const maxDepth = options?.maxScanDepth ?? config.max_scan_depth ?? 0;
  const includeSet = new Set(options?.includeSubdirectories ?? []);
  const excludeSet = new Set(options?.excludeSubdirectories ?? []);
  const onProgress = options?.onProgress;

  // Enumerate immediate subdirectories first — even those we won't descend
  // into. The UI lists them with a per-folder opt-in toggle.
  plan.subdirectories = listImmediateSubdirectories(
    targetDir,
    config.exclusions,
    maxDepth,
    includeSet,
    excludeSet,
  );

  // Collect files honouring the depth limit + per-folder includes/excludes.
  const allFiles = collectFiles(
    targetDir,
    config.exclusions,
    targetDir,
    maxDepth,
    includeSet,
    excludeSet,
    0,
  );
  plan.totalFiles = allFiles.length;

  if (allFiles.length === 0) return plan;

  // Detect duplicates within the scanned set
  const hashToFiles = new Map<string, string[]>();
  for (const fp of allFiles) {
    const hash = getCachedHash(fp, cache);
    if (hash) {
      const existing = hashToFiles.get(hash);
      if (existing) existing.push(fp);
      else hashToFiles.set(hash, [fp]);
    }
  }
  for (const [hash, files] of hashToFiles) {
    if (files.length > 1) {
      for (let i = 1; i < files.length; i++) {
        plan.duplicates.push({ original: files[0], duplicate: files[i], hash });
      }
    }
  }

  const hasCategories = Object.keys(config.categories).length > 0;
  const extraDepts = buildExtraDepartments(config.course_departments);

  // Extract content and classify each file.
  // Course detection runs for EVERY file regardless of whether TF-IDF
  // categories exist — a student's CS 3100 PDF should always route correctly.
  for (let i = 0; i < allFiles.length; i++) {
    const fp = allFiles[i];
    onProgress?.(i + 1, allFiles.length, fp);
    try {
      const extracted = await extractContent(fp, config.max_file_size_mb);

      // Stat once up front — used by both the loose-script heuristic and the
      // image-only-PDF check below. Failure is non-fatal (we just lose those
      // size-gated heuristics for this file).
      let fileSize: number | undefined;
      try {
        fileSize = fs.statSync(fp).size;
      } catch {
        // leave undefined; heuristics that need size will skip themselves
      }

      // ── Course number detection (highest priority) ────────────
      // If the file references a course like "CS 3100" or "MATH 1365",
      // send it straight to a folder with that name — no TF-IDF needed.
      const courseFolder = detectCourseForFile(extracted.text, fp, extraDepts);
      if (courseFolder) {
        const destDir = resolveDestDir(fp, courseFolder, config.directory_groups, path.dirname(fp));
        // Defence-in-depth: refuse to plan a move that would escape the
        // watched/grouped tree. This shouldn't fire for built-in classifiers
        // (they emit safe category names) but a malicious config — e.g. a
        // user-authored category like `../../etc` reused in `categories` —
        // could otherwise produce a destination outside the allowed roots.
        if (!isPathAllowed(destDir, config)) {
          plan.errors.push({ path: fp, error: 'Refused: computed destination is outside the allowed directory tree.' });
          continue;
        }
        const destPath = path.join(destDir, path.basename(fp));
        const collision = wouldCollide(destPath);
        const duplicate = collision ? areIdentical(fp, destPath, cache) : false;

        plan.moves.push({
          srcPath: fp,
          destDir,
          destPath,
          category: courseFolder,
          confidence: 1.0,
          collision,
          duplicate,
        });
        continue; // skip TF-IDF for this file
      }

      // ── Persona pack classification ───────────────────────────
      // Each enabled persona pack runs in priority order — job-seeker before
      // generic Personal, lawyer before generic Documents, etc. The first
      // non-null match wins. Packs cover the high-precision territory; what
      // they don't claim falls through to filename heuristics + TF-IDF.
      const personaMatch = await classifyWithPersonas(
        { filePath: fp, text: extracted.text, fileSizeBytes: fileSize },
        config.personas,
      );
      if (personaMatch) {
        const destDir = resolveDestDir(fp, personaMatch.category, config.directory_groups, path.dirname(fp));
        if (!isPathAllowed(destDir, config)) {
          plan.errors.push({ path: fp, error: 'Refused: computed destination is outside the allowed directory tree.' });
          continue;
        }
        const destPath = path.join(destDir, path.basename(fp));
        const collision = wouldCollide(destPath);
        const duplicate = collision ? areIdentical(fp, destPath, cache) : false;

        plan.moves.push({
          srcPath: fp,
          destDir,
          destPath,
          category: personaMatch.category,
          confidence: personaMatch.confidence,
          collision,
          duplicate,
        });
        continue;
      }

      // ── User-authored custom rules ────────────────────────────
      // Power-user filename → folder rules. Run after personas (so a pack
      // can't be silently overridden by a too-broad rule the user forgot
      // about) but before TF-IDF (so a targeted rule wins over fuzzy
      // clustering).
      const customMatch = applyCustomRules(fp, config.custom_rules);
      if (customMatch) {
        const destDir = resolveDestDir(fp, customMatch.destination, config.directory_groups, path.dirname(fp));
        // Custom rules are user-authored regex+template — the most likely
        // vector for an out-of-tree destination (a `..` smuggled past the
        // pre-filter via capture-group substitution, an absolute path that
        // resolves outside the watch list, etc.). On rejection, fall through
        // to the next classifier rather than erroring; the rule simply doesn't
        // apply and the file gets a chance to match heuristics or TF-IDF.
        if (isPathAllowed(destDir, config)) {
          const destPath = path.join(destDir, path.basename(fp));
          const collision = wouldCollide(destPath);
          const duplicate = collision ? areIdentical(fp, destPath, cache) : false;

          plan.moves.push({
            srcPath: fp,
            destDir,
            destPath,
            category: customMatch.destination,
            confidence: 0.95,
            collision,
            duplicate,
          });
          continue;
        }
        // fall through — let the next classifier try this file
      }

      // ── Legacy filename heuristics (fallback) ─────────────────
      // Most original heuristic categories (Personal, Build Logs, Installers,
      // Code Snippets) are now produced by persona packs. This block remains
      // as defence-in-depth in case a user has all packs disabled but still
      // wants the old behaviour.
      const heuristicCategory = detectFilenameHeuristic(fp, fileSize);
      if (heuristicCategory) {
        const destDir = resolveDestDir(fp, heuristicCategory, config.directory_groups, path.dirname(fp));
        if (!isPathAllowed(destDir, config)) {
          plan.errors.push({ path: fp, error: 'Refused: computed destination is outside the allowed directory tree.' });
          continue;
        }
        const destPath = path.join(destDir, path.basename(fp));
        const collision = wouldCollide(destPath);
        const duplicate = collision ? areIdentical(fp, destPath, cache) : false;

        plan.moves.push({
          srcPath: fp,
          destDir,
          destPath,
          category: heuristicCategory,
          confidence: 0.9,
          collision,
          duplicate,
        });
        continue;
      }

      // ── Image-only PDF detection ──────────────────────────────
      // Empty/nearly-empty extracted text + non-trivial file size →
      // scanned PDF. Flag it in quarantine so the user knows it needs OCR.
      // Reuses the file size we already cached above.
      const needsOcr =
        fileSize !== undefined &&
        isLikelyImageOnlyPdf(fp, extracted.text, fileSize);

      // ── TF-IDF category matching ──────────────────────────────
      if (!hasCategories) {
        // No categories configured and no course match → quarantine
        plan.quarantined.push({
          srcPath: fp,
          closestCategory: null,
          confidence: 0,
          needsOcr,
        });
        continue;
      }

      // Combine filename + content for classification. The filename is a
      // free, high-signal source — a file called "AI_Culture.pdf" should
      // match an Ai_* cluster even if the extracted text is sparse. We
      // strip the extension to avoid noisy ".pdf"/".txt" tokens dominating.
      const filenameStem = path.basename(fp).replace(/\.[^.]+$/, '');
      const tokens = tokenize(filenameStem + ' ' + extracted.text);
      const { vectors } = buildCorpusTFIDF([tokens]);
      const vector = vectors[0];

      const match = findBestCategory(vector, config.categories);
      const confidence = match?.score ?? 0;
      const category = match?.category ?? null;

      if (category && isAboveThreshold(confidence, config.confidence_threshold)) {
        const destDir = resolveDestDir(fp, category, config.directory_groups, path.dirname(fp));
        if (!isPathAllowed(destDir, config)) {
          // A user-authored category key (in `config.categories`) somehow
          // resolved to an out-of-tree path — most likely a `..` segment
          // baked into the key. Quarantine the file rather than refusing.
          plan.quarantined.push({ srcPath: fp, closestCategory: category, confidence, needsOcr });
          continue;
        }
        const destPath = path.join(destDir, path.basename(fp));
        const collision = wouldCollide(destPath);
        const duplicate = collision ? areIdentical(fp, destPath, cache) : false;

        plan.moves.push({
          srcPath: fp,
          destDir,
          destPath,
          category,
          confidence,
          collision,
          duplicate,
        });
      } else {
        plan.quarantined.push({
          srcPath: fp,
          closestCategory: category,
          confidence,
          needsOcr,
        });
      }
    } catch (err) {
      plan.errors.push({ path: fp, error: (err as Error).message });
    }
  }

  // ── Post-pass: sibling-folder inference (courses) ────────────────────
  // Pull unclassified files into an existing course folder if ≥2 of their
  // batch peers already routed there AND they share a leading numeric token
  // (e.g. "1365-notes-template-*.pdf" siblings a "MATH 1365 Syllabus.pdf").
  const isCourseName = (s: string) => /^[A-Z]{2,6} \d{3,4}[A-Z]{0,2}$/.test(s);
  const routedCourses = plan.moves
    .filter((m) => isCourseName(m.category))
    .map((m) => ({ srcPath: m.srcPath, courseName: m.category }));

  if (routedCourses.length > 0 && plan.quarantined.length > 0) {
    const siblingMatches = inferCoursesFromSiblings({
      routedCourses,
      unclassifiedPaths: plan.quarantined.map((q) => q.srcPath),
    });

    if (siblingMatches.length > 0) {
      const matchedPaths = new Set(siblingMatches.map((m) => m.srcPath));
      plan.quarantined = plan.quarantined.filter((q) => !matchedPaths.has(q.srcPath));

      for (const match of siblingMatches) {
        const destDir = resolveDestDir(match.srcPath, match.courseName, config.directory_groups, path.dirname(match.srcPath));
        if (!isPathAllowed(destDir, config)) {
          plan.errors.push({ path: match.srcPath, error: 'Refused: computed destination is outside the allowed directory tree.' });
          continue;
        }
        const destPath = path.join(destDir, path.basename(match.srcPath));
        const collision = wouldCollide(destPath);
        const duplicate = collision ? areIdentical(match.srcPath, destPath, cache) : false;

        plan.moves.push({
          srcPath: match.srcPath,
          destDir,
          destPath,
          category: match.courseName,
          // Derivative confidence — less than direct detection but clearly
          // above-threshold.
          confidence: 0.8,
          collision,
          duplicate,
        });
      }
    }
  }

  // ── Post-pass: sibling inference for non-course categories ───────────
  // Files that scored just below threshold often belong to a cluster their
  // peers already routed to. If ≥3 routed files share at least one filename
  // token with the candidate, pull it in. Non-course categories are softer
  // signals than course numbers, so the bar is higher (3 peers vs. 2).
  const routedToCategory = plan.moves
    .filter((m) => !isCourseName(m.category))
    .map((m) => ({ srcPath: m.srcPath, category: m.category }));

  if (routedToCategory.length > 0 && plan.quarantined.length > 0) {
    const catSiblingMatches = inferCategoriesFromSiblings({
      routedToCategory,
      unclassifiedPaths: plan.quarantined.map((q) => q.srcPath),
    });

    if (catSiblingMatches.length > 0) {
      const matchedPaths = new Set(catSiblingMatches.map((m) => m.srcPath));
      plan.quarantined = plan.quarantined.filter((q) => !matchedPaths.has(q.srcPath));

      for (const match of catSiblingMatches) {
        const destDir = resolveDestDir(match.srcPath, match.category, config.directory_groups, path.dirname(match.srcPath));
        if (!isPathAllowed(destDir, config)) {
          plan.errors.push({ path: match.srcPath, error: 'Refused: computed destination is outside the allowed directory tree.' });
          continue;
        }
        const destPath = path.join(destDir, path.basename(match.srcPath));
        const collision = wouldCollide(destPath);
        const duplicate = collision ? areIdentical(match.srcPath, destPath, cache) : false;

        plan.moves.push({
          srcPath: match.srcPath,
          destDir,
          destPath,
          category: match.category,
          // Derivative confidence — peer-based inference, below direct match.
          confidence: 0.65,
          collision,
          duplicate,
        });
      }
    }
  }

  return plan;
}

/**
 * Recursively collect files under `dir`, honouring:
 *
 *   • `exclusions` — config-level glob patterns (node_modules, .git, etc.)
 *   • `maxDepth`   — 0 = current dir only; N = descend N levels.
 *   • `includeSet` — explicit per-folder opt-in. A subdirectory whose path
 *     is in this set is descended into even when `maxDepth` or the
 *     code-project guard would otherwise skip it.
 *
 * Code-project roots (anything `isCodeProjectDir` flags) are skipped unless
 * the user explicitly opted them in. This prevents the organizer from
 * disturbing source trees that happen to live inside the scanned directory.
 *
 * Default behaviour (maxDepth=0, empty includeSet) matches the original
 * non-recursive collector — preorganized subdirectories remain invisible.
 */
function collectFiles(
  dir: string,
  exclusions: string[],
  baseDir: string,
  maxDepth: number,
  includeSet: Set<string>,
  excludeSet: Set<string>,
  currentDepth: number,
): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isExcluded(fullPath, exclusions, baseDir)) continue;

    // Never follow symlinks. A symlink that points outside the watched tree
    // would let a renderer-supplied scan target organize files the user never
    // asked to touch (e.g. a symlink at `~/Inbox/escape` pointing at `/etc`).
    // We rely on `withFileTypes: true` so the dirent type reflects the link
    // itself, not its target — both `isFile()` and `isDirectory()` return
    // false for symlinks, but checking explicitly here makes the intent
    // obvious and survives future refactors.
    if (entry.isSymbolicLink()) continue;

    if (entry.isFile()) {
      results.push(fullPath);
      continue;
    }

    if (!entry.isDirectory()) continue;

    // Highest-priority gate: explicit opt-out always wins. The user said
    // "don't touch this" — honour it regardless of depth or include lists.
    if (excludeSet.has(fullPath)) continue;

    const explicitlyIncluded = includeSet.has(fullPath);
    const withinDepthLimit = currentDepth < maxDepth;

    // Skip when neither the depth knob nor an explicit include allows entry.
    if (!explicitlyIncluded && !withinDepthLimit) continue;

    // Code-project roots are skipped by default — descending into someone's
    // git checkout would relocate source files into category folders, which
    // is almost certainly NOT what the user wants. Honour an explicit opt-in
    // (the user knows what they're doing).
    if (!explicitlyIncluded && isCodeProjectDir(fullPath)) continue;

    results.push(
      ...collectFiles(
        fullPath,
        exclusions,
        baseDir,
        maxDepth,
        includeSet,
        excludeSet,
        currentDepth + 1,
      ),
    );
  }

  return results;
}

/**
 * Enumerate the immediate subdirectories of `targetDir` (one level only) and
 * report which would be scanned under the current depth + opt-in settings.
 * The UI uses this to render per-folder toggles in the preview pane.
 *
 * Excluded directories (matching `config.exclusions`) are filtered out of
 * the returned list — there's no value in showing the user `node_modules`
 * just to tell them it was skipped.
 */
function listImmediateSubdirectories(
  targetDir: string,
  exclusions: string[],
  maxDepth: number,
  includeSet: Set<string>,
  excludeSet: Set<string>,
): SubdirectoryInfo[] {
  const info: SubdirectoryInfo[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return info;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(targetDir, entry.name);
    if (isExcluded(fullPath, exclusions, targetDir)) continue;

    const isCodeProject = isCodeProjectDir(fullPath);
    const explicitlyExcluded = excludeSet.has(fullPath);
    const explicitlyIncluded = includeSet.has(fullPath);
    // Mirror the gating logic in `collectFiles` exactly so the UI's
    // "scanned" badge matches reality. Order: explicit exclude wins,
    // then explicit include, then depth + code-project guard.
    const wouldScan = !explicitlyExcluded && (
      explicitlyIncluded || (maxDepth >= 1 && !isCodeProject)
    );

    info.push({
      path: fullPath,
      name: entry.name,
      scanned: wouldScan,
      isCodeProject,
    });
  }

  // Sort for stable UI rendering — alphabetical, case-insensitive.
  info.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return info;
}

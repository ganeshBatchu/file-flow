import { loadConfig, saveConfig } from '../config/index.js';
import { buildCorpusTFIDF } from './tfidf.js';
import { tokenize } from './tokenizer.js';
import { extractContent } from '../extractor/index.js';
import { KMeansClusterer, computeCentroid, extractClusterKeywords, suggestCategoryNames } from './clustering.js';
import { detectCourseForFile, buildExtraDepartments } from './course-detector.js';
import { detectFilenameHeuristic } from './filename-heuristics.js';
import { inferCoursesFromSiblings } from './sibling-inference.js';
import type { FileFlowConfig } from '../config/schema.js';

export interface FileInfo {
  path: string;
  tokens?: string[];
}

export interface SuggestedCategory {
  name: string;
  keywords: string[];
  centroid: number[];
  fileCount: number;
  sampleFiles: string[];
}

export class CategoryManager {
  private config: FileFlowConfig;

  constructor(config: FileFlowConfig) {
    this.config = config;
  }

  /**
   * Add or update a category in config.
   */
  async saveCategoryToConfig(
    name: string,
    keywords: string[],
    centroid: number[],
  ): Promise<void> {
    this.config.categories[name] = { keywords, centroid };
    await saveConfig(this.config);
  }

  /**
   * Remove a category from config.
   */
  async removeCategory(name: string): Promise<void> {
    delete this.config.categories[name];
    await saveConfig(this.config);
  }

  /**
   * List all categories.
   */
  listCategories(): string[] {
    return Object.keys(this.config.categories);
  }

  /**
   * Run the full TF-IDF + k-means pipeline to suggest categories from files.
   *
   * Course numbers (e.g. "CS 3100", "MATH 1365") take priority: any file whose
   * content or filename matches a course pattern is grouped into a course-based
   * suggestion with no keywords required. Remaining files fall through to the
   * TF-IDF + k-means clustering pipeline.
   *
   * @param onProgress  Optional callback fired at the start of each file's
   *                    Phase-1 extraction. Used to drive a UI progress bar.
   *                    `current` is the 1-indexed file number being processed.
   */
  async suggestCategories(
    files: FileInfo[],
    k: number = 5,
    onProgress?: (current: number, total: number, currentFile: string) => void,
  ): Promise<SuggestedCategory[]> {
    if (files.length === 0) return [];

    // ── Phase 1: extract text + run course detection on each file ─────────
    // Files that match a course number are grouped by course and produce
    // course-based suggestions. Remaining files fall through to filename
    // heuristics (Personal / Build Logs) and then TF-IDF clustering.
    const courseGroups = new Map<string, string[]>();
    const heuristicGroups = new Map<string, string[]>();
    const nonCourseTokens: string[][] = [];
    const nonCourseFiles: string[] = [];
    const extraDepts = buildExtraDepartments(this.config.course_departments);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i + 1, files.length, file.path);
      try {
        let tokens: string[];
        let text = '';
        if (file.tokens) {
          tokens = file.tokens;
          // No text available for course detection when tokens pre-supplied;
          // fall back to filename-only detection by passing empty text.
        } else {
          const extracted = await extractContent(file.path, this.config.max_file_size_mb);
          text = extracted.text;
          tokens = tokenize(text);
        }

        // Course detection: filename + text content
        const course = detectCourseForFile(text, file.path, extraDepts);
        if (course) {
          const existing = courseGroups.get(course) ?? [];
          existing.push(file.path);
          courseGroups.set(course, existing);
          continue;
        }

        // Filename-only heuristic (Resume/CV, CI build logs). High-precision
        // exact-keyword match — only fires when the filename is obviously
        // one of these categories.
        const heuristicCategory = detectFilenameHeuristic(file.path);
        if (heuristicCategory) {
          const existing = heuristicGroups.get(heuristicCategory) ?? [];
          existing.push(file.path);
          heuristicGroups.set(heuristicCategory, existing);
          continue;
        }

        if (tokens.length > 0) {
          nonCourseTokens.push(tokens);
          nonCourseFiles.push(file.path);
        }
      } catch {
        // Skip files that fail extraction
      }
    }

    // ── Sibling-folder inference ──────────────────────────────────────────
    // Pull still-unclassified files into an existing course group when ≥2 of
    // their batch peers routed to the same course AND they share a leading
    // numeric token (e.g. "1365-notes-template-*.pdf" → MATH 1365).
    if (courseGroups.size > 0 && nonCourseFiles.length > 0) {
      const routedCourses: { srcPath: string; courseName: string }[] = [];
      for (const [courseName, filePaths] of courseGroups) {
        for (const fp of filePaths) routedCourses.push({ srcPath: fp, courseName });
      }

      const siblingMatches = inferCoursesFromSiblings({
        routedCourses,
        unclassifiedPaths: nonCourseFiles,
      });

      if (siblingMatches.length > 0) {
        const matched = new Set(siblingMatches.map((m) => m.srcPath));
        // Remove the matched files from the non-course pool (keep tokens and
        // file paths in sync).
        const keptTokens: string[][] = [];
        const keptFiles: string[] = [];
        for (let i = 0; i < nonCourseFiles.length; i++) {
          if (matched.has(nonCourseFiles[i])) continue;
          keptTokens.push(nonCourseTokens[i]);
          keptFiles.push(nonCourseFiles[i]);
        }
        nonCourseTokens.length = 0;
        nonCourseFiles.length = 0;
        nonCourseTokens.push(...keptTokens);
        nonCourseFiles.push(...keptFiles);

        // Fold the sibling matches into the existing course groups.
        for (const m of siblingMatches) {
          const existing = courseGroups.get(m.courseName) ?? [];
          existing.push(m.srcPath);
          courseGroups.set(m.courseName, existing);
        }
      }
    }

    const suggestions: SuggestedCategory[] = [];

    // ── Phase 2a: emit one suggestion per detected course ─────────────────
    // Course categories don't need keywords — the course number regex is
    // sufficient to match future files. We store an empty centroid because
    // classification falls through to course detection before TF-IDF.
    for (const [courseName, filePaths] of courseGroups) {
      suggestions.push({
        name: courseName,
        keywords: [],
        centroid: [],
        fileCount: filePaths.length,
        sampleFiles: filePaths.slice(0, 3),
      });
    }

    // ── Phase 2b: emit one suggestion per filename-heuristic match ────────
    // Same shape as courses — no keywords required, classification is via
    // the filename regex at organize-time.
    for (const [heuristicName, filePaths] of heuristicGroups) {
      suggestions.push({
        name: heuristicName,
        keywords: [],
        centroid: [],
        fileCount: filePaths.length,
        sampleFiles: filePaths.slice(0, 3),
      });
    }

    // ── Phase 3: TF-IDF + k-means on remaining (non-course) files ─────────
    if (nonCourseTokens.length === 0) return suggestions;

    const { vectors } = buildCorpusTFIDF(nonCourseTokens);

    const numClusters = Math.min(k, Math.max(1, Math.floor(nonCourseFiles.length / 2)));
    const clusterer = new KMeansClusterer(numClusters);
    const result = clusterer.cluster(vectors);

    // Group files by cluster
    const clusterFiles: string[][] = Array.from({ length: numClusters }, () => []);
    const clusterVectors: Map<string, number>[][] = Array.from(
      { length: numClusters },
      () => [],
    );

    for (let i = 0; i < result.assignments.length; i++) {
      const clusterIdx = result.assignments[i];
      clusterFiles[clusterIdx].push(nonCourseFiles[i]);
      clusterVectors[clusterIdx].push(vectors[i]);
    }

    const topKeywordsPerCluster = clusterVectors.map((vecs) =>
      extractClusterKeywords(vecs, 10),
    );
    const names = suggestCategoryNames(clusterVectors, topKeywordsPerCluster);

    for (let i = 0; i < numClusters; i++) {
      if (clusterFiles[i].length === 0) continue;

      const keywords = topKeywordsPerCluster[i].slice(0, 10);
      const centroidMap = computeCentroid(clusterVectors[i]);
      const centroidValues = keywords.map((kw) => centroidMap.get(kw) ?? 0);

      suggestions.push({
        name: names[i],
        keywords,
        centroid: centroidValues,
        fileCount: clusterFiles[i].length,
        sampleFiles: clusterFiles[i].slice(0, 3),
      });
    }

    return suggestions;
  }
}

/**
 * Compute the centroid of a set of vectors and align it with keyword terms.
 */
export function computeAlignedCentroid(
  vectors: Map<string, number>[],
  keywords: string[],
): number[] {
  const centroidMap = computeCentroid(vectors);
  return keywords.map((kw) => centroidMap.get(kw) ?? 0);
}

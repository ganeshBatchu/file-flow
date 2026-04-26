import path from 'path';

/**
 * Sibling-folder / batch-context inference.
 *
 * Some files can't be classified on their own (text extraction fails, or the
 * course code appears only as a bare number like "1365" without a department
 * prefix). But if the same batch *also* contains files that DID route to a
 * course folder, and those files share a common prefix / token with the
 * unclassified file, we can piggyback.
 *
 * Example:
 *   Batch contains "MATH 1365 Syllabus.pdf" → routes to MATH 1365.
 *   Batch also contains "1365-notes-template-01.pdf", "1365-exam1.pdf".
 *   These three share the number "1365" — so we route the notes + exam to
 *   MATH 1365 too.
 *
 * This runs as a post-pass after per-file classification, so it only fires on
 * files that otherwise would have been quarantined.
 */

/**
 * Extract a numeric identifier from the start of a filename.
 * Returns e.g. "1365" for "1365-notes-template.pdf" or null if the filename
 * doesn't begin with a digit run.
 */
function leadingNumericToken(filename: string): string | null {
  const m = filename.match(/^(\d{3,4})(?:[^0-9]|$)/);
  return m ? m[1] : null;
}

/**
 * Extract the numeric part (e.g. "1365") from a canonical course name like
 * "MATH 1365".
 */
function courseNumber(courseName: string): string | null {
  const m = courseName.match(/\b(\d{3,4})\b/);
  return m ? m[1] : null;
}

export interface SiblingInferenceInput {
  /** Files that were successfully routed to a course folder. */
  routedCourses: { srcPath: string; courseName: string }[];
  /** Files that weren't routed — candidates for sibling inference. */
  unclassifiedPaths: string[];
  /** Minimum number of already-routed siblings before we accept a match. */
  minSiblings?: number;
}

export interface SiblingMatch {
  srcPath: string;
  courseName: string;
  siblingCount: number;
}

/**
 * Given a set of files that routed successfully to course folders and a set
 * of unclassified files, return inferred course routings for the unclassified
 * ones based on shared numeric tokens.
 *
 * Requires at least `minSiblings` (default 2) already-routed files in the
 * same batch to share the course number — this prevents a lone false-positive
 * from dragging unrelated files along.
 */
export function inferCoursesFromSiblings({
  routedCourses,
  unclassifiedPaths,
  minSiblings = 2,
}: SiblingInferenceInput): SiblingMatch[] {
  if (routedCourses.length === 0 || unclassifiedPaths.length === 0) return [];

  // Build map: numeric token → { courseName, count }. If the same number maps
  // to multiple course names (unlikely but possible), drop it — it's ambiguous.
  const numberToCourse = new Map<string, { courseName: string; count: number }>();
  const ambiguousNumbers = new Set<string>();

  for (const { courseName } of routedCourses) {
    const num = courseNumber(courseName);
    if (!num) continue;
    const existing = numberToCourse.get(num);
    if (existing) {
      if (existing.courseName !== courseName) {
        ambiguousNumbers.add(num);
      } else {
        existing.count += 1;
      }
    } else {
      numberToCourse.set(num, { courseName, count: 1 });
    }
  }

  const matches: SiblingMatch[] = [];
  for (const fp of unclassifiedPaths) {
    const filename = path.basename(fp);
    const num = leadingNumericToken(filename);
    if (!num) continue;
    if (ambiguousNumbers.has(num)) continue;

    const entry = numberToCourse.get(num);
    if (!entry) continue;
    if (entry.count < minSiblings) continue;

    matches.push({
      srcPath: fp,
      courseName: entry.courseName,
      siblingCount: entry.count,
    });
  }

  return matches;
}

// ────────────────────────────────────────────────────────────────────────────
// Generic (non-course) sibling inference
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strip the extension and split a filename into tokens by common separators.
 * Returns lowercased alphabetic tokens of length ≥ 3 (ignoring 1-2 char and
 * pure-digit tokens, which carry little discriminating signal).
 */
function filenameTokens(filename: string): string[] {
  const stem = filename.replace(/\.[^.]+$/, '').toLowerCase();
  return stem
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && /[a-z]/.test(t));
}

export interface CategorySiblingInput {
  /** Files that were successfully routed to a non-course category. */
  routedToCategory: { srcPath: string; category: string }[];
  /** Files that weren't routed — candidates for sibling inference. */
  unclassifiedPaths: string[];
  /**
   * Minimum number of already-routed siblings that must share a filename token
   * with the candidate before we accept the inference. Default 3 — higher than
   * course inference because non-course categories are softer signals.
   */
  minSiblings?: number;
  /**
   * Minimum number of distinct filename tokens that must overlap between a
   * candidate and the already-routed siblings. Default 1 — a single shared
   * non-trivial token already implies a strong batch relationship.
   */
  minTokenOverlap?: number;
}

export interface CategorySiblingMatch {
  srcPath: string;
  category: string;
  /** How many already-routed peers share at least one filename token. */
  siblingCount: number;
}

/**
 * Pull unclassified files into an existing non-course category if a critical
 * mass of their batch peers (≥ `minSiblings`) routed there AND share at least
 * `minTokenOverlap` filename token(s) with the candidate.
 *
 * Differs from course inference in two ways:
 *   - Matches by ANY shared filename token, not just a numeric course code.
 *   - Requires more peers (default 3) since non-course matches are softer.
 *
 * Disambiguation: if a candidate matches multiple categories via different
 * peer sets, the category with the highest peer-overlap count wins; ties are
 * broken alphabetically by category name (deterministic).
 */
export function inferCategoriesFromSiblings({
  routedToCategory,
  unclassifiedPaths,
  minSiblings = 3,
  minTokenOverlap = 1,
}: CategorySiblingInput): CategorySiblingMatch[] {
  if (routedToCategory.length === 0 || unclassifiedPaths.length === 0) return [];

  // For each category, build the set of filename tokens from its routed files.
  const categoryTokens = new Map<string, Map<string, number>>(); // cat → token → count
  for (const { srcPath, category } of routedToCategory) {
    let tokenCounts = categoryTokens.get(category);
    if (!tokenCounts) {
      tokenCounts = new Map();
      categoryTokens.set(category, tokenCounts);
    }
    for (const tok of filenameTokens(path.basename(srcPath))) {
      tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1);
    }
  }

  const matches: CategorySiblingMatch[] = [];
  for (const fp of unclassifiedPaths) {
    const candidateTokens = new Set(filenameTokens(path.basename(fp)));
    if (candidateTokens.size === 0) continue;

    let bestCat: string | null = null;
    let bestCount = 0;

    for (const [category, tokenCounts] of categoryTokens) {
      // Count distinct tokens shared between candidate and the routed peers.
      let overlap = 0;
      let peerSupport = 0;
      for (const tok of candidateTokens) {
        const peers = tokenCounts.get(tok);
        if (peers !== undefined && peers >= minSiblings) {
          overlap++;
          peerSupport = Math.max(peerSupport, peers);
        }
      }
      if (overlap < minTokenOverlap) continue;
      if (
        peerSupport > bestCount ||
        (peerSupport === bestCount && bestCat !== null && category < bestCat)
      ) {
        bestCount = peerSupport;
        bestCat = category;
      }
    }

    if (bestCat) {
      matches.push({ srcPath: fp, category: bestCat, siblingCount: bestCount });
    }
  }

  return matches;
}

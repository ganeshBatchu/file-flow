import type { FileFlowConfig } from '../config/schema.js';

/**
 * Compute cosine similarity between two sparse vectors.
 */
export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  // Compute dot product using the smaller map for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, valA] of smaller) {
    const valB = larger.get(term);
    if (valB !== undefined) {
      dotProduct += valA * valB;
    }
  }

  for (const val of a.values()) magA += val * val;
  for (const val of b.values()) magB += val * val;

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export interface CategoryMatch {
  category: string;
  score: number;
}

/**
 * Find the best matching category for a document vector.
 * Categories are matched using cosine similarity against their centroid vectors.
 */
export function findBestCategory(
  vector: Map<string, number>,
  categories: FileFlowConfig['categories'],
): CategoryMatch | null {
  if (Object.keys(categories).length === 0) return null;

  let best: CategoryMatch | null = null;

  for (const [name, catConfig] of Object.entries(categories)) {
    // Categories without keywords (course/heuristic-only) cannot match here —
    // they're routed by upstream rules (course regex, filename heuristics).
    if (catConfig.keywords.length === 0) continue;

    const keywordScore = scoreAgainstKeywords(vector, catConfig.keywords);
    const centroidScore = scoreAgainstCentroidMap(
      vector,
      catConfig.centroid,
      catConfig.keywords,
    );
    // The two signals are different: keywordScore is coverage-based (% of the
    // category's keywords found in the doc); centroidScore is cosine against
    // the cluster's weighted-keyword centroid. Take the higher of the two so a
    // strong match in either dimension wins.
    const score = Math.max(keywordScore, centroidScore);

    if (best === null || score > best.score) {
      best = { category: name, score };
    }
  }

  return best;
}

/**
 * Coverage-based keyword score.
 *
 * Returns a [0, 1] value computed primarily as the fraction of the category's
 * keywords that appear in the document, with a small density bonus for
 * documents where the matched keywords carry meaningful TF-IDF weight.
 *
 * Why this shape: the previous formula divided summed TF-IDF weights by
 * `keywords.length`, which produced absurdly small numbers (a 1000-token doc
 * has TF≈0.02 per term, so even 5/10 keyword hits scored ~0.05 — well below
 * any reasonable threshold). Switching to coverage gives an intuitive signal:
 * a category with 10 keywords needs ~3 of them in the doc to clear a 0.3
 * threshold.
 */
function scoreAgainstKeywords(
  vector: Map<string, number>,
  keywords: string[],
): number {
  if (keywords.length === 0) return 0;

  let matches = 0;
  let weightSum = 0;

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();
    // Exact stem match. Keywords and document tokens both come through the
    // same Porter stemmer, so substring fallback only introduces noise
    // (e.g. "pk" matching "speak", "ai" matching "main", short stems matching
    // anything). Require an exact stem hit for the match to count.
    const matchedWeight = vector.get(kw);
    if (matchedWeight !== undefined) {
      matches++;
      weightSum += matchedWeight;
    }
  }

  if (matches === 0) return 0;
  const coverage = matches / keywords.length;
  // Density bonus: rewards docs where the matched keywords are TF-prominent.
  // Capped so coverage stays the dominant signal.
  const density = Math.min(0.2, weightSum * 2);
  return Math.min(1, coverage + density);
}

function scoreAgainstCentroidMap(
  vector: Map<string, number>,
  centroid: number[],
  keywords: string[],
): number {
  // Build a keyword-indexed centroid map
  const centroidMap = new Map<string, number>();
  keywords.forEach((kw, idx) => {
    if (idx < centroid.length) {
      centroidMap.set(kw.toLowerCase(), centroid[idx]);
    }
  });

  return cosineSimilarity(vector, centroidMap);
}

/**
 * Check if a confidence score is above the configured threshold.
 */
export function isAboveThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}

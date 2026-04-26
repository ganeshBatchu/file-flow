/**
 * TF-IDF implementation using sparse vectors (Map<string, number>)
 */

/**
 * Compute normalized term frequency for a list of tokens.
 * TF(t, d) = count(t in d) / total_terms(d)
 */
export function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  if (tokens.length === 0) return tf;

  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const total = tokens.length;
  for (const [term, count] of tf) {
    tf.set(term, count / total);
  }

  return tf;
}

/**
 * Compute inverse document frequency for a corpus.
 * IDF(t) = log((N+1) / (df+1)) + 1  (smoothed)
 * @param corpus  Array of document TF maps
 * @param vocabSize  Total vocabulary size (unused here but available for normalization)
 */
export function computeIDF(
  corpus: Map<string, number>[],
  _vocabSize?: number,
): Map<string, number> {
  const idf = new Map<string, number>();
  const N = corpus.length;
  if (N === 0) return idf;

  // Count document frequency for each term
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const term of doc.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Compute IDF with smoothing
  for (const [term, docCount] of df) {
    idf.set(term, Math.log((N + 1) / (docCount + 1)) + 1);
  }

  return idf;
}

/**
 * Compute TF-IDF sparse vector from TF and IDF maps.
 */
export function computeTFIDF(
  tf: Map<string, number>,
  idf: Map<string, number>,
): Map<string, number> {
  const tfidf = new Map<string, number>();

  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) ?? 1.0;
    tfidf.set(term, tfVal * idfVal);
  }

  return tfidf;
}

/**
 * Build TF-IDF vectors for an entire corpus.
 * Returns both the IDF map and per-document TF-IDF vectors.
 */
export function buildCorpusTFIDF(tokenArrays: string[][]): {
  idf: Map<string, number>;
  vectors: Map<string, number>[];
} {
  const tfMaps = tokenArrays.map(computeTF);
  const idf = computeIDF(tfMaps);
  const vectors = tfMaps.map((tf) => computeTFIDF(tf, idf));

  return { idf, vectors };
}

/**
 * Normalize a vector to unit length (L2 normalization).
 */
export function normalizeVector(vec: Map<string, number>): Map<string, number> {
  let magnitude = 0;
  for (const val of vec.values()) {
    magnitude += val * val;
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return new Map(vec);

  const normalized = new Map<string, number>();
  for (const [term, val] of vec) {
    normalized.set(term, val / magnitude);
  }
  return normalized;
}

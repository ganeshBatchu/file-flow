import { cosineSimilarity } from './confidence.js';

export interface ClusterResult {
  centroids: Map<string, number>[];
  assignments: number[];
  iterations: number;
}

/**
 * K-means clustering using cosine distance (1 - cosine similarity).
 */
export class KMeansClusterer {
  private k: number;
  private maxIterations: number;

  constructor(k: number, maxIterations: number = 100) {
    this.k = k;
    this.maxIterations = maxIterations;
  }

  /**
   * Cluster a set of TF-IDF vectors.
   */
  cluster(vectors: Map<string, number>[]): ClusterResult {
    if (vectors.length === 0) {
      return { centroids: [], assignments: [], iterations: 0 };
    }

    const k = Math.min(this.k, vectors.length);

    // Random initialization: pick k random vectors as initial centroids
    let centroids = this.randomInit(vectors, k);
    let assignments = new Array(vectors.length).fill(0);
    let iter = 0;

    for (iter = 0; iter < this.maxIterations; iter++) {
      // Assignment step
      const newAssignments = vectors.map((vec) =>
        this.findNearestCentroid(vec, centroids),
      );

      // Check convergence
      const converged = newAssignments.every((a, i) => a === assignments[i]);
      assignments = newAssignments;

      // Update step: recompute centroids
      const newCentroids = this.updateCentroids(vectors, assignments, k);
      centroids = newCentroids;

      if (converged) break;
    }

    return { centroids, assignments, iterations: iter };
  }

  private randomInit(
    vectors: Map<string, number>[],
    k: number,
  ): Map<string, number>[] {
    const indices = new Set<number>();
    while (indices.size < k) {
      indices.add(Math.floor(Math.random() * vectors.length));
    }
    return [...indices].map((i) => new Map(vectors[i]));
  }

  private findNearestCentroid(
    vec: Map<string, number>,
    centroids: Map<string, number>[],
  ): number {
    let bestIdx = 0;
    let bestSim = -Infinity;

    for (let i = 0; i < centroids.length; i++) {
      const sim = cosineSimilarity(vec, centroids[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    return bestIdx;
  }

  private updateCentroids(
    vectors: Map<string, number>[],
    assignments: number[],
    k: number,
  ): Map<string, number>[] {
    const clusters: Map<string, number>[][] = Array.from({ length: k }, () => []);

    for (let i = 0; i < vectors.length; i++) {
      const clusterIdx = assignments[i];
      clusters[clusterIdx].push(vectors[i]);
    }

    return clusters.map((cluster, idx) => {
      if (cluster.length === 0) {
        // Empty cluster: reinitialize with a random vector
        const randomIdx = Math.floor(Math.random() * vectors.length);
        return new Map(vectors[randomIdx]);
      }
      return computeCentroid(cluster);
    });
  }
}

/**
 * Compute the centroid (average) of a set of sparse vectors.
 */
export function computeCentroid(
  vectors: Map<string, number>[],
): Map<string, number> {
  if (vectors.length === 0) return new Map();

  const sum = new Map<string, number>();

  for (const vec of vectors) {
    for (const [term, val] of vec) {
      sum.set(term, (sum.get(term) ?? 0) + val);
    }
  }

  const centroid = new Map<string, number>();
  for (const [term, total] of sum) {
    centroid.set(term, total / vectors.length);
  }

  return centroid;
}

/**
 * Extract the top-N keywords from a cluster's centroid or summed vector.
 * @param cluster  Array of vectors in the cluster
 * @param topN  Number of keywords to return
 */
export function extractClusterKeywords(
  cluster: Map<string, number>[],
  topN: number,
): string[] {
  if (cluster.length === 0) return [];

  const sum = new Map<string, number>();
  for (const vec of cluster) {
    for (const [term, val] of vec) {
      sum.set(term, (sum.get(term) ?? 0) + val);
    }
  }

  return [...sum.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term]) => term);
}

/**
 * Suggest category folder names based on top cluster keywords.
 */
export function suggestCategoryNames(
  clusters: Map<string, number>[][],
  topKeywordsPerCluster: string[][],
): string[] {
  return topKeywordsPerCluster.map((keywords, idx) => {
    if (keywords.length === 0) return `Category_${idx + 1}`;

    // Use the top 2 keywords joined with underscore, capitalized
    const name = keywords
      .slice(0, 2)
      .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
      .join('_');

    return name;
  });
}

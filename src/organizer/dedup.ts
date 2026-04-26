import fs from 'fs';
import crypto from 'crypto';

export interface HashCache {
  [filePath: string]: { hash: string; mtime: number };
}

/**
 * Compute SHA-256 hash of a file's contents.
 */
export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Load the hash cache from disk. Returns empty object if missing or invalid.
 */
export function loadHashCache(cachePath: string): HashCache {
  try {
    if (!fs.existsSync(cachePath)) return {};
    const raw = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw) as HashCache;
  } catch {
    return {};
  }
}

/**
 * Save the hash cache to disk.
 */
export function saveHashCache(cachePath: string, cache: HashCache): void {
  const dir = cachePath.substring(0, cachePath.lastIndexOf('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Get the hash of a file, using and updating the cache.
 * Cache entries are invalidated when mtime changes.
 */
export function getCachedHash(
  filePath: string,
  cache: HashCache,
): string {
  try {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const cached = cache[filePath];

    if (cached && cached.mtime === mtime) {
      return cached.hash;
    }

    const hash = hashFile(filePath);
    cache[filePath] = { hash, mtime };
    return hash;
  } catch {
    return '';
  }
}

export interface DuplicateGroup {
  hash: string;
  files: string[];
}

/**
 * Find duplicate files among a list of paths.
 * Returns groups of files that share the same content hash.
 */
export function findDuplicates(
  filePaths: string[],
  cache: HashCache,
): DuplicateGroup[] {
  const hashToFiles = new Map<string, string[]>();

  for (const filePath of filePaths) {
    const hash = getCachedHash(filePath, cache);
    if (!hash) continue;

    const existing = hashToFiles.get(hash);
    if (existing) {
      existing.push(filePath);
    } else {
      hashToFiles.set(hash, [filePath]);
    }
  }

  return [...hashToFiles.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([hash, files]) => ({ hash, files }));
}

/**
 * Check if two files have identical content.
 */
export function areIdentical(
  pathA: string,
  pathB: string,
  cache: HashCache,
): boolean {
  const hashA = getCachedHash(pathA, cache);
  const hashB = getCachedHash(pathB, cache);
  return hashA !== '' && hashA === hashB;
}

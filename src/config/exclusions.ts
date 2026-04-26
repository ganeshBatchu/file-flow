import picomatch from 'picomatch';
import path from 'path';

/**
 * Check if a file path should be excluded based on the given patterns.
 * @param filePath  Absolute path to the file
 * @param patterns  List of glob/picomatch patterns
 * @param baseDir   Base directory to resolve relative matches against
 */
export function isExcluded(
  filePath: string,
  patterns: string[],
  baseDir: string,
): boolean {
  if (patterns.length === 0) return false;

  const relativePath = path.relative(baseDir, filePath);
  const baseName = path.basename(filePath);

  for (const pattern of patterns) {
    // Match against full relative path, just the basename, and any segment
    const matchRelative = picomatch(pattern, { dot: true });
    const matchBase = picomatch(pattern, { dot: true, basename: true });

    if (
      matchRelative(relativePath) ||
      matchBase(baseName) ||
      matchRelative(filePath)
    ) {
      return true;
    }

    // Check if any path component matches a directory pattern like "node_modules"
    const parts = relativePath.split(path.sep);
    for (const part of parts) {
      if (matchBase(part)) {
        return true;
      }
    }
  }

  return false;
}

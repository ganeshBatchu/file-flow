import fs from 'fs';
import path from 'path';

/**
 * Resolve a filename collision by appending an incrementing suffix.
 * Returns the destination path that doesn't conflict:
 *   file.pdf → file_1.pdf → file_2.pdf
 */
export function resolveConflict(destPath: string): string {
  if (!fs.existsSync(destPath)) return destPath;

  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);

  let counter = 1;
  let candidate: string;
  do {
    candidate = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  } while (fs.existsSync(candidate));

  return candidate;
}

/**
 * Check if a proposed move would collide with an existing file.
 */
export function wouldCollide(destPath: string): boolean {
  return fs.existsSync(destPath);
}

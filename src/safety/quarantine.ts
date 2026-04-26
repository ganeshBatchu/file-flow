import fs from 'fs';
import path from 'path';
import { moveFile } from '../organizer/mover.js';
import type { FileFlowConfig } from '../config/schema.js';
import type { HashCache } from '../organizer/dedup.js';

/**
 * Get the absolute path to the quarantine (Uncategorized) folder
 * relative to the given watch directory.
 */
export function getQuarantineDir(watchDir: string, config: FileFlowConfig): string {
  return path.join(watchDir, config.uncategorized_folder);
}

/**
 * Move a file to the Uncategorized folder.
 */
export async function quarantineFile(
  srcPath: string,
  watchDir: string,
  config: FileFlowConfig,
  cache: HashCache,
  closestCategory?: string,
  confidence?: number,
): Promise<string> {
  const quarantineDir = getQuarantineDir(watchDir, config);
  const result = await moveFile(srcPath, quarantineDir, config, cache, 'Uncategorized', confidence);
  return result.to;
}

export interface QuarantinedFile {
  path: string;
  filename: string;
  size: number;
  mtime: Date;
}

/**
 * List all files currently in the quarantine folder.
 */
export function listQuarantined(watchDir: string, config: FileFlowConfig): QuarantinedFile[] {
  const quarantineDir = getQuarantineDir(watchDir, config);
  const results: QuarantinedFile[] = [];

  if (!fs.existsSync(quarantineDir)) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(quarantineDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(quarantineDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      results.push({
        path: fullPath,
        filename: entry.name,
        size: stat.size,
        mtime: stat.mtime,
      });
    } catch {
      // Skip files we can't stat
    }
  }

  return results;
}

/**
 * Resolve a quarantined file by moving it to the chosen category folder.
 */
export async function resolveQuarantined(
  quarantinedPath: string,
  categoryName: string,
  watchDir: string,
  config: FileFlowConfig,
  cache: HashCache,
): Promise<string> {
  const destDir = path.join(watchDir, categoryName);
  const result = await moveFile(quarantinedPath, destDir, config, cache, categoryName, 1.0);
  return result.to;
}

/**
 * Delete a quarantined file.
 */
export function deleteQuarantined(filePath: string): void {
  fs.unlinkSync(filePath);
}

import fs from 'fs';
import path from 'path';
import { resolveConflict, wouldCollide } from './conflict.js';
import { areIdentical, type HashCache } from './dedup.js';
import { appendJournalEntry, type JournalOperation } from '../safety/journal.js';
import type { FileFlowConfig } from '../config/schema.js';

export interface MoveResult {
  from: string;
  to: string;
  action: 'moved' | 'skipped-duplicate' | 'conflict-resolved';
  resolvedPath?: string;
}

/**
 * Atomically move a file to destDir, resolving conflicts and logging to journal.
 */
export async function moveFile(
  srcPath: string,
  destDir: string,
  config: FileFlowConfig,
  cache: HashCache,
  category?: string,
  confidence?: number,
): Promise<MoveResult> {
  const filename = path.basename(srcPath);
  const rawDest = path.join(destDir, filename);

  const ops: JournalOperation[] = [];

  // Ensure destination directory exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    ops.push({ type: 'mkdir', path: destDir });
  }

  let destPath = rawDest;
  let action: MoveResult['action'] = 'moved';

  if (wouldCollide(destPath)) {
    // If files are identical, skip the move
    if (areIdentical(srcPath, destPath, cache)) {
      return { from: srcPath, to: destPath, action: 'skipped-duplicate' };
    }

    // Otherwise resolve the collision
    destPath = resolveConflict(destPath);
    action = 'conflict-resolved';
  }

  // Attempt atomic rename; fall back to copy+delete for cross-device moves
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      // Cross-device link: copy then delete
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    } else {
      throw err;
    }
  }

  ops.push({ type: 'move', from: srcPath, to: destPath });
  appendJournalEntry(
    config.journal_path,
    ops,
    config.max_journal_entries,
    category,
    confidence,
  );

  return {
    from: srcPath,
    to: destPath,
    action,
    ...(action === 'conflict-resolved' && { resolvedPath: destPath }),
  };
}

export interface OrganizeResult {
  moved: MoveResult[];
  errors: { path: string; error: string }[];
}

/**
 * Organize a batch of files into their respective category directories.
 */
export async function organizeFiles(
  moves: { srcPath: string; destDir: string; category: string; confidence: number }[],
  config: FileFlowConfig,
  cache: HashCache,
): Promise<OrganizeResult> {
  const result: OrganizeResult = { moved: [], errors: [] };

  for (const { srcPath, destDir, category, confidence } of moves) {
    try {
      const moveResult = await moveFile(srcPath, destDir, config, cache, category, confidence);
      result.moved.push(moveResult);
    } catch (err) {
      result.errors.push({
        path: srcPath,
        error: (err as Error).message,
      });
    }
  }

  return result;
}

import fs from 'fs';
import {
  loadJournal,
  removeJournalEntry,
  saveJournal,
  type JournalEntry,
  type JournalOperation,
} from '../safety/journal.js';

export interface UndoResult {
  entryId: string;
  reversed: string[];
  errors: { path: string; error: string }[];
}

/**
 * Reverse a single journal operation in-place on the filesystem. Pushes a
 * message into `reversed` on success, or an error record into `errors`.
 *
 * Returns true if the operation was fully reversed (so the caller can decide
 * whether to keep it in the journal). A no-op reversal (e.g. the file was
 * already moved away manually) also counts as "reversed" — we don't want to
 * block the user from pruning entries whose targets have vanished.
 */
function reverseOperation(
  op: JournalOperation,
  reversed: string[],
  errors: { path: string; error: string }[],
): boolean {
  try {
    if (op.type === 'move' && op.from && op.to) {
      const destDir = op.from.substring(0, op.from.lastIndexOf('/'));
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      if (fs.existsSync(op.to)) {
        fs.renameSync(op.to, op.from);
        reversed.push(`Restored ${op.to} → ${op.from}`);
      }
      return true;
    }
    if (op.type === 'mkdir' && op.path) {
      // Remove directory only if empty
      try {
        if (fs.existsSync(op.path)) {
          const contents = fs.readdirSync(op.path);
          if (contents.length === 0) {
            fs.rmdirSync(op.path);
            reversed.push(`Removed empty dir ${op.path}`);
          }
        }
      } catch {
        // Non-empty directories are left in place — still a "success"
      }
      return true;
    }
    if (op.type === 'delete' && op.path) {
      errors.push({ path: op.path, error: 'Cannot undo delete: file is permanently removed' });
      return false;
    }
    if (op.type === 'copy' && op.to) {
      if (fs.existsSync(op.to)) {
        fs.unlinkSync(op.to);
        reversed.push(`Removed copy ${op.to}`);
      }
      return true;
    }
  } catch (err) {
    const p = op.to ?? op.from ?? op.path ?? '?';
    errors.push({ path: p, error: (err as Error).message });
    return false;
  }
  return true;
}

/**
 * Undo a single journal entry by reversing each operation in reverse order.
 */
export async function undoEntry(
  entry: JournalEntry,
  journalPath: string,
): Promise<UndoResult> {
  const reversed: string[] = [];
  const errors: { path: string; error: string }[] = [];

  // Process operations in reverse order
  for (const op of [...entry.operations].reverse()) {
    reverseOperation(op, reversed, errors);
  }

  // Remove entry from journal only if all operations succeeded
  if (errors.length === 0) {
    removeJournalEntry(journalPath, entry.id);
  }

  return { entryId: entry.id, reversed, errors };
}

/**
 * Undo a specific subset of operations within a journal entry.
 *
 * Operations are identified by their index in `entry.operations` (the same
 * order the UI renders them). Reversals run in reverse numerical index order
 * so dependent operations inside the same entry unwind safely.
 *
 * Journal semantics:
 *   • If ALL operations succeed and we reversed the whole entry, the entry
 *     is removed.
 *   • If some operations were only partially requested OR some failed, the
 *     entry is rewritten in place with the successfully-reversed operations
 *     stripped out — everything else is preserved so the user can still undo
 *     the rest later.
 */
export async function undoOperations(
  entryId: string,
  operationIndices: number[],
  journalPath: string,
): Promise<UndoResult | null> {
  const entries = loadJournal(journalPath);
  const entryIdx = entries.findIndex((e) => e.id === entryId);
  if (entryIdx === -1) return null;
  const entry = entries[entryIdx];

  const reversed: string[] = [];
  const errors: { path: string; error: string }[] = [];
  const successfullyReversed = new Set<number>();

  // Dedupe, bounds-check, reverse-order for dependent ops (e.g. move then mkdir)
  const uniqueIndices = [...new Set(operationIndices)]
    .filter((i) => i >= 0 && i < entry.operations.length)
    .sort((a, b) => b - a);

  for (const i of uniqueIndices) {
    const before = reversed.length;
    const ok = reverseOperation(entry.operations[i], reversed, errors);
    // Only mark for removal if the filesystem change succeeded AND the
    // reversal either did something visible or was a valid no-op (delete's
    // the only case that returns false on "permanent" failure).
    if (ok && reversed.length > before) {
      successfullyReversed.add(i);
    }
  }

  // Rewrite the journal entry, filtering out successfully-reversed operations.
  const remaining = entry.operations.filter((_, i) => !successfullyReversed.has(i));
  if (remaining.length === 0) {
    // Entry fully unwound — drop it.
    removeJournalEntry(journalPath, entry.id);
  } else {
    entries[entryIdx] = { ...entry, operations: remaining };
    saveJournal(journalPath, entries);
  }

  return { entryId: entry.id, reversed, errors };
}

/**
 * Undo the most recent journal entry.
 */
export async function undoLast(journalPath: string): Promise<UndoResult | null> {
  const entries = loadJournal(journalPath);
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1];
  return undoEntry(last, journalPath);
}

/**
 * Undo all entries in a batch (same operation id prefix or timestamp range).
 */
export async function undoById(
  entryId: string,
  journalPath: string,
): Promise<UndoResult | null> {
  const entries = loadJournal(journalPath);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return null;
  return undoEntry(entry, journalPath);
}

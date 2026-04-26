import fs from 'fs';
import path from 'path';

export type OperationType = 'move' | 'mkdir' | 'delete' | 'copy';

export interface JournalOperation {
  type: OperationType;
  from?: string;
  to?: string;
  path?: string;
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  operations: JournalOperation[];
  category?: string;
  confidence?: number;
}

/**
 * Load the journal from disk. Returns empty array if missing or invalid.
 */
export function loadJournal(journalPath: string): JournalEntry[] {
  try {
    if (!fs.existsSync(journalPath)) return [];
    const raw = fs.readFileSync(journalPath, 'utf-8');
    return JSON.parse(raw) as JournalEntry[];
  } catch {
    return [];
  }
}

/**
 * Save the journal to disk, trimming to maxEntries if necessary.
 */
export function saveJournal(
  journalPath: string,
  entries: JournalEntry[],
  maxEntries: number = 500,
): void {
  const trimmed =
    entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries;
  const dir = path.dirname(journalPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(journalPath, JSON.stringify(trimmed, null, 2), 'utf-8');
}

/**
 * Append a new entry to the journal.
 */
export function appendJournalEntry(
  journalPath: string,
  operations: JournalOperation[],
  maxEntries: number = 500,
  category?: string,
  confidence?: number,
): JournalEntry {
  const entries = loadJournal(journalPath);
  const entry: JournalEntry = {
    id: `op_${new Date().toISOString()}`,
    timestamp: new Date().toISOString(),
    operations,
    ...(category !== undefined && { category }),
    ...(confidence !== undefined && { confidence }),
  };
  entries.push(entry);
  saveJournal(journalPath, entries, maxEntries);
  return entry;
}

/**
 * Remove a journal entry by ID.
 */
export function removeJournalEntry(journalPath: string, id: string): void {
  const entries = loadJournal(journalPath);
  const filtered = entries.filter((e) => e.id !== id);
  saveJournal(journalPath, filtered);
}

/**
 * Query journal entries with optional filters.
 */
export function queryJournal(
  journalPath: string,
  opts: {
    category?: string;
    fromDate?: Date;
    toDate?: Date;
    operationType?: OperationType;
    search?: string;
  } = {},
): JournalEntry[] {
  let entries = loadJournal(journalPath);

  if (opts.category) {
    entries = entries.filter((e) => e.category === opts.category);
  }
  if (opts.fromDate) {
    entries = entries.filter((e) => new Date(e.timestamp) >= opts.fromDate!);
  }
  if (opts.toDate) {
    entries = entries.filter((e) => new Date(e.timestamp) <= opts.toDate!);
  }
  if (opts.operationType) {
    entries = entries.filter((e) =>
      e.operations.some((op) => op.type === opts.operationType),
    );
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    entries = entries.filter((e) =>
      e.operations.some(
        (op) =>
          op.from?.toLowerCase().includes(q) ||
          op.to?.toLowerCase().includes(q) ||
          op.path?.toLowerCase().includes(q),
      ),
    );
  }

  return entries;
}

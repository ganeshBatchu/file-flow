import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * General office / knowledge-worker persona pack.
 *
 * The lowest-priority pack — runs after every domain-specific pack has
 * passed. Its job is to provide reasonable artefact-type buckets so even
 * uncategorised business docs (slide decks, spreadsheets, meeting notes,
 * receipts) get a clean home instead of falling all the way through to
 * TF-IDF / Uncategorized.
 *
 * Detection priority within the pack:
 *   1. Meeting-notes filenames + a date token
 *   2. Receipts / invoices
 *   3. Calendar exports (.ics)
 *   4. Artefact-type buckets by extension (Presentations / Spreadsheets /
 *      Documents)
 *
 * Note: PDF is intentionally NOT routed by extension here. The other packs
 * (researcher, lawyer, accountant) handle most PDF cases; whatever falls
 * through goes to TF-IDF where it has a chance of matching a real cluster.
 */

const PRESENTATION_EXTS: ReadonlySet<string> = new Set([
  '.pptx', '.ppt', '.key', '.odp',
]);

const SPREADSHEET_EXTS: ReadonlySet<string> = new Set([
  '.xlsx', '.xls', '.numbers', '.ods',
]);

const DOCUMENT_EXTS: ReadonlySet<string> = new Set([
  '.docx', '.doc', '.pages', '.odt', '.rtf',
]);

// Boundaries: `\b` treats `_` as a word character, so `Invoice_INV-2024` would
// fail `\binvoice\b` (the `e` → `_` transition is not a `\b`). We use
// letter-only lookarounds so the keyword can sit next to digits, underscores,
// or hyphens — which is the norm in business filenames.
const MEETING_KEYWORDS_RE = /(?<![A-Za-z])(meeting|1[\s_\-]?on[\s_\-]?1|1-1|standup|stand[\s_\-]?up|retro|retrospective|planning|kickoff|kick[\s_\-]?off|all[\s_\-]?hands|notes|sync|review)(?![A-Za-z])/i;

const RECEIPT_KEYWORDS_RE = /(?<![A-Za-z])(receipt|invoice|inv[\s_\-]?\d|paid|transaction|order[\s_\-]?confirmation|order[\s_\-]?summary)(?![A-Za-z])/i;

// Date token formats commonly found in filenames. Any one of these qualifies
// a meeting-notes filename for date-bucketing.
const DATE_RES = [
  /\b(20\d{2})[\s_\-](0[1-9]|1[0-2])[\s_\-](0[1-9]|[12]\d|3[01])\b/, // 2024-10-15
  /\b(0[1-9]|1[0-2])[\s_\-](0[1-9]|[12]\d|3[01])[\s_\-](20\d{2})\b/, // 10-15-2024
  /\b(20\d{2})[\s_\-](0[1-9]|1[0-2])\b/,                              // 2024-10
];

/**
 * Pull a `YYYY-MM` from a date-bearing filename. Falls back to year-only if
 * we can detect a year but no month.
 */
function extractMonth(haystack: string): string | null {
  for (const re of DATE_RES) {
    const m = haystack.match(re);
    if (!m) continue;
    // First regex: [_, year, month, day]; second: [_, month, day, year];
    // third: [_, year, month]. Disambiguate by group sizes.
    if (m[1].length === 4) return `${m[1]}-${m[2]}`;
    if (m[3] && m[3].length === 4) return `${m[3]}-${m[1]}`;
  }
  return null;
}

function extractYear(haystack: string): string | null {
  const m = haystack.match(/\b(20\d{2})\b/);
  return m ? m[1] : null;
}

export function classifyGeneralOffice(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  const stem = filename.replace(/\.[^.]+$/, '');
  const ext = path.extname(filename).toLowerCase();

  // ── Meeting notes — keyword + date for high-precision routing ─────────
  if (MEETING_KEYWORDS_RE.test(stem)) {
    const month = extractMonth(filename);
    if (month) {
      return {
        pack: 'general-office',
        category: `Meetings/${month}`,
        confidence: 0.85,
      };
    }
    // Keyword without a date is still informative — flat Meetings folder.
    return {
      pack: 'general-office',
      category: 'Meetings',
      confidence: 0.75,
    };
  }

  // ── Receipts / invoices ──────────────────────────────────────────────
  if (RECEIPT_KEYWORDS_RE.test(stem)) {
    const year = extractYear(filename);
    return {
      pack: 'general-office',
      category: year ? `Receipts/${year}` : 'Receipts',
      confidence: 0.85,
    };
  }

  // ── Calendar exports ─────────────────────────────────────────────────
  if (ext === '.ics' || /\b(meeting[\s_\-]?invite|invitation)\b/i.test(stem)) {
    return {
      pack: 'general-office',
      category: 'Calendar',
      confidence: 0.9,
    };
  }

  // ── Artefact-type buckets — last resort, by extension ────────────────
  if (PRESENTATION_EXTS.has(ext)) {
    return {
      pack: 'general-office',
      category: 'Presentations',
      confidence: 0.75,
    };
  }
  if (SPREADSHEET_EXTS.has(ext)) {
    return {
      pack: 'general-office',
      category: 'Spreadsheets',
      confidence: 0.75,
    };
  }
  if (DOCUMENT_EXTS.has(ext)) {
    return {
      pack: 'general-office',
      category: 'Documents',
      confidence: 0.7,
    };
  }

  return null;
}

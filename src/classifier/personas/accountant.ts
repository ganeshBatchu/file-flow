import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Accountant / finance persona pack.
 *
 * Detection axes (each can yield a routing on its own; together they nest):
 *   • Tax year — usually present in filename (`W2_2024.pdf`)
 *   • Form type — strict regex on US tax form codes
 *   • Statement type — bank / credit card / brokerage / mortgage statements
 *   • Quarter / period — Q1_2024, 2024Q1, 2024-03
 *
 * Folder shapes:
 *   Finance/<Year>/<FormType>/<file>      ← year + form
 *   Finance/Statements/<Year>/<file>      ← statements grouped by year
 *   Finance/<Year>/                       ← year only
 *   Finance/<FormType>/                   ← form, no year
 *
 * We deliberately gate every match behind at least ONE strict signal (form
 * code, statement keyword, quarter token, or a tax-year keyword adjacency).
 * A file with only `2024` in the name is NOT enough — too many docs carry a
 * year without being tax-related.
 */

// ── Form type regexes ─────────────────────────────────────────────────────
// Each entry: regex + canonical folder label.
interface FormRule {
  re: RegExp;
  label: string;
}

const FORM_RULES: FormRule[] = [
  // 1099 family — most common, capture the suffix
  { re: /\b1099[\s_-]?(INT|DIV|MISC|NEC|R|B|G|K|S)\b/i, label: '1099' },
  // K-1
  { re: /\bK[\s_-]?1\b/i, label: 'K-1' },
  // W-2
  { re: /\bW[\s_-]?2\b/i, label: 'W-2' },
  // 1040 family
  { re: /\b1040(?:[\s_-]?(EZ|SR|X|NR))?\b/i, label: '1040' },
  // Schedule A-K
  { re: /\bSchedule\s+([A-K])\b/i, label: 'Schedules' },
  // Misc form codes
  { re: /\b1098(?:[\s_-]?T|E)?\b/i, label: '1098' },
  { re: /\b5498\b/, label: '5498' },
  { re: /\b8606\b/, label: '8606' },
  { re: /\b4868\b/, label: '4868' }, // extension
  { re: /\bW[\s_-]?4\b/i, label: 'W-4' },
  { re: /\bW[\s_-]?9\b/i, label: 'W-9' },
];

const STATEMENT_RES: { re: RegExp; label: string }[] = [
  { re: /\bbank[\s_-]?statement\b/i, label: 'Bank Statements' },
  { re: /\bcredit[\s_-]?card[\s_-]?statement\b/i, label: 'Credit Card Statements' },
  { re: /\bbrokerage[\s_-]?statement\b/i, label: 'Brokerage Statements' },
  { re: /\bmortgage[\s_-]?statement\b/i, label: 'Mortgage Statements' },
  { re: /\b(checking|savings)[\s_-]?statement\b/i, label: 'Bank Statements' },
];

// Tax-related keyword that, when present, "qualifies" a year token as a tax
// year and lets us route year-only matches.
const TAX_KEYWORD_RE = /\b(tax|return|1040|w-?2|1099|k-?1|filing|irs|deduction)\b/i;

const QUARTER_RES = [
  /\bQ([1-4])[\s_-]?(20\d{2})\b/i,    // Q1_2024
  /\b(20\d{2})[\s_-]?Q([1-4])\b/i,    // 2024Q1
];

const MONTH_RE = /\b(20\d{2})[\s_-]?(0[1-9]|1[0-2])\b/;

function extractYear(haystack: string): string | null {
  // Pull the FIRST 20XX year. Most filenames put the tax year prominently
  // (`W2_2024.pdf`) or near the form code; first hit is usually right.
  const m = haystack.match(/\b(19[89]\d|20\d{2})\b/);
  return m ? m[1] : null;
}

function extractQuarter(haystack: string): string | null {
  for (const re of QUARTER_RES) {
    const m = haystack.match(re);
    if (m) {
      // Both regexes capture year + quarter, just in opposite order — sort
      // them out by which group is 4 digits.
      const [a, b] = [m[1], m[2]];
      const year = a.length === 4 ? a : b;
      const q = a.length === 4 ? b : a;
      return `${year}-Q${q}`;
    }
  }
  return null;
}

function extractMonth(haystack: string): string | null {
  const m = haystack.match(MONTH_RE);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function detectForm(haystack: string): string | null {
  for (const rule of FORM_RULES) {
    if (rule.re.test(haystack)) return rule.label;
  }
  return null;
}

function detectStatement(haystack: string): string | null {
  for (const rule of STATEMENT_RES) {
    if (rule.re.test(haystack)) return rule.label;
  }
  return null;
}

export function classifyAccountant(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  // Restrict the haystack to filename + first 300 chars of content. Tax forms
  // typically restate the year on the first page; restricting the window
  // avoids false matches from page numbers / footer noise.
  const haystack = filename + ' ' + (input.text ?? '').slice(0, 300);

  const form = detectForm(haystack);
  const statement = detectStatement(haystack);
  const quarter = extractQuarter(haystack);
  const month = extractMonth(haystack);
  const year = extractYear(haystack);

  // Statements: route to Finance/Statements/<Type>/<Year-Month>?
  if (statement) {
    const period = month ?? year;
    return {
      pack: 'accountant',
      category: period
        ? `Finance/Statements/${statement}/${period}`
        : `Finance/Statements/${statement}`,
      confidence: 0.9,
    };
  }

  // Quarterly bookkeeping
  if (quarter) {
    return {
      pack: 'accountant',
      category: `Finance/Quarterly/${quarter}`,
      confidence: 0.9,
    };
  }

  // Tax form + year combos
  if (form && year) {
    return {
      pack: 'accountant',
      category: `Finance/${year}/${form}`,
      confidence: 0.95,
    };
  }
  if (form) {
    return {
      pack: 'accountant',
      category: `Finance/${form}`,
      confidence: 0.85,
    };
  }

  // Year alone is only meaningful if a tax keyword appears alongside.
  if (year && TAX_KEYWORD_RE.test(haystack)) {
    return {
      pack: 'accountant',
      category: `Finance/${year}`,
      confidence: 0.75,
    };
  }

  return null;
}

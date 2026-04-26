import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Lawyer / legal-professional persona pack.
 *
 * Detection priority:
 *   1. Privilege / confidentiality flag — confidence intentionally low so
 *      the file surfaces in review piles. We never quietly auto-route a
 *      possibly-privileged document to a generic legal folder; misfiling a
 *      confidential brief into the wrong matter is materially worse than
 *      leaving it for human review.
 *   2. Bates-stamped discovery numbers (`BATES_001234`, `DOE-001234`).
 *   3. Matter / case number — multiple court-naming conventions covered.
 *   4. Document-type keywords (motion to dismiss, deposition, …).
 *
 * The matter folder is the primary axis; document-type creates a subfolder
 * within the matter. When only document-type is detected (no matter), files
 * go to a flat `Legal/<DocType>/` so they're at least typed.
 */

// Common matter / docket number formats. Designed to be PRECISE — false
// positives could send unrelated docs into a fake matter folder.
const MATTER_RES = [
  // 2024-CV-12345, 23-CR-9876, 2025-CIV-12 (year-court-number)
  /\b(\d{2,4})-([A-Z]{2,4})-(\d{3,6})\b/,
  // CIV-2024-12345 (court-year-number)
  /\b([A-Z]{2,4})-(\d{2,4})-(\d{3,6})\b/,
  // Docket No. 24-1234
  /\bdocket\s*no\.?\s*([\w\-]+)/i,
  // Case No. CV-24-1234
  /\bcase\s*no\.?\s*([A-Z0-9\-]+)/i,
];

const BATES_RE = /\b(BATES|DOE|SMITH|PROD|PRIV|ATTY)[\s_\-]?\d{4,7}\b/i;

const PRIVILEGE_RE = /(?<![A-Za-z])(privileged|attorney[\s_\-]*client|work[\s_\-]*product|confidential|under[\s_\-]*seal)(?![A-Za-z])/i;

interface DocTypeRule {
  re: RegExp;
  label: string;
}

const DOC_TYPE_RULES: DocTypeRule[] = [
  { re: /\bcomplaint\b/i, label: 'Complaints' },
  { re: /\banswer\b/i, label: 'Answers' },
  { re: /\bmotion\s*to\s*dismiss\b/i, label: 'Motions to Dismiss' },
  { re: /\bmotion\s*to\s*compel\b/i, label: 'Motions to Compel' },
  { re: /\bmotion\s*for\s*summary\s*judgment\b/i, label: 'MSJ' },
  { re: /\bmotion\b/i, label: 'Motions' },
  { re: /\bbrief\b/i, label: 'Briefs' },
  { re: /\bmemorandum\b/i, label: 'Memoranda' },
  { re: /\bdeposition\b/i, label: 'Depositions' },
  { re: /\baffidavit\b/i, label: 'Affidavits' },
  { re: /\bsubpoena\b/i, label: 'Subpoenas' },
  { re: /\binterrogatories\b/i, label: 'Interrogatories' },
  { re: /\bdiscovery\b/i, label: 'Discovery' },
  { re: /\bsettlement\b/i, label: 'Settlement' },
  { re: /\bretainer\b/i, label: 'Retainer' },
  { re: /\bengagement\s*letter\b/i, label: 'Engagement Letters' },
  { re: /(?<![A-Za-z])nda(?![A-Za-z])/i, label: 'NDAs' },
  { re: /\bloi\b|letter\s*of\s*intent/i, label: 'LOIs' },
  { re: /\bterm\s*sheet\b/i, label: 'Term Sheets' },
];

function extractMatter(haystack: string): string | null {
  for (const re of MATTER_RES) {
    const m = haystack.match(re);
    if (!m) continue;
    // Reconstruct a canonical-ish form. The capture groups vary by regex; we
    // just join everything that's not undefined with hyphens.
    const parts = m.slice(1).filter((p): p is string => Boolean(p));
    if (parts.length === 0) continue;
    return parts.join('-').toUpperCase();
  }
  return null;
}

function extractDocType(haystack: string): string | null {
  for (const rule of DOC_TYPE_RULES) {
    if (rule.re.test(haystack)) return rule.label;
  }
  return null;
}

export function classifyLawyer(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  const haystack = filename + ' ' + (input.text ?? '').slice(0, 500);

  // 1) Privilege flag — high-priority, low-confidence routing so the user
  // confirms before anything irreversible happens. We DO route to a folder
  // (otherwise the file lands in TF-IDF / Uncategorized which is worse), but
  // confidence is set so the GUI surfaces it for review.
  if (PRIVILEGE_RE.test(filename)) {
    return {
      pack: 'lawyer',
      category: 'Legal/Confidential (Review)',
      confidence: 0.5,
    };
  }

  // 2) Bates-stamped discovery
  if (BATES_RE.test(filename)) {
    const matter = extractMatter(haystack);
    return {
      pack: 'lawyer',
      category: matter
        ? `Legal/${matter}/Discovery`
        : 'Legal/Discovery',
      confidence: 0.9,
    };
  }

  // 3) Matter + (optional) doc type
  const matter = extractMatter(haystack);
  const docType = extractDocType(haystack);

  if (matter && docType) {
    return {
      pack: 'lawyer',
      category: `Legal/${matter}/${docType}`,
      confidence: 0.95,
    };
  }
  if (matter) {
    return {
      pack: 'lawyer',
      category: `Legal/${matter}`,
      confidence: 0.9,
    };
  }
  if (docType) {
    return {
      pack: 'lawyer',
      category: `Legal/${docType}`,
      confidence: 0.85,
    };
  }

  return null;
}

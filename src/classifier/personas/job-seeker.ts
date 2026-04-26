import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Job-seeker persona pack.
 *
 * Targets active job-search workflows where the same canonical document
 * (resume / cover letter) gets tailored per company, producing fan-outs like:
 *
 *   Resume_Acme.pdf
 *   Resume_Acme_v2.pdf
 *   CoverLetter_Acme.docx
 *   JD_Acme_SeniorEng.pdf
 *
 * The original `Personal` heuristic dumped all of these into a flat folder
 * which loses the per-company grouping. This pack supersedes Personal
 * whenever a company token is detected, and falls through to a flat
 * `Personal/` for resumes / cover letters with no extractable company.
 *
 * Detection order:
 *   1. Reference / recommendation letters → Job Search/References
 *   2. Job descriptions paired with a company token → Job Search/<Company>
 *   3. Resume / CV / cover letter:
 *        - with a recognizable company token → Job Search/<Company>
 *        - without → Personal (matches the legacy heuristic)
 */

// Long-form resume keywords: leading boundary is relaxed (allows match inside
// `JaneResume.pdf`), trailing boundary still requires a non-alpha (so
// `ResumeMaker` doesn't accidentally match). The trailing boundary keeps
// false positives in check.
const RESUME_LONG_RE = /(resume|curriculum[\s_-]*vitae|cover[\s_-]*letter|personal[\s_-]*statement|statement[\s_-]*of[\s_-]*purpose)(?![A-Za-z])/i;
// `cv` is too short to relax — without strict boundaries on BOTH sides,
// substrings like `ucv`, `civic` would false-match.
const CV_STRICT_RE = /(?<![A-Za-z])cv(?![A-Za-z])/i;
const JD_RE = /(?<![A-Za-z])(jd|job[\s_-]*description|posting|listing|role)(?![A-Za-z])/i;
const REFERENCE_RE = /(?<![A-Za-z])(reference|recommendation|lor|letter[\s_-]*of[\s_-]*recommendation)(?![A-Za-z])/i;

function isResumeFilename(filename: string): boolean {
  return RESUME_LONG_RE.test(filename) || CV_STRICT_RE.test(filename);
}

/**
 * Filler tokens that show up in job-search filenames but are NEVER the
 * company name. We strip these out before picking a candidate company token.
 * Lower-cased; comparison must lowercase the candidate first.
 */
const STOP_TOKENS: ReadonlySet<string> = new Set([
  'resume', 'cv', 'cover', 'letter', 'coverletter', 'jd', 'job', 'description',
  'posting', 'listing', 'role', 'application', 'app', 'final', 'draft',
  'updated', 'new', 'old', 'v', 'version', 'copy', 'reference', 'recommendation',
  'lor', 'and', 'the', 'for', 'to', 'with', 'pdf', 'docx', 'doc',
  // Common name-position fillers — first names get filtered by the capitalization
  // heuristic anyway (companies are typically multi-cap or distinctive).
]);

/**
 * Try to extract a company token from the filename. Returns null when the
 * signal is too weak (only one capitalized chunk total, all tokens look like
 * fillers, or no recognizable separator before/after a candidate).
 *
 * Strategy: split on common separators, drop fillers and pure-digit tokens,
 * then prefer the LAST token that survives (companies tend to appear at the
 * end of the filename: "Resume_Acme", "CoverLetter-Anthropic"). Fall back to
 * the longest surviving token if last-position is ambiguous.
 */
function extractCompanyToken(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, '');
  // Split on whitespace, underscore, hyphen, period — keep only word chars.
  const rawTokens = stem
    .split(/[\s_\-\.]+/)
    .map((t) => t.replace(/[^A-Za-z0-9&]/g, ''))
    .filter((t) => t.length > 0);
  if (rawTokens.length === 0) return null;
  // Single-token filenames (e.g. `JaneResume.pdf`) carry no company structure
  // — we can't separate the company name from the resume keyword. Caller
  // falls back to a flat Personal folder.
  if (rawTokens.length === 1) return null;

  const survivors = rawTokens.filter((t) => {
    const low = t.toLowerCase();
    if (STOP_TOKENS.has(low)) return false;
    if (/^\d+$/.test(t)) return false;          // pure digits (years, versions)
    if (/^v\d+$/i.test(t)) return false;        // version tags like v2
    if (t.length < 2) return false;
    // Skip obviously-personal name tokens: short, lowercase, or in our common
    // first-name guess list. We don't ship a first-name table; instead, we
    // rely on capitalization — companies are typically Capitalized or ALLCAPS.
    if (!/[A-Z]/.test(t)) return false;
    return true;
  });

  if (survivors.length === 0) return null;

  // Prefer the LAST surviving token (companies usually end the filename).
  return survivors[survivors.length - 1];
}

/**
 * Normalise a company token for use as a folder name. Drops trailing
 * "Inc"/"LLC"/"Corp" if present (we want "Acme" not "Acme Inc"), and
 * preserves capitalisation otherwise.
 */
function normaliseCompany(token: string): string {
  return token.replace(/(?:Inc|LLC|Corp|Co|Ltd|GmbH)$/i, '').trim() || token;
}

export function classifyJobSeeker(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);

  // Reference / recommendation letters are a distinct sub-bucket — they're
  // shared across all applications, not per-company.
  if (REFERENCE_RE.test(filename)) {
    return {
      pack: 'job-seeker',
      category: 'Job Search/References',
      confidence: 0.9,
    };
  }

  const isResume = isResumeFilename(filename);
  const isJd = JD_RE.test(filename);
  if (!isResume && !isJd) return null;

  const company = extractCompanyToken(filename);

  if (company) {
    const folder = normaliseCompany(company);
    return {
      pack: 'job-seeker',
      // path.join handles forward slashes; nested folder is created by mover.
      category: `Job Search/${folder}`,
      confidence: 0.9,
    };
  }

  // No company token, but this IS a personal application doc. Fall back to
  // the legacy flat Personal folder so we don't regress anyone whose resumes
  // don't carry company tokens.
  if (isResume) {
    return {
      pack: 'job-seeker',
      category: 'Personal',
      confidence: 0.9,
    };
  }

  // Bare JD with no company — let the next pack decide.
  return null;
}

import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Researcher / academic persona pack.
 *
 * Detects:
 *   • Citation-key filenames (`Hinton2015_DistillingKnowledge.pdf`)
 *   • arXiv preprint IDs (`2017.06762.pdf`, `1706.03762v3.pdf`)
 *   • BibTeX / RIS reference files (`.bib`, `.bibtex`, `.ris`)
 *   • DOI strings inside extracted text — group by venue prefix
 *   • Common conference / journal names in filename or first lines
 *
 * Routing structure:
 *   Research/Papers/<Author><Year>/<file>     ← citation-key match
 *   Research/arXiv/<file>                     ← arXiv preprint
 *   Research/Venues/<Venue>/<Year>?           ← venue match
 *   Research/References/                      ← .bib / .ris
 *   Research/Papers/                          ← DOI-tagged but no venue
 *
 * We deliberately don't make external API calls (CrossRef, arXiv abstract
 * page) — the tool is offline-first and any network dependency would block
 * scans behind unavailable services. Filename-and-content signals only.
 */

// First-author + year. Matches:
//   Smith2023.pdf
//   Hinton-et-al-2015.pdf  Vaswani-et-al-2017.pdf
//   Hinton_2015.pdf  Hinton 2015.pdf
const CITATION_RE = /^([A-Z][a-z]+)(?:[\s_-]?et[\s_-]?al)?[\s_\-]?(\d{4})/;

// arXiv ID (post-2007 form: YYMM.NNNNN[vN]). The leading boundary uses a
// non-digit lookbehind because arXiv IDs are often the entire stem, no prefix.
const ARXIV_RE = /(?:^|[^\d])((?:\d{4}\.\d{4,5})(v\d+)?)(?:[^\d]|$)/;

// DOI: 10.<registrant>/<suffix>. Captures the registrant for venue-by-publisher
// grouping.
const DOI_RE = /\b(10\.(\d{4,9}))\/[\w\-_;./()<>:]+/;

// Common venues — extend by editing this table; ordered alphabetically.
// Names are tested as case-insensitive whole-word matches.
const VENUES: ReadonlySet<string> = new Set([
  // ML / AI
  'AAAI', 'ACL', 'CVPR', 'EMNLP', 'ICCV', 'ICLR', 'ICML', 'IJCAI',
  'KDD', 'NAACL', 'NeurIPS', 'NIPS', 'SIGGRAPH', 'SIGKDD',
  // General science
  'Nature', 'Science', 'PNAS', 'Cell', 'Lancet', 'JAMA', 'NEJM',
  // Systems / databases / security
  'OSDI', 'SOSP', 'NSDI', 'PLDI', 'POPL', 'OOPSLA', 'VLDB', 'SIGMOD',
  'CCS', 'NDSS', 'USENIX',
]);

const BIBLIO_EXTS: ReadonlySet<string> = new Set(['.bib', '.bibtex', '.ris']);

function detectVenue(haystack: string): string | null {
  // Whole-word, case-insensitive match against the venue list.
  for (const venue of VENUES) {
    const re = new RegExp(`\\b${venue}\\b`, 'i');
    if (re.test(haystack)) return venue;
  }
  return null;
}

function extractYear(haystack: string): string | null {
  const m = haystack.match(/\b(19[89]\d|20\d{2})\b/);
  return m ? m[1] : null;
}

export function classifyResearcher(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  const stem = filename.replace(/\.[^.]+$/, '');
  const ext = path.extname(filename).toLowerCase();

  // ── BibTeX / RIS reference files ───────────────────────────────────────
  if (BIBLIO_EXTS.has(ext)) {
    return {
      pack: 'researcher',
      category: 'Research/References',
      confidence: 0.95,
    };
  }

  // ── arXiv ID in filename ───────────────────────────────────────────────
  const arxivMatch = stem.match(ARXIV_RE);
  if (arxivMatch) {
    return {
      pack: 'researcher',
      category: 'Research/arXiv',
      confidence: 0.95,
    };
  }

  // ── Citation-key style filename ────────────────────────────────────────
  const citationMatch = stem.match(CITATION_RE);
  if (citationMatch) {
    const author = citationMatch[1];
    const year = citationMatch[2];
    return {
      pack: 'researcher',
      category: `Research/Papers/${author}${year}`,
      confidence: 0.9,
    };
  }

  // ── Venue match (filename or first 1KB of body) ────────────────────────
  const haystack = filename + ' ' + (input.text ?? '').slice(0, 1000);
  const venue = detectVenue(haystack);
  if (venue) {
    const year = extractYear(haystack);
    return {
      pack: 'researcher',
      category: year
        ? `Research/Venues/${venue}/${year}`
        : `Research/Venues/${venue}`,
      confidence: year ? 0.85 : 0.75,
    };
  }

  // ── DOI present in body — group as generic Papers ──────────────────────
  // Without a CrossRef lookup we can't do better than a flat folder, but
  // surfacing them out of Uncategorized still helps.
  if (DOI_RE.test(input.text ?? '')) {
    return {
      pack: 'researcher',
      category: 'Research/Papers',
      confidence: 0.7,
    };
  }

  return null;
}

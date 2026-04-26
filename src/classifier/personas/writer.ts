import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Writer / author persona pack.
 *
 * Targets long-form prose writers: novelists, nonfiction authors,
 * screenwriters. Detection focuses on filename structure, since extracted
 * text from a 60k-word manuscript is too generic to discriminate from any
 * other prose document.
 *
 * Routing:
 *   • Chapter files (`ch07_the-confrontation.md`, `chapter_3_*.docx`)
 *     → Manuscripts/Chapters
 *   • Submission packets (query, synopsis, partial, proposal) → Submissions
 *   • Reference material per writer convention (`worldbuilding`, `outline`,
 *     `beat-sheet`, `character-sheet`) → Manuscripts/Reference
 *   • Draft revision chains (`*_v\d`, `*_revised`, `*_clean`, `*_final`) for
 *     writer-y document extensions → Manuscripts/Drafts
 *
 * The "draft revision" rule is deliberately gated on prose-y extensions
 * (`.docx`, `.md`, `.txt`, `.pages`, `.rtf`) and prose-y stems — without that
 * gate it would catch any versioned file (`design_v3.png`, `code_final.py`)
 * which is bad in a multi-persona setup.
 */

const PROSE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.docx', '.doc', '.pages', '.rtf', '.md', '.markdown', '.txt', '.fdx',
  '.fountain', '.scriv',
]);

// `\b` treats `_` as a word char, so `ch07_the-confrontation` would NOT match
// `^ch(?:apter)?[\s_\-]?(\d+)\b` — the `\b` after the digit would fail
// because `7` (word) → `_` (word) is not a boundary. Use `(?!\d)` instead so
// the only requirement is "no more digits after."
const CHAPTER_RES = [
  /^ch(?:apter)?[\s_\-]?(\d{1,3})(?!\d)/i,
  /^(\d{1,3})[\s_\-](?:ch|chapter)(?!\w)/i,
  /^(\d{1,3})[\s_\-][a-z]/i, // "01-the-beginning.md"
];

const SUBMISSION_KEYWORDS_RE = /\b(query|synopsis|partial|full[\s_\-]?proposal|proposal|submission|submission[\s_\-]?packet|cover[\s_\-]?letter|pitch)\b/i;

// Note: "notes" is intentionally absent. Generic enough to clash with the
// general-office "Meeting Notes" pattern; we let general-office own that
// signal and rely here on tighter, writer-specific tokens.
const REFERENCE_KEYWORDS_RE = /\b(worldbuilding|world[\s_\-]?building|outline|beat[\s_\-]?sheet|character[\s_\-]?sheet|character[\s_\-]?bible|research|scratch|brainstorm)\b/i;

const REVISION_RES = [
  /[_\-\s]v\d+\b/i,           // _v1, _v2, -v3
  /[_\-\s](revised|revision|edit|edits|clean|final|draft)\b/i,
];

const MANUSCRIPT_HINT_RE = /\b(manuscript|novel|novella|memoir|screenplay|script|story|chapter|prose|draft)\b/i;

/**
 * True iff this looks like a writing-platform file. We use this both as a
 * fast accept (`.fdx` is unambiguously screenwriting) and as a gating signal
 * for ambiguous rules (revision chains).
 */
function isProseExtension(ext: string): boolean {
  return PROSE_EXTENSIONS.has(ext);
}

export function classifyWriter(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  const stem = filename.replace(/\.[^.]+$/, '');
  const ext = path.extname(filename).toLowerCase();

  // ── Chapter files (regardless of extension — chapter naming is its own
  //   strong signal) ────────────────────────────────────────────────────
  for (const re of CHAPTER_RES) {
    if (re.test(stem)) {
      return {
        pack: 'writer',
        category: 'Manuscripts/Chapters',
        confidence: 0.9,
      };
    }
  }

  // ── Submission packet keywords ─────────────────────────────────────────
  // We require a co-occurring writing-context signal (prose extension OR a
  // manuscript hint) to avoid catching the JOB SEEKER's "cover letter"
  // (which is handled higher in priority anyway, but defence-in-depth).
  if (SUBMISSION_KEYWORDS_RE.test(stem)) {
    if (isProseExtension(ext) || MANUSCRIPT_HINT_RE.test(stem)) {
      return {
        pack: 'writer',
        category: 'Manuscripts/Submissions',
        confidence: 0.85,
      };
    }
  }

  // ── Reference / research material ──────────────────────────────────────
  if (REFERENCE_KEYWORDS_RE.test(stem)) {
    if (isProseExtension(ext) || MANUSCRIPT_HINT_RE.test(stem)) {
      return {
        pack: 'writer',
        category: 'Manuscripts/Reference',
        confidence: 0.8,
      };
    }
  }

  // ── Revision chains — most ambiguous, gated by prose extension ─────────
  if (isProseExtension(ext)) {
    for (const re of REVISION_RES) {
      if (re.test(stem)) {
        return {
          pack: 'writer',
          category: 'Manuscripts/Drafts',
          confidence: 0.75,
        };
      }
    }
    // Strong manuscript-hint keyword in stem of a prose file — even without
    // a revision tag, route to Drafts.
    if (MANUSCRIPT_HINT_RE.test(stem)) {
      return {
        pack: 'writer',
        category: 'Manuscripts/Drafts',
        confidence: 0.7,
      };
    }
  }

  return null;
}

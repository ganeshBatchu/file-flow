import path from 'path';
import { isInsideCodeProject } from './code-project.js';

/**
 * Cheap, high-precision filename-only heuristics.
 *
 * Designed as a fallback *after* course detection fails but *before* TF-IDF /
 * quarantine. Each rule is patterned to only fire when the evidence is
 * overwhelming (exact filename match or a strict keyword) to avoid siphoning
 * real content away from clustering. When in doubt we return null and let the
 * regular pipeline handle it.
 */

export type HeuristicCategory =
  | 'Personal'
  | 'Build Logs'
  | 'Code Snippets'
  | 'Installers';

/**
 * Resume / CV / cover letter / personal statement.
 *
 * Matches exact-keyword filenames like "Ganesh_Batchu_Resume_2 (3).pdf" or
 * "Cover Letter - Google.docx" — words users rarely put in a document unless
 * it *is* that document.
 *
 * Boundary uses alphabetic-only lookarounds (not `\b`) because `\b` treats `_`
 * as a word char — "jdoe_CV.pdf" and "Ganesh_Batchu_Resume_2.pdf" wouldn't
 * match otherwise.
 */
const PERSONAL_RE = /(?<![A-Za-z])(resume|curriculum[\s_-]*vitae|cv|cover[\s_-]*letter|personal[\s_-]*statement|statement[\s_-]*of[\s_-]*purpose)(?![A-Za-z])/i;

/**
 * CI / build-log output dumps.
 *
 * Student projects often produce filenames like "0_Build and Test.txt",
 * "1_Install Dependencies.log", "3_Run Tests.txt" — leading step number +
 * capitalized action phrase. These are almost never worth categorizing with
 * the user's actual content.
 */
const CI_LOG_RE = /^\d+[_\-\s][A-Z][a-zA-Z]+([\s_-][A-Za-z]+)*\.(txt|log)$/;

// ────────────────────────────────────────────────────────────────────────────
// Software-engineer persona heuristics
// ────────────────────────────────────────────────────────────────────────────

/**
 * Application / toolchain installer file extensions. Routing every installer
 * into a single bucket keeps Downloads tidy — they all want the same lifecycle
 * (install, then delete). We deliberately don't gate on a "toolchain-y" name
 * pattern: a generic installer like `Spotify.dmg` and a toolchain installer
 * like `node-v20.10.0.pkg` both belong in the same drawer from the user's
 * perspective.
 */
const INSTALLER_EXTENSIONS: ReadonlySet<string> = new Set([
  '.dmg',
  '.pkg',
  '.exe',
  '.msi',
  '.deb',
  '.rpm',
  '.appimage',
  '.snap',
]);

/**
 * Loose-script file extensions. These are interpreted languages whose files
 * are routinely created as one-off snippets — `quick-test.py`, `scratch.js`,
 * `notes.sh`. Compiled-language extensions (`.cpp`, `.java`, `.rs`, `.go`) are
 * NOT included: those are almost always project-attached, never standalone.
 */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.py',
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.rb',
  '.pl',
  '.lua',
  '.r',
]);

/**
 * Filenames that LOOK like loose scripts (right extension, often small) but
 * are actually project-config files that escaped a repo. If we route these as
 * "Code Snippets" we strand important files away from their project — better
 * to let the regular pipeline (likely quarantine) handle them so the user
 * notices and re-files manually.
 *
 * Lower-cased keys; comparison must lowercase the candidate basename.
 */
const NON_SNIPPET_FILENAMES: ReadonlySet<string> = new Set([
  // Python
  'setup.py',
  '__init__.py',
  'manage.py',          // Django
  'conftest.py',
  // JS / TS build configs
  'webpack.config.js',
  'webpack.config.ts',
  'rollup.config.js',
  'rollup.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'babel.config.js',
  'babel.config.cjs',
  'next.config.js',
  'next.config.mjs',
  'nuxt.config.js',
  'nuxt.config.ts',
  'eslint.config.js',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'prettier.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.js',
  'vitest.config.ts',
  'playwright.config.ts',
  'svelte.config.js',
  'astro.config.mjs',
]);

/**
 * Threshold for "looks like a snippet, not a real source file." Files larger
 * than this typically have substantive logic worth content-classifying (or
 * are part of a project), so we leave them to TF-IDF / project detection.
 *
 * 5 KB roughly corresponds to ~120 lines of source, which is well above
 * scratch-pad / one-off territory.
 */
const CODE_SNIPPET_MAX_BYTES = 5 * 1024;

/** True iff the file's extension marks it as an installer. */
export function isInstaller(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return INSTALLER_EXTENSIONS.has(ext);
}

/**
 * True iff the file is a small loose script that doesn't appear to belong to
 * a project. Three conditions must all hold:
 *
 *   1. Extension is in the script set.
 *   2. Filename isn't a known project-config name (setup.py, vite.config.ts…).
 *   3. File size is below `CODE_SNIPPET_MAX_BYTES`.
 *   4. File isn't sitting inside an enclosing code-project subtree.
 *
 * If `fileSizeBytes` isn't supplied, the size check is skipped — callers that
 * don't have a stat handy can still call this, but they trade some precision
 * for the convenience.
 */
export function isLooseScript(
  filePath: string,
  fileSizeBytes?: number,
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!SCRIPT_EXTENSIONS.has(ext)) return false;

  const filenameLower = path.basename(filePath).toLowerCase();
  if (NON_SNIPPET_FILENAMES.has(filenameLower)) return false;

  if (fileSizeBytes !== undefined && fileSizeBytes >= CODE_SNIPPET_MAX_BYTES) {
    return false;
  }

  // If the file is buried inside someone's repo, it's NOT a stray snippet —
  // even if it's tiny, it likely belongs to that project's structure.
  if (isInsideCodeProject(filePath)) return false;

  return true;
}

/**
 * Return the heuristic category for a file based on its filename (and an
 * optional file size, used by the loose-script check), or null if no rule
 * fires. Call this *after* course detection has been tried.
 *
 * Order is significant: more specific / higher-precision rules fire first.
 *   1. Personal (resume / CV) — extremely high confidence keyword match.
 *   2. Build Logs — strict numeric-prefix filename pattern.
 *   3. Installers — extension match.
 *   4. Code Snippets — extension + size + non-project gate.
 */
export function detectFilenameHeuristic(
  filePath: string,
  fileSizeBytes?: number,
): HeuristicCategory | null {
  const filename = path.basename(filePath);

  if (PERSONAL_RE.test(filename)) return 'Personal';
  if (CI_LOG_RE.test(filename)) return 'Build Logs';
  if (isInstaller(filePath)) return 'Installers';
  if (isLooseScript(filePath, fileSizeBytes)) return 'Code Snippets';

  return null;
}

/**
 * Image-only PDF detection: files with essentially no extractable text but
 * non-trivial size are almost certainly scanned / photographed PDFs that need
 * OCR. Flagged in quarantine UI so users know why the file didn't classify.
 *
 * Thresholds:
 *   • text length < 100 chars (below tokenizer usefulness)
 *   • file size ≥ 50 KB (filters out genuinely tiny / empty files)
 */
const OCR_MIN_SIZE_BYTES = 50 * 1024;
const OCR_MAX_TEXT_CHARS = 100;

export function isLikelyImageOnlyPdf(
  filePath: string,
  extractedText: string,
  fileSizeBytes: number,
): boolean {
  if (!/\.pdf$/i.test(filePath)) return false;
  if (extractedText.trim().length >= OCR_MAX_TEXT_CHARS) return false;
  if (fileSizeBytes < OCR_MIN_SIZE_BYTES) return false;
  return true;
}

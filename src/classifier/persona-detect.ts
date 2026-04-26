import fs from 'fs';
import path from 'path';
import { isCodeProjectDir } from './code-project.js';
import type { PersonaPack } from '../config/schema.js';

/**
 * Persona auto-detection.
 *
 * Walks a target directory and counts signal files for each persona, then
 * returns a list of suggested packs in confidence order. The result is
 * SUGGESTION-ONLY — never auto-enables. The UI surfaces a "looks like you
 * might be: ☑ Software Engineer ☑ Researcher" prompt for the user to
 * confirm.
 *
 * Detection signals are deliberately low-precision compared to the
 * classifiers themselves — for AUTO-DETECTION we want to err toward
 * over-suggesting (the user can untick) rather than miss a relevant pack.
 *
 * Performance note: for typical Documents/Downloads directories (a few
 * thousand files) a non-recursive scan finishes in tens of milliseconds.
 * For deep directory trees we cap recursion at MAX_DEPTH and bail at
 * MAX_FILES to keep this O(scan-budget) regardless of disk size.
 */

const MAX_FILES = 5000;
const MAX_DEPTH = 4;

interface SignalCounts {
  // Software engineer
  codeProjectDirs: number;
  // Researcher
  citationKeyPdfs: number;
  arxivPdfs: number;
  bibtexFiles: number;
  // Photographer
  rawImages: number;
  rasterImages: number;
  // Designer
  designProjectFiles: number;
  // Data scientist
  notebooks: number;
  largeDatasets: number;
  modelCheckpoints: number;
  // Lawyer
  matterFilenames: number;
  // Accountant
  taxFormFilenames: number;
  // Writer
  chapterFilenames: number;
  manuscriptDrafts: number;
  // Job seeker
  resumeFiles: number;
  // General office
  meetingNotes: number;
}

function newCounts(): SignalCounts {
  return {
    codeProjectDirs: 0,
    citationKeyPdfs: 0,
    arxivPdfs: 0,
    bibtexFiles: 0,
    rawImages: 0,
    rasterImages: 0,
    designProjectFiles: 0,
    notebooks: 0,
    largeDatasets: 0,
    modelCheckpoints: 0,
    matterFilenames: 0,
    taxFormFilenames: 0,
    chapterFilenames: 0,
    manuscriptDrafts: 0,
    resumeFiles: 0,
    meetingNotes: 0,
  };
}

const RAW_EXTS = new Set([
  '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2', '.pef',
]);
const RASTER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.tiff']);
const DESIGN_EXTS = new Set(['.psd', '.ai', '.sketch', '.fig', '.indd', '.afdesign', '.afphoto', '.xd', '.aep']);
const CHECKPOINT_EXTS = new Set(['.pt', '.pth', '.safetensors', '.onnx', '.gguf', '.ckpt']);
const DATASET_EXTS = new Set(['.csv', '.parquet', '.tsv', '.jsonl', '.h5', '.hdf5', '.npy', '.feather']);

const CITATION_RE = /^([A-Z][a-z]+)(?:[\s_-]?et[\s_-]?al)?[\s_\-]?(\d{4})/;
const ARXIV_RE = /(?:^|[^\d])(\d{4}\.\d{4,5})/;
const MATTER_RE = /\b(\d{2,4})-([A-Z]{2,4})-(\d{3,6})\b/;
const TAX_FORM_RE = /\b(W-?2|1099(?:-?(?:INT|DIV|MISC|NEC|R))?|K-?1|1040)\b/i;
const CHAPTER_RE = /^(?:ch|chapter)[\s_\-]?\d{1,3}\b/i;
const RESUME_RE = /(?<![A-Za-z])(resume|cv|cover[\s_\-]?letter)(?![A-Za-z])/i;
const MEETING_RE = /\b(meeting|standup|1on1|1-1|retro|kickoff)\b/i;
const MANUSCRIPT_DRAFT_RE = /\b(novel|manuscript|chapter|memoir|screenplay|script)\b/i;

const DATASET_MIN_BYTES = 1 * 1024 * 1024;

function bumpForFile(filePath: string, counts: SignalCounts) {
  const filename = path.basename(filePath);
  const stem = filename.replace(/\.[^.]+$/, '');
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.bib' || ext === '.bibtex') counts.bibtexFiles++;
  if (RAW_EXTS.has(ext)) counts.rawImages++;
  if (RASTER_EXTS.has(ext)) counts.rasterImages++;
  if (DESIGN_EXTS.has(ext)) counts.designProjectFiles++;
  if (ext === '.ipynb') counts.notebooks++;

  if (ext === '.pdf') {
    if (CITATION_RE.test(stem)) counts.citationKeyPdfs++;
    if (ARXIV_RE.test(stem)) counts.arxivPdfs++;
  }

  if (DATASET_EXTS.has(ext)) {
    try {
      const size = fs.statSync(filePath).size;
      if (size >= DATASET_MIN_BYTES) counts.largeDatasets++;
    } catch {
      // ignore
    }
  }

  if (CHECKPOINT_EXTS.has(ext)) counts.modelCheckpoints++;
  if (MATTER_RE.test(filename)) counts.matterFilenames++;
  if (TAX_FORM_RE.test(filename)) counts.taxFormFilenames++;
  if (CHAPTER_RE.test(stem)) counts.chapterFilenames++;
  if (RESUME_RE.test(filename)) counts.resumeFiles++;
  if (MEETING_RE.test(stem)) counts.meetingNotes++;
  if (MANUSCRIPT_DRAFT_RE.test(stem)) counts.manuscriptDrafts++;
}

function scan(
  dir: string,
  counts: SignalCounts,
  depth: number,
  state: { fileCount: number },
): void {
  if (state.fileCount >= MAX_FILES) return;
  if (depth > MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Test code-project once per directory — single readdir hit, not per-file.
  if (isCodeProjectDir(dir)) {
    counts.codeProjectDirs++;
    // Don't descend into a code project — counts are about "is this person a
    // dev?", not about classifying their repo internals.
    return;
  }

  for (const entry of entries) {
    if (state.fileCount >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the usual scaffolding — we don't want auto-detect to count
      // EXIF reads inside Library/, etc.
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      scan(full, counts, depth + 1, state);
    } else if (entry.isFile()) {
      state.fileCount++;
      bumpForFile(full, counts);
    }
  }
}

export interface PersonaSuggestion {
  pack: PersonaPack;
  /** A 0-1 confidence score. Higher = more evidence. */
  score: number;
  /** Plain-English reason shown in the UI. */
  reason: string;
}

/**
 * Run auto-detection on a watch directory and return suggested persona
 * packs. Only suggestions that meet a minimum signal threshold are
 * returned, sorted by confidence descending.
 */
export function suggestPersonas(targetDir: string): PersonaSuggestion[] {
  const counts = newCounts();
  scan(targetDir, counts, 0, { fileCount: 0 });

  const suggestions: PersonaSuggestion[] = [];

  if (counts.codeProjectDirs >= 3) {
    suggestions.push({
      pack: 'software-engineer',
      score: Math.min(1, counts.codeProjectDirs / 10),
      reason: `${counts.codeProjectDirs} code project directories detected`,
    });
  }

  if (counts.citationKeyPdfs + counts.arxivPdfs >= 20 || counts.bibtexFiles >= 1) {
    const total = counts.citationKeyPdfs + counts.arxivPdfs;
    suggestions.push({
      pack: 'researcher',
      score: Math.min(1, (total + counts.bibtexFiles * 5) / 30),
      reason: `${total} citation/arXiv PDFs and ${counts.bibtexFiles} BibTeX files`,
    });
  }

  if (counts.rawImages >= 50 || counts.rasterImages >= 200) {
    suggestions.push({
      pack: 'photographer',
      score: Math.min(1, (counts.rawImages * 2 + counts.rasterImages) / 200),
      reason: `${counts.rawImages} RAW + ${counts.rasterImages} raster image files`,
    });
  }

  if (counts.designProjectFiles >= 5) {
    suggestions.push({
      pack: 'designer',
      score: Math.min(1, counts.designProjectFiles / 15),
      reason: `${counts.designProjectFiles} design project files`,
    });
  }

  if (counts.notebooks >= 5 || counts.largeDatasets >= 3 || counts.modelCheckpoints >= 1) {
    suggestions.push({
      pack: 'data-scientist',
      score: Math.min(1, (counts.notebooks + counts.largeDatasets + counts.modelCheckpoints * 5) / 15),
      reason: `${counts.notebooks} notebooks, ${counts.largeDatasets} large datasets, ${counts.modelCheckpoints} model files`,
    });
  }

  if (counts.matterFilenames >= 3) {
    suggestions.push({
      pack: 'lawyer',
      score: Math.min(1, counts.matterFilenames / 10),
      reason: `${counts.matterFilenames} matter / case-numbered filenames`,
    });
  }

  if (counts.taxFormFilenames >= 3) {
    suggestions.push({
      pack: 'accountant',
      score: Math.min(1, counts.taxFormFilenames / 10),
      reason: `${counts.taxFormFilenames} tax form filenames`,
    });
  }

  if (counts.chapterFilenames >= 3 || counts.manuscriptDrafts >= 5) {
    suggestions.push({
      pack: 'writer',
      score: Math.min(1, (counts.chapterFilenames * 2 + counts.manuscriptDrafts) / 15),
      reason: `${counts.chapterFilenames} chapter files, ${counts.manuscriptDrafts} draft hints`,
    });
  }

  if (counts.resumeFiles >= 3) {
    suggestions.push({
      pack: 'job-seeker',
      score: Math.min(1, counts.resumeFiles / 10),
      reason: `${counts.resumeFiles} resume / cover-letter files`,
    });
  }

  if (counts.meetingNotes >= 5) {
    suggestions.push({
      pack: 'general-office',
      score: Math.min(1, counts.meetingNotes / 15),
      reason: `${counts.meetingNotes} meeting-notes files`,
    });
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}

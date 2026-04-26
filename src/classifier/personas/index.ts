import type { PersonaPack } from '../../config/schema.js';

/**
 * Persona pack registry.
 *
 * A "persona pack" is a bundle of high-precision classifiers that target a
 * specific user demographic (software engineers, researchers, photographers,
 * …). Each pack runs before the generic TF-IDF clusterer in the priority
 * defined by `PERSONA_PRIORITY`, and any pack may yield to the next by
 * returning null.
 *
 * Each pack ships ONE entry point:
 *
 *   classify(input) → { category, confidence } | null
 *
 * `category` may include forward slashes for nested destinations, e.g.
 * `Job Search/Acme Inc` — the dryrun layer joins it onto the source dir
 * via `path.join`, so nested folders Just Work.
 *
 * Confidence values inside packs follow this rough convention:
 *   1.0   high-precision regex on filename + content (e.g. resume keyword)
 *   0.9   single high-precision filename signal (e.g. matter number, form)
 *   0.85  composite filename signal (e.g. `chapter` + numeric prefix)
 *   0.75  extension-only heuristic (e.g. .pptx → Presentations)
 *   0.65  derivative / sibling-inferred match
 *
 * These values aren't compared against the configured threshold the way
 * TF-IDF scores are — a non-null pack result is always honoured. Confidence
 * surfaces in the UI so the user can sort review piles by least-certain.
 */

export interface PersonaInput {
  filePath: string;
  /** Extracted text (may be empty for binary files / extraction failure). */
  text: string;
  /** File size in bytes, undefined if stat failed. */
  fileSizeBytes?: number;
}

export interface PersonaMatch {
  category: string;
  confidence: number;
  /** Which pack produced the match — useful for journal/audit. */
  pack: PersonaPack;
}

export type PersonaClassifier = (
  input: PersonaInput,
) => PersonaMatch | null | Promise<PersonaMatch | null>;

interface PackEntry {
  pack: PersonaPack;
  classifier: PersonaClassifier;
}

import { classifyJobSeeker } from './job-seeker.js';
import { classifyLawyer } from './lawyer.js';
import { classifyAccountant } from './accountant.js';
import { classifyResearcher } from './researcher.js';
import { classifyDataScientist } from './data-scientist.js';
import { classifyWriter } from './writer.js';
import { classifyPhotographer } from './photographer.js';
import { classifyDesigner } from './designer.js';
import { classifyGeneralOffice } from './general-office.js';
import { classifySoftwareEngineer } from './software-engineer.js';

/**
 * Priority order. Earlier entries get first dibs on a file. The order is
 * driven by precision: the more specific a pack's signals, the earlier it
 * fires. Generic / fallback packs (general-office) come last.
 *
 * Software-engineer is registered here so its installer + code-snippet rules
 * also run as part of the pipeline; they were previously embedded in
 * `filename-heuristics.ts` and remain accessible there for callers that want
 * the raw rules. The persona-pack flow is now the canonical path.
 */
const PERSONA_PRIORITY: PersonaPack[] = [
  // Lawyer runs first because court matter codes (`2024-CV-12345`) are
  // unambiguous — and they include `CV` substrings that would otherwise be
  // mis-detected by the resume regex in the Job Seeker pack.
  'lawyer',           // matter numbers / strict legal vocabulary
  'job-seeker',       // resume + company token (more specific than generic Personal)
  'accountant',       // form codes / tax years
  'researcher',       // citation keys / arXiv IDs / venues
  'data-scientist',   // .ipynb / dataset extensions / checkpoints
  'designer',         // creative project file extensions / brand+stock signals
  'photographer',     // image extension + EXIF date
  'software-engineer',// installers / loose scripts / code-project signals
  // Writer runs BEFORE general-office: writer's signals (chapter naming,
  // revision tags, manuscript hints) are tighter than general-office's
  // last-resort `.docx → Documents` fallback, which would otherwise eat
  // every prose file. The writer pack itself no longer matches "notes" as
  // a reference keyword, so general-office still owns "Meeting Notes".
  'writer',           // chapter + revision filename patterns
  'general-office',   // meetings, receipts, calendar, artefact-type buckets (last)
];

const REGISTRY: PackEntry[] = [
  { pack: 'job-seeker', classifier: classifyJobSeeker },
  { pack: 'lawyer', classifier: classifyLawyer },
  { pack: 'accountant', classifier: classifyAccountant },
  { pack: 'researcher', classifier: classifyResearcher },
  { pack: 'data-scientist', classifier: classifyDataScientist },
  { pack: 'writer', classifier: classifyWriter },
  { pack: 'designer', classifier: classifyDesigner },
  { pack: 'photographer', classifier: classifyPhotographer },
  { pack: 'software-engineer', classifier: classifySoftwareEngineer },
  { pack: 'general-office', classifier: classifyGeneralOffice },
];

/**
 * Run all enabled persona classifiers in priority order; return the first
 * non-null match, or null if every pack passed.
 */
export async function classifyWithPersonas(
  input: PersonaInput,
  enabled: PersonaPack[],
): Promise<PersonaMatch | null> {
  const enabledSet = new Set(enabled);
  for (const pack of PERSONA_PRIORITY) {
    if (!enabledSet.has(pack)) continue;
    const entry = REGISTRY.find((e) => e.pack === pack);
    if (!entry) continue;
    try {
      const match = await entry.classifier(input);
      if (match) return match;
    } catch {
      // A failing pack must never block other packs or the generic pipeline.
      // Swallow and continue — the file falls through to TF-IDF.
    }
  }
  return null;
}

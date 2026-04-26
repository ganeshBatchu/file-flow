import path from 'path';
import { isInstaller, isLooseScript } from '../filename-heuristics.js';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Software-engineer persona pack.
 *
 * Filename-driven rules, each high-precision:
 *
 *   • Installers — application + toolchain installer extensions
 *     (`.dmg`, `.pkg`, `.exe`, `.msi`, `.deb`, `.rpm`, `.appimage`, `.snap`).
 *
 *   • Code Snippets — small loose scripts (`.py`, `.sh`, `.js`, …) under
 *     5 KB that aren't named like project configs and aren't sitting inside
 *     someone's repo.
 *
 *   • SWE artefact filenames — design docs, ADRs, RFCs, threat models, API
 *     specs, runbooks, postmortems, performance reports, SLO reviews, deploy
 *     logs, READMEs, onboarding docs. These are the bread-and-butter of an
 *     engineer's drive yet none of the other packs catch them, and the
 *     general-office pack mis-routes a lot of them via its overly-broad
 *     "review" / "notes" meeting keywords (an SLO review is not a meeting).
 *     Running these patterns inside `software-engineer` (priority 8) means
 *     they fire before general-office (priority 10) without leaking into
 *     drives where the user has the SWE pack disabled.
 *
 * Routing strategy: a small set of broad buckets, not a folder-per-artefact-
 * type. Engineers tend to merge anyway; better to surface 4 obvious folders
 * than 12 sparse ones.
 *
 * The bigger Software Engineer features (project-root detection, .gitignore
 * honouring) live in `code-project.ts` — that's a scanner-layer concern.
 */

// Stem patterns are matched against the filename minus extension. Letter-only
// lookarounds (not `\b`) so the keyword can sit next to digits, underscores,
// or hyphens — `SLO_review_billing` and `Performance-report-auth.pdf` both
// have non-letter neighbours that `\b` would treat as word characters.

// Design docs, ADRs, RFCs, architecture, API specs, threat models. Most
// engineering drives accumulate dozens of these — one bucket is plenty.
const DESIGN_DOC_RE = /(?<![A-Za-z])(adr|rfc|architecture|design[\s_\-]?(?:doc|document|spec|notes?)|api[\s_\-]?(?:spec|design|contract|reference)|threat[\s_\-]?model|tech[\s_\-]?(?:design|spec)|specification)(?![A-Za-z])/i;

// Incidents, postmortems, runbooks, oncall handoffs, deploy logs, outages,
// severity numbering. Operations-flavoured — runs at the cadence of "thing
// went wrong" or "thing is being deployed."
const OPERATIONS_RE = /(?<![A-Za-z])(incident(?:[\s_\-]?(?:response|report|review))?|postmortem|post[\s_\-]?mortem|runbook|run[\s_\-]?book|on[\s_\-]?call(?:[\s_\-]?handoff)?|oncall|deploy(?:ment)?[\s_\-]?(?:log|report|notes?)|outage|sev[\s_\-]?\d)(?![A-Za-z])/i;

// SLO/SLI/SLA, benchmarks, perf tests, capacity plans, load/stress tests. An
// "SLO review" is performance review of service objectives, NOT a meeting —
// so this MUST run before general-office's MEETING keyword on "review".
const PERFORMANCE_RE = /(?<![A-Za-z])(slo|sli|sla|benchmark|perf[\s_\-]?(?:test|review|report)|performance[\s_\-]?(?:report|test|review|metric|profile)|load[\s_\-]?test|stress[\s_\-]?test|capacity[\s_\-]?(?:plan|planning))(?![A-Za-z])/i;

// READMEs, onboarding decks, getting-started guides, integration tutorials.
// User-facing docs the team writes about its own systems.
const DOCUMENTATION_RE = /(?<![A-Za-z])(readme|onboarding(?:[\s_\-]?doc)?|getting[\s_\-]?started|tutorial|how[\s_\-]?to|developer[\s_\-]?guide|integration[\s_\-]?guide|setup[\s_\-]?guide|user[\s_\-]?guide)(?![A-Za-z])/i;

// Tech debt registers / refactor / migration plans / deprecation notices.
// Small bucket but distinct from design docs — these are about UNDOING
// design decisions, not making new ones.
const TECH_DEBT_RE = /(?<![A-Za-z])(tech[\s_\-]?debt|technical[\s_\-]?debt|refactor[\s_\-]?(?:plan|notes)|migration[\s_\-]?(?:plan|guide)|deprecation[\s_\-]?(?:notice|plan))(?![A-Za-z])/i;

export function classifySoftwareEngineer(
  input: PersonaInput,
): PersonaMatch | null {
  if (isInstaller(input.filePath)) {
    return {
      pack: 'software-engineer',
      category: 'Installers',
      confidence: 0.9,
    };
  }

  if (isLooseScript(input.filePath, input.fileSizeBytes)) {
    return {
      pack: 'software-engineer',
      category: 'Code Snippets',
      confidence: 0.85,
    };
  }

  // Filename-driven SWE artefact patterns. Order matters: PERFORMANCE_RE runs
  // before everything else specifically because "review" appears in
  // general-office's MEETING keyword set, and a perf/SLO review file should
  // win over the meeting fallback. Within this block the order is signal
  // strength descending — postmortem/runbook/SLO are unambiguous, while
  // "documentation" patterns like README also catch broader things.
  const stem = path.basename(input.filePath).replace(/\.[^.]+$/, '');

  if (PERFORMANCE_RE.test(stem)) {
    return { pack: 'software-engineer', category: 'Performance', confidence: 0.85 };
  }
  if (OPERATIONS_RE.test(stem)) {
    return { pack: 'software-engineer', category: 'Operations', confidence: 0.85 };
  }
  if (DESIGN_DOC_RE.test(stem)) {
    return { pack: 'software-engineer', category: 'Design Docs', confidence: 0.85 };
  }
  if (TECH_DEBT_RE.test(stem)) {
    return { pack: 'software-engineer', category: 'Tech Debt', confidence: 0.85 };
  }
  if (DOCUMENTATION_RE.test(stem)) {
    return { pack: 'software-engineer', category: 'Documentation', confidence: 0.8 };
  }

  return null;
}

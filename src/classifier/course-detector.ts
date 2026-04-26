import path from 'path';
import { isKnownDepartment, looksLikeYear } from './course-departments.js';

/**
 * Convenience helper: turn a config.course_departments string array into the
 * ReadonlySet form the detector expects. Returns undefined for empty input so
 * the detector can skip the extra lookup cheaply.
 */
export function buildExtraDepartments(
  codes: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (!codes || codes.length === 0) return undefined;
  return new Set(codes.map((c) => c.toUpperCase()));
}

/**
 * Course number detector for student-facing file organization.
 *
 * Matches patterns like:
 *   CS 3100, MATH1365, ECE-2560, BIOL 1234W, CY 2550, DS 4200, etc.
 *
 * Department code: 2–6 uppercase letters
 * Number:          3–4 digits, optional 1–2 letter suffix (e.g. "W" for Writing Intensive)
 *
 * Both boundaries use explicit lookarounds (not `\b`) because `\b` treats `_`
 * as a word character — breaking common filename patterns like
 * "CS3100_hw1.pdf" or "notes_CS3100_vs_CS5100.pdf".
 *
 * Case-insensitive — body text often reads "Math 1365" or "math 1365" rather
 * than all-caps. The allowlist comparison and the canonical output both
 * upper-case the department, so mixed-case input produces canonical
 * "MATH 1365" regardless. Suffix letters (e.g. "W" for Writing Intensive) are
 * also accepted in any case and normalized on output.
 *
 * The shape-only regex is necessary but not sufficient: we additionally require
 * the department prefix to be in a known-department allowlist, and we reject
 * year-like numbers (1900–2099). See course-departments.ts.
 */
const COURSE_RE = /(?<![A-Za-z0-9])([A-Za-z]{2,6})[\s\-]?(\d{3,4}[A-Za-z]{0,2})(?![A-Za-z0-9])/g;

export interface CourseHit {
  courseName: string; // normalized, e.g. "CS 3100"
  count: number;      // how many times it appears in the text
}

/** Canonical form: "DEPT XXXX" — uppercase, single space separator. */
function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[\s\-]/g, '');
}

function canonicalize(dept: string, num: string): string {
  return `${dept.toUpperCase()} ${num.toUpperCase()}`;
}

/**
 * Scan text for course number patterns and return matches ranked by frequency.
 * Pass the filename + extracted body text for maximum signal.
 *
 * @param text              Text to scan
 * @param extraDepartments  Optional user-supplied additional department codes
 *                          (beyond the hard-coded allowlist)
 */
export function detectCourses(
  text: string,
  extraDepartments?: ReadonlySet<string>,
): CourseHit[] {
  const counts = new Map<string, number>();
  COURSE_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = COURSE_RE.exec(text)) !== null) {
    const dept = m[1];
    const num = m[2];

    // Reject unknown department prefixes ("FAILED 2026", "LTS 2025", "ISO 9001").
    if (!isKnownDepartment(dept, extraDepartments)) continue;

    // Reject year-like numbers ("ENGL 2024" is fine; "X 2025" plus an unknown
    // dept would already be rejected, but with a known dept like HIST 2025
    // we'd still want to check — year filter catches that edge).
    if (looksLikeYear(num)) continue;

    const key = canonicalize(dept, num);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([courseName, count]) => ({ courseName, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Walk ancestor directories (up to 5 levels) and return true if any directory
 * name matches courseName (case-insensitive, ignoring spaces/hyphens).
 *
 * Examples that return true:
 *   /Documents/CS 3100/hw1.pdf           ← direct parent matches
 *   /Documents/CS3100/Homework/hw1.pdf   ← grandparent matches (no space variant)
 */
export function isAlreadyInCourseFolder(filePath: string, courseName: string): boolean {
  const target = normalize(courseName);
  let dir = path.dirname(filePath);

  for (let i = 0; i < 5; i++) {
    if (normalize(path.basename(dir)) === target) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return false;
}

/**
 * Returns the best course destination for a file, or null if:
 *   • No course number is detected, OR
 *   • The file is already inside a folder matching any detected course
 *     (i.e. it's already organized — we respect the existing placement), OR
 *   • The course signal is ambiguous (transcript / co-listed / tied mentions)
 *
 * Resolution priority:
 *   1. Filename signal. If the filename mentions exactly one course, that wins
 *      outright — "CS3100_hw1.pdf" is an explicit user-authored label.
 *   2. Body dominance. Otherwise the top body mention must clearly beat the
 *      runner-up. If multiple courses appear once each, or counts are close,
 *      we return null so the file falls through to TF-IDF / quarantine.
 *
 * Call with: detectCourseForFile(extractedText, absoluteFilePath, extraDepts?)
 *
 * @param extraDepartments  Optional user-supplied department codes from config.
 */
export function detectCourseForFile(
  text: string,
  filePath: string,
  extraDepartments?: ReadonlySet<string>,
): string | null {
  const filename = path.basename(filePath);
  const filenameCourses = detectCourses(filename, extraDepartments);
  const bodyCourses = detectCourses(text, extraDepartments);

  // Union of every course seen anywhere — used for the "already filed" check.
  const allCourseNames = new Set<string>([
    ...filenameCourses.map((c) => c.courseName),
    ...bodyCourses.map((c) => c.courseName),
  ]);

  if (allCourseNames.size === 0) return null;

  // If the file already lives under ANY detected course folder, leave it alone.
  // Prevents re-nesting a file that a previous run already organized.
  for (const courseName of allCourseNames) {
    if (isAlreadyInCourseFolder(filePath, courseName)) return null;
  }

  // ── Filename signal wins outright ─────────────────────────────────────
  // A filename like "CS3100_hw1.pdf" is an explicit label from the user.
  // Only short-circuit when the filename is unambiguous (exactly one course).
  // A filename like "CS3100_vs_CS5100.pdf" is genuinely ambiguous — fall through.
  if (filenameCourses.length === 1) {
    return filenameCourses[0].courseName;
  }

  // ── Body dominance rules ──────────────────────────────────────────────
  if (bodyCourses.length === 0) return null;

  const top = bodyCourses[0];
  const second = bodyCourses[1];

  // Transcript signature: 3+ distinct courses, none mentioned more than once.
  // (A real course's own document typically mentions its code several times.)
  if (top.count === 1 && bodyCourses.length >= 3) return null;

  // Tied or near-tied: require the leader to more than double the runner-up.
  // Protects against co-listed syllabi ("CS 3100 / CS 5100") and cross-course
  // comparison docs that shouldn't auto-route.
  if (second && top.count < 2 * second.count) return null;

  return top.courseName;
}

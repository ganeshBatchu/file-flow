/**
 * Allowlist of known US college/university department prefixes.
 *
 * Used by the course-number detector to reject shape-only matches like
 * "FAILED 2026" or "LTS 2026" — these match the DEPT-NNNN pattern but
 * aren't real courses. Without an allowlist, any capitalized word followed
 * by a 3–4 digit number becomes a false positive.
 *
 * Coverage: broad enough for most US schools, biased toward Northeastern
 * (the primary dev target) but including common codes across disciplines.
 *
 * Users can extend this list via `course_departments` in their config.
 */
export const DEFAULT_COURSE_DEPARTMENTS: ReadonlySet<string> = new Set([
  // ─── Sciences ────────────────────────────────────────────
  'BIO', 'BIOL', 'BIOC', 'BIOE', 'BIOS',
  'CHEM', 'CHME',
  'PHYS', 'PHSC',
  'EAS', 'EESC', 'ENVR', 'GEOL', 'GEOG',
  'NEUR', 'NEURO',

  // ─── Math / Stats ────────────────────────────────────────
  'MATH', 'STAT', 'AMTH',

  // ─── Computing / Data / Info ─────────────────────────────
  'CS', 'CSCI', 'COMP', 'DS', 'INFO', 'IS', 'IT',
  'CY', 'CYBR', 'SEC',

  // ─── Engineering ─────────────────────────────────────────
  'EECE', 'EECS', 'ECE', 'EE', 'CE',
  'ME', 'MECE', 'CIVE', 'CIV', 'CHE',
  'BME', 'BIOE', 'IE', 'INDE', 'MATS', 'MATL',
  'AERO', 'AEEN', 'NUCL',

  // ─── Humanities ──────────────────────────────────────────
  'ENGL', 'ENGW', 'WRTG', 'LIT',
  'PHIL', 'HIST', 'RELS', 'REL', 'CLAS', 'CLTR',

  // ─── Social Sciences ─────────────────────────────────────
  'PSYC', 'PSY',
  'ECON',
  'POLS', 'POLI', 'POL',
  'SOCL', 'SOC', 'SOCY',
  'ANTH', 'AFAM', 'AFRS', 'AMST', 'GEND', 'WMNS', 'INTL', 'GLBL',

  // ─── Arts ────────────────────────────────────────────────
  'ART', 'ARTD', 'ARTE', 'ARTF', 'ARTG', 'ARTH',
  'MUS', 'MUSC', 'MUSI',
  'THTR', 'FILM', 'CINE', 'DSGN', 'DANC',

  // ─── Business ────────────────────────────────────────────
  'ACCT', 'FINA', 'FIN',
  'MGMT', 'MGSC', 'MGT',
  'MKTG', 'MKT',
  'SCHM', 'SCH', 'BUSN', 'BUS',
  'ENTR', 'INNO', 'ORGB', 'HRM', 'OM',

  // ─── Languages ───────────────────────────────────────────
  'ARAB', 'CHNS', 'FRNH', 'FREN', 'GERM', 'HEBR', 'ITLN', 'ITAL',
  'JPNS', 'JAPA', 'KRN', 'KORE', 'LATN', 'LATI', 'RUSS', 'SPNS', 'SPAN',
  'LING',

  // ─── Communications / Media ──────────────────────────────
  'COMM', 'JRNL', 'JOUR', 'MDIA', 'MEDI',

  // ─── Health / Nursing / Pharmacy / PE ────────────────────
  'HLTH', 'HSCI', 'PBHL', 'PUBH',
  'NRSG', 'NURS',
  'PHTH', 'PHAR', 'PHMD',
  'KIN', 'KINS', 'HPE', 'PE',

  // ─── Education / Law / Professional ──────────────────────
  'EDUC', 'EDU', 'LAW', 'LLB',

  // ─── Northeastern-specific common codes ──────────────────
  'KHOU', 'HONR', 'IAF', 'THM', 'COOP',

  // ─── Other broad catch-alls ──────────────────────────────
  'GEN', 'HON', 'UNIV', 'INTD', 'INTR',
]);

/**
 * Returns true if `dept` is a known academic department code.
 *
 * @param dept     Department prefix (e.g. "CS", "MATH")
 * @param extra    Optional user-supplied additional codes from config
 */
export function isKnownDepartment(
  dept: string,
  extra?: ReadonlySet<string>,
): boolean {
  const up = dept.toUpperCase();
  if (DEFAULT_COURSE_DEPARTMENTS.has(up)) return true;
  if (extra && extra.has(up)) return true;
  return false;
}

/**
 * Course numbers must not look like calendar years. Without this guard,
 * "CLASS 2025", "ADMIT 2026", etc. would match the course pattern.
 */
export function looksLikeYear(num: string): boolean {
  const n = parseInt(num.replace(/[A-Za-z]/g, ''), 10);
  return n >= 1900 && n <= 2099;
}

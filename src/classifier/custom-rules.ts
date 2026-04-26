import path from 'path';
import type { CustomRule } from '../config/schema.js';

/**
 * User-authored filename → folder rules.
 *
 * Patterns are JavaScript regular expression source strings (without
 * surrounding `/` delimiters or flags — case-insensitivity is implicit).
 * Capture groups in the pattern can be referenced in `destination` via
 * `$1`, `$2`, etc — same syntax as a sed-style substitution. This lets
 * rules express things like:
 *
 *   pattern:     ^Project-(\w+)_
 *   destination: Projects/$1
 *
 * which sends `Project-Atlas_design.pdf` → `Projects/Atlas/`.
 *
 * Rules are evaluated in order; the first match wins. Invalid patterns
 * (regex syntax errors) are silently skipped — we never want a typo'd rule
 * to abort an entire scan.
 */

export interface CustomRuleMatch {
  destination: string;
  /** Index in the rules array — useful for journaling which rule fired. */
  ruleIndex: number;
}

/**
 * Substitute capture references ($1, $2, ...) in `template` with the
 * corresponding match groups. Unknown references resolve to empty string.
 */
function applyTemplate(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\d+)/g, (_full, n: string) => {
    const idx = parseInt(n, 10);
    return match[idx] ?? '';
  });
}

/**
 * Heuristic check for catastrophic-backtracking-prone regex shapes.
 *
 * A node-side regex engine has no native timeout, so a malicious rule like
 * `(a+)+b` can lock up the classifier on input "aaaaaaaaaaa". We can't
 * solve this perfectly without a worker-thread sandbox, but we can reject
 * the most common ReDoS shapes at compile time:
 *
 *   • Nested quantifiers: `(a+)+`, `(a*)*`, `(a+){n,m}`, `(.*)*`
 *   • Overlapping alternations with quantifiers: `(a|aa)+`, `(.|.)*`
 *   • Pathologically large bounded quantifiers: `a{10000}`
 *
 * False positives are tolerable — a user who hits this can simplify their
 * pattern. False negatives still get the input-length cap below as a
 * second line of defence.
 */
function isLikelyReDoS(pattern: string): boolean {
  // Nested unbounded quantifier: (...)+, (...)*, (...){n,} all followed by
  // another quantifier. Catches the canonical (a+)+ family.
  if (/\([^)]*[+*][^)]*\)[+*?{]/.test(pattern)) return true;
  if (/\([^)]*\{\d+,?\d*\}[^)]*\)[+*?{]/.test(pattern)) return true;
  // Alternation containing overlapping quantified branches followed by +/*.
  if (/\([^)]*\|[^)]*\)[+*]/.test(pattern) && /[+*]/.test(pattern)) return true;
  // Absurdly large bounded quantifier (e.g. {99999}).
  if (/\{\s*\d{4,}\s*[,}]/.test(pattern)) return true;
  return false;
}

/**
 * Compile a CustomRule into a runnable matcher. Returns null on invalid
 * regex source OR on patterns that look like a ReDoS footgun — caller
 * should treat that as "rule disabled."
 */
function compile(rule: CustomRule): RegExp | null {
  if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) return null;
  // Reasonable cap on pattern length — anything longer is almost certainly
  // a paste mistake or an attack and is hard to validate cheaply.
  if (rule.pattern.length > 256) return null;
  if (isLikelyReDoS(rule.pattern)) return null;
  try {
    return new RegExp(rule.pattern, 'i');
  } catch {
    return null;
  }
}

// Cap on the input the regex sees. Filenames are bounded by the FS already
// (typically 255 bytes) but matching against the basename only — never the
// full path — keeps the worst-case input size bounded regardless of where
// the file lives. Combined with the pattern checks in `compile`, this
// reduces practical ReDoS risk to "must have a sophisticated attacker who
// can edit ~/.config/fileflow/config.json directly."
const MAX_FILENAME_LEN = 256;

/**
 * Test `filePath` against each rule in order; return the first match (with
 * its substituted destination) or null if no rule fires.
 */
export function applyCustomRules(
  filePath: string,
  rules: readonly CustomRule[],
): CustomRuleMatch | null {
  if (rules.length === 0) return null;
  let filename = path.basename(filePath);
  if (filename.length > MAX_FILENAME_LEN) {
    filename = filename.slice(0, MAX_FILENAME_LEN);
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const re = compile(rule);
    if (!re) continue;

    const match = filename.match(re);
    if (!match) continue;

    const destination = applyTemplate(rule.destination, match);
    if (!destination) continue; // template resolved to empty — skip
    // Reject destination strings that try to escape the watch tree via
    // path-traversal segments. Caller (dryrun.ts) does a second containment
    // check after `path.join` resolves — this is the cheap pre-filter.
    if (destination.includes('..')) continue;
    if (path.isAbsolute(destination)) continue;
    return { destination, ruleIndex: i };
  }

  return null;
}

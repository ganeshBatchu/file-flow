import path from 'path';
import type { FileFlowConfig } from '../config/schema.js';

/**
 * Path-traversal hardening.
 *
 * Every IPC handler that takes a renderer-supplied path must run it through
 * `isPathAllowed` before reading, writing, or moving. Anything outside the
 * union of `watch_directories` ∪ all `directory_groups` (members + leaders)
 * is treated as hostile. This blocks a compromised renderer (XSS in our
 * own UI, malicious config edit, custom-rule destination traversal, etc.)
 * from telling the main process to touch system files.
 *
 * The rule is whitelist-only: callers don't get to specify what's blocked,
 * they get to specify what's allowed. The whitelist is recomputed on every
 * call so config changes take effect immediately without restart.
 */

/**
 * Resolved absolute paths the app is permitted to write under. Returned as
 * a sorted, deduped array — useful for logging "where can the app touch?".
 */
export function getAllowedRoots(config: FileFlowConfig): string[] {
  const roots = new Set<string>();
  for (const wd of config.watch_directories ?? []) {
    if (wd) roots.add(path.resolve(wd));
  }
  for (const group of config.directory_groups ?? []) {
    if (group.leader) roots.add(path.resolve(group.leader));
    for (const member of group.members ?? []) {
      if (member) roots.add(path.resolve(member));
    }
  }
  return [...roots].sort();
}

/**
 * True iff `testPath` is one of the allowed roots, or a descendant of one.
 *
 * Uses `path.resolve` to absorb `..` segments (so `/Users/x/Documents/../../etc/passwd`
 * normalizes to `/etc/passwd` and gets rejected even though the literal
 * prefix `Documents` appears in the input). Appends the platform separator
 * before the prefix check so `/foo/bar` doesn't match `/foo/barre`.
 */
export function isPathAllowed(testPath: string, config: FileFlowConfig): boolean {
  if (!testPath || typeof testPath !== 'string') return false;
  const resolved = path.resolve(testPath);
  for (const root of getAllowedRoots(config)) {
    if (resolved === root) return true;
    if (resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

/**
 * Throw a uniform error if a renderer-supplied path escapes the allowed
 * tree. Wraps `isPathAllowed` so callers don't repeat the same `if (!…)
 * throw` boilerplate. The error message is intentionally generic so the
 * renderer can't probe what's allowed by feeding paths until it stops
 * seeing the rejection — minor defense-in-depth.
 */
export function assertPathAllowed(testPath: string, config: FileFlowConfig, label = 'path'): void {
  if (!isPathAllowed(testPath, config)) {
    throw new Error(`Refused: ${label} is outside the watched/grouped directory tree.`);
  }
}

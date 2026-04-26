import path from 'path';
import type { DirectoryGroup } from './schema.js';

/**
 * Directory grouping — opt-in routing layer that lets a user bundle several
 * watched directories under one "leader" so files from any member route into
 * the leader's category tree instead of staying next to themselves.
 *
 * Use case: user watches ~/Downloads, ~/Desktop, and ~/Documents. Without
 * grouping, every Resume_*.pdf gets organized in whichever folder it
 * landed in. With a group {leader: ~/Documents, members: [~/Downloads,
 * ~/Desktop, ~/Documents]}, every Resume_*.pdf flows into
 * ~/Documents/Resumes/ regardless of arrival folder.
 *
 * Ungrouped watched directories keep their original "organize in place"
 * behaviour — the routing layer falls back to the file's own parent dir.
 */

/**
 * True iff `child` is `parent` itself or a path beneath it. Uses absolute
 * resolution to absorb trailing-slash and `..`-segment differences, and
 * appends the platform separator before the prefix check so
 * `/foo/bar` doesn't accidentally match `/foo/barre`.
 */
export function pathContains(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (c === p) return true;
  return c.startsWith(p + path.sep);
}

/**
 * Locate the group whose member tree contains `filePath`. Returns the first
 * matching group — `validateDirectoryGroups` enforces that no directory
 * appears in more than one group, so the order is deterministic for valid
 * configs. Returns `null` when the file is not under any group member.
 *
 * `filePath` may be a file or a directory; both work because we're just
 * checking containment.
 */
export function findGroupForDir(
  filePath: string,
  groups: DirectoryGroup[] | undefined,
): DirectoryGroup | null {
  if (!groups || groups.length === 0) return null;
  for (const group of groups) {
    for (const member of group.members) {
      if (pathContains(member, filePath)) return group;
    }
  }
  return null;
}

/**
 * Compute the destination directory for a file given its category. When the
 * file lives inside a grouped member directory, route to the group leader's
 * category tree (`<leader>/<category>`). Otherwise fall through to
 * `fallbackBase` — typically `path.dirname(filePath)` for the dryrun planner
 * (organize-in-place) or the matched watch directory for the daemon.
 *
 * This is the single chokepoint every classifier branch should call so the
 * grouping behaviour stays consistent across course detection, persona
 * packs, custom rules, heuristics, TF-IDF, and sibling inference.
 */
export function resolveDestDir(
  filePath: string,
  category: string,
  groups: DirectoryGroup[] | undefined,
  fallbackBase: string,
): string {
  const group = findGroupForDir(filePath, groups);
  const base = group ? group.leader : fallbackBase;
  return path.join(base, category);
}

export interface GroupValidationIssue {
  groupIndex: number;
  groupName: string;
  message: string;
}

/**
 * Validate `directory_groups` for the constraints the routing layer
 * assumes. Returns the list of issues; an empty array means the config is
 * sound. The Settings UI surfaces these inline so users see exactly what
 * they need to fix before saving.
 *
 * Constraints checked:
 *   1. Group name is non-empty.
 *   2. `leader` is one of `members` (otherwise files would route into a
 *      directory that's not part of the group at all).
 *   3. `members` are all absolute paths (relative paths break the
 *      `pathContains` check that drives routing).
 *   4. `members` contain no duplicates within a single group.
 *   5. Across all groups, no directory appears in more than one group
 *      (resolves the ambiguity of "which leader wins?").
 */
export function validateDirectoryGroups(
  groups: DirectoryGroup[],
): GroupValidationIssue[] {
  const issues: GroupValidationIssue[] = [];
  const seenAcrossGroups = new Map<string, number>();

  groups.forEach((group, idx) => {
    const label = group.name || `Group ${idx + 1}`;

    if (!group.name.trim()) {
      issues.push({ groupIndex: idx, groupName: label, message: 'Group name is required.' });
    }
    if (group.members.length === 0) {
      issues.push({ groupIndex: idx, groupName: label, message: 'Add at least one member directory.' });
    }
    if (group.leader && !group.members.includes(group.leader)) {
      issues.push({ groupIndex: idx, groupName: label, message: 'Leader must be one of the member directories.' });
    }
    if (!group.leader && group.members.length > 0) {
      issues.push({ groupIndex: idx, groupName: label, message: 'Choose a leader from the member directories.' });
    }

    const seenInGroup = new Set<string>();
    for (const member of group.members) {
      if (!path.isAbsolute(member)) {
        issues.push({ groupIndex: idx, groupName: label, message: `Member "${member}" must be an absolute path.` });
        continue;
      }
      const norm = path.resolve(member);
      if (seenInGroup.has(norm)) {
        issues.push({ groupIndex: idx, groupName: label, message: `Duplicate member: ${member}` });
      } else {
        seenInGroup.add(norm);
      }
      const owner = seenAcrossGroups.get(norm);
      if (owner !== undefined && owner !== idx) {
        issues.push({
          groupIndex: idx,
          groupName: label,
          message: `Member "${member}" already belongs to group "${groups[owner].name || `Group ${owner + 1}`}".`,
        });
      } else {
        seenAcrossGroups.set(norm, idx);
      }
    }
  });

  return issues;
}

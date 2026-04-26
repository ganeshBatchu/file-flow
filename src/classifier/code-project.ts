import fs from 'fs';
import path from 'path';

/**
 * Code-project root detection.
 *
 * A directory is a "code project root" if its top level contains any of a
 * curated set of marker files / directories that essentially never appear
 * outside source repositories. We rely on this to:
 *
 *   • Step around code projects when scanning recursively — running TF-IDF
 *     across `node_modules` and `target/build/dist` produces incoherent
 *     clusters dominated by package metadata, and wastes minutes per scan.
 *   • Skip routing of files that live inside a code-project subtree (a loose
 *     script is only a "loose script" when it's NOT inside someone's repo).
 *   • Provide a hook for the daemon's future recursive watcher to opt out of
 *     re-organizing files under a project root.
 *
 * Detection is shallow by design: ONE non-recursive `readdir` per directory.
 * We never read file contents — the marker name is the entire signal. This
 * keeps the check cheap enough to run on every directory we encounter.
 *
 * High precision is the priority. False positives (calling a non-project a
 * project) silently lock the user out of organizing real content; false
 * negatives (missing a project) produce noisy clusters but don't lose data.
 * The marker list is therefore conservative — only filenames that are
 * essentially never user content.
 */

/**
 * Exact-name markers. If `dirPath` directly contains an entry whose name
 * appears in this set, we call it a project.
 */
const PROJECT_MARKER_NAMES: ReadonlySet<string> = new Set([
  // Version control
  '.git',
  '.hg',
  '.svn',

  // JavaScript / TypeScript
  'package.json',
  'pnpm-workspace.yaml',
  'lerna.json',
  'turbo.json',
  'nx.json',

  // Rust
  'Cargo.toml',

  // Python
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',

  // Go
  'go.mod',

  // Java / Kotlin / JVM
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',

  // Ruby
  'Gemfile',

  // PHP
  'composer.json',

  // Elixir
  'mix.exs',

  // Erlang
  'rebar.config',

  // Haskell
  'stack.yaml',
  'cabal.project',

  // Generic build / container
  'Makefile',
  'CMakeLists.txt',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
]);

/**
 * Extension-based markers. If any entry under `dirPath` carries one of these
 * extensions, the directory is a project root. Each is a strong indicator on
 * its own (an `.xcodeproj` directory is never anything but an Xcode project).
 */
const PROJECT_MARKER_EXTENSIONS: ReadonlySet<string> = new Set([
  '.csproj',     // C# / .NET
  '.fsproj',
  '.vbproj',
  '.xcodeproj',  // Xcode bundle (a directory that ends in .xcodeproj)
  '.xcworkspace',
  '.sln',        // Visual Studio solution
]);

/**
 * Return true if `dirPath` looks like a code-project root. Performs a single
 * shallow `readdir`; never recurses, never opens file contents. Returns false
 * on any I/O error (permission denied, missing dir, etc.) — callers should
 * treat that as "not a project" and fall through to the regular pipeline.
 */
export function isCodeProjectDir(dirPath: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (PROJECT_MARKER_NAMES.has(entry.name)) return true;
    const ext = path.extname(entry.name);
    if (ext && PROJECT_MARKER_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

/**
 * Walk ancestor directories starting from the file's parent and return the
 * closest enclosing code-project root, or null if none is found within
 * `maxLevels` ancestors.
 *
 * Used to answer: "is this loose `.py` file actually buried inside the user's
 * git repo?" If so, leave it alone — it's not a stray script.
 *
 * The default `maxLevels` of 6 is a safe upper bound for typical project
 * layouts; raising it would slow scans on deeply-nested file trees without
 * meaningful precision gain.
 */
export function findEnclosingProjectRoot(
  filePath: string,
  maxLevels = 6,
): string | null {
  let dir = path.dirname(filePath);
  for (let i = 0; i < maxLevels; i++) {
    if (isCodeProjectDir(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Convenience: true iff the file lives inside a code-project subtree.
 * Equivalent to `findEnclosingProjectRoot(filePath) !== null` but reads
 * better at call sites that don't care which root.
 */
export function isInsideCodeProject(filePath: string, maxLevels = 6): boolean {
  return findEnclosingProjectRoot(filePath, maxLevels) !== null;
}

/**
 * Parse a .gitignore file at `gitignorePath` into picomatch-compatible glob
 * patterns. Strips comments (`#`) and blank lines; preserves `!` negations
 * unchanged for downstream matchers that understand them.
 *
 * Returns an empty array if the file is missing or unreadable — calling code
 * should treat that as "no ignore rules" and proceed normally.
 */
export function parseGitignore(gitignorePath: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    return [];
  }
  const patterns: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    patterns.push(trimmed);
  }
  return patterns;
}

/**
 * Cache so a single recursive scan doesn't reparse the same `.gitignore`
 * every time we hit a new file under that project root.
 */
const gitignoreCache = new Map<string, string[]>();

/**
 * Return the merged glob list from every `.gitignore` between the file's
 * parent and the enclosing project root (inclusive). Closer .gitignore files
 * take precedence in conventional Git semantics; for our purposes (deciding
 * whether to skip a file) ANY hit means "skip", so a flat union is correct.
 *
 * Empty array if the file isn't inside a project root.
 */
export function gitignorePatternsFor(filePath: string): string[] {
  const root = findEnclosingProjectRoot(filePath);
  if (!root) return [];

  const patterns: string[] = [];
  let dir = path.dirname(filePath);
  // Walk upward, picking up .gitignore at each level until we pass the root.
  while (true) {
    const giPath = path.join(dir, '.gitignore');
    let cached = gitignoreCache.get(giPath);
    if (cached === undefined) {
      cached = parseGitignore(giPath);
      gitignoreCache.set(giPath, cached);
    }
    patterns.push(...cached);
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return patterns;
}

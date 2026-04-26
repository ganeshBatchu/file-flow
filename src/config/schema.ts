import { z } from 'zod';

export const CategoryConfigSchema = z.object({
  keywords: z.array(z.string()),
  centroid: z.array(z.number()),
});

export const DaemonConfigSchema = z.object({
  debounce_seconds: z.number().default(2),
  log_level: z.string().default('info'),
  log_max_size_mb: z.number().default(10),
  auto_start: z.boolean().default(false),
});

export const DuplicatesConfigSchema = z.object({
  default_action: z
    .enum(['prompt', 'keep-newer', 'keep-older', 'keep-both', 'skip'])
    .default('prompt'),
  hash_cache_path: z.string(),
});

// Built-in persona pack identifiers. Each pack contributes filename / content
// classifiers that run in priority order before TF-IDF. Adding a pack here
// AND in `personas/index.ts` is the only step required to ship a new pack.
export const PersonaPackSchema = z.enum([
  'software-engineer',
  'researcher',
  'photographer',
  'designer',
  'lawyer',
  'accountant',
  'writer',
  'data-scientist',
  'job-seeker',
  'general-office',
]);
export type PersonaPack = z.infer<typeof PersonaPackSchema>;

// User-authored filename → folder rule. Patterns may contain capture groups
// referenced in `destination` via $1 / $2 / etc — same syntax as a sed-style
// substitution. Applied AFTER persona classifiers but BEFORE TF-IDF, so a
// targeted rule wins over generic clustering but doesn't override
// high-precision built-in detection (course numbers, etc.).
export const CustomRuleSchema = z.object({
  pattern: z.string(),
  destination: z.string(),
});
export type CustomRule = z.infer<typeof CustomRuleSchema>;

// Directory group: bundle several watched directories under a single
// "leader" so files from any member route into the leader's category tree
// instead of staying in their own parent. Use case: a user with
// ~/Downloads, ~/Desktop, and ~/Documents all watched separately can group
// them with ~/Documents as leader so every Resume_*.pdf lands in
// ~/Documents/Resumes/ regardless of which folder it arrived in.
//
// Invariants enforced by `validateDirectoryGroups`:
//   • `leader` MUST be one of `members`
//   • `members` are absolute paths, no duplicates
//   • a directory may belong to AT MOST one group (first match wins at runtime)
export const DirectoryGroupSchema = z.object({
  name: z.string().min(1),
  leader: z.string(),
  members: z.array(z.string()),
});
export type DirectoryGroup = z.infer<typeof DirectoryGroupSchema>;

export const FileFlowConfigSchema = z.object({
  watch_directories: z.array(z.string()),
  exclusions: z.array(z.string()),
  categories: z.record(z.string(), CategoryConfigSchema),
  confidence_threshold: z.number().default(0.3),
  uncategorized_folder: z.string().default('Uncategorized'),
  max_file_size_mb: z.number().default(50),
  // Additional course-number department prefixes beyond the built-in allowlist.
  // Example: ["HRM", "ORIE"] if your school uses codes not in the default list.
  course_departments: z.array(z.string()).default([]),
  // Enabled persona packs — high-precision classifiers tuned for specific user
  // demographics (developers, researchers, photographers, …). All packs are
  // enabled by default because each is conservative — files outside its
  // domain fall through cleanly to the next stage in the pipeline.
  personas: z.array(PersonaPackSchema).default([
    'software-engineer',
    'researcher',
    'photographer',
    'designer',
    'lawyer',
    'accountant',
    'writer',
    'data-scientist',
    'job-seeker',
    'general-office',
  ]),
  // User-authored filename pattern rules. Empty by default; populated via the
  // Custom Rules UI on the Categories page.
  custom_rules: z.array(CustomRuleSchema).default([]),
  // Directory groups: route files from any member directory into the leader
  // directory's category tree. Empty by default — every watched directory
  // is organized in place. See DirectoryGroupSchema for invariants.
  directory_groups: z.array(DirectoryGroupSchema).default([]),
  // Maximum recursion depth when scanning the target directory.
  //   0 = top-level files only (default — never touches preorganized subdirs).
  //   1 = also includes files in immediate subdirectories.
  //   N = N levels deep.
  // Code-project roots (anything with a `.git`, `package.json`, `Cargo.toml`,
  // …) are still skipped regardless of depth — descend into them is almost
  // never what a user wants. Capped at 8 to prevent runaway scans on
  // pathological trees.
  max_scan_depth: z.number().int().min(0).max(8).default(0),
  daemon: DaemonConfigSchema,
  duplicates: DuplicatesConfigSchema,
  journal_path: z.string(),
  max_journal_entries: z.number().default(500),
});

export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;
export type DuplicatesConfig = z.infer<typeof DuplicatesConfigSchema>;
export type FileFlowConfig = z.infer<typeof FileFlowConfigSchema>;

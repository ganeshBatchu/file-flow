import os from 'os';
import path from 'path';
import type { FileFlowConfig } from './schema.js';

const home = os.homedir();

export const DEFAULT_CONFIG: FileFlowConfig = {
  watch_directories: [path.join(home, 'Documents')],
  exclusions: [
    'node_modules',
    '.git',
    '*.tmp',
    '.cache',
    'Library/',
    'AppData/',
    '.local/share',
    '*.partial',
    '*.crdownload',
    '.Trash',
    '.config/fileflow',
    'fileflow/',
    '.DS_Store',
    '*.DS_Store',
    // Repo boilerplate — never user content, don't clutter quarantine
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'LICENCE',
    'LICENCE.md',
    'LICENCE.txt',
    'README',
    'README.md',
    'README.txt',
    'README.rst',
    'AUTHORS',
    'AUTHORS.md',
    'AUTHORS.txt',
    'CONTRIBUTORS',
    'CONTRIBUTORS.md',
    'CONTRIBUTORS.txt',
    'CHANGELOG',
    'CHANGELOG.md',
    'CHANGELOG.txt',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
    // Code-project artefacts — generated build output and tooling caches that
    // never contain user-authored content. Listed as directory names so they
    // match anywhere in a recursive scan path. Safe to keep even for non-dev
    // users: these names virtually never collide with personal files.
    'dist',
    'build',
    'target',
    'out',
    'bin',
    'obj',
    '__pycache__',
    '.venv',
    'venv',
    '.tox',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.next',
    '.nuxt',
    '.svelte-kit',
    'coverage',
    '.gradle',
    '.idea',
    '.vscode',
    'vendor',
    'Pods',
    'DerivedData',
    '.terraform',
    '.serverless',
    // ML / Data Science artefact directories — generated experiment output that
    // never carries user-authored content the clusterer should learn from.
    'mlruns',
    'wandb',
    'lightning_logs',
    'tb_logs',
    '.ipynb_checkpoints',
    '.dvc',
  ],
  categories: {},
  confidence_threshold: 0.3,
  uncategorized_folder: 'Uncategorized',
  max_file_size_mb: 50,
  course_departments: [],
  personas: [
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
  ],
  custom_rules: [],
  // Directory groups (e.g. ~/Downloads + ~/Desktop → ~/Documents) are an
  // explicit opt-in. Empty by default = each watched dir organized in place.
  directory_groups: [],
  // Top-level-only by default. The organizer is intentionally non-recursive
  // out of the box to avoid disturbing already-organized subdirectories.
  // Users can raise this in Settings, or opt-in per-folder from the preview UI.
  max_scan_depth: 0,
  daemon: {
    debounce_seconds: 2,
    log_level: 'info',
    log_max_size_mb: 10,
    auto_start: false,
  },
  duplicates: {
    default_action: 'prompt',
    hash_cache_path: path.join(home, '.config', 'fileflow', 'hash_cache.json'),
  },
  journal_path: path.join(home, '.config', 'fileflow', 'journal.json'),
  max_journal_entries: 500,
};

export const CONFIG_DIR = path.join(home, '.config', 'fileflow');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const LOG_PATH = path.join(CONFIG_DIR, 'daemon.log');
export const PID_PATH = path.join(CONFIG_DIR, 'daemon.pid');

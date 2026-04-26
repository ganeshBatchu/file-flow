/**
 * Post-install script: ensures config directory and default config exist.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'fileflow');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  watch_directories: [path.join(os.homedir(), 'Downloads')],
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
  ],
  categories: {},
  confidence_threshold: 0.3,
  uncategorized_folder: 'Uncategorized',
  max_file_size_mb: 50,
  daemon: {
    debounce_seconds: 2,
    log_level: 'info',
    log_max_size_mb: 10,
    auto_start: false,
  },
  duplicates: {
    default_action: 'prompt',
    hash_cache_path: path.join(os.homedir(), '.config', 'fileflow', 'hash_cache.json'),
  },
  journal_path: path.join(os.homedir(), '.config', 'fileflow', 'journal.json'),
  max_journal_entries: 500,
};

try {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    console.log(`FileFlow: created default config at ${CONFIG_PATH}`);
  } else {
    console.log(`FileFlow: config already exists at ${CONFIG_PATH}`);
  }
} catch (err) {
  // Non-fatal — user can create config manually
  console.warn(`FileFlow: could not create config directory: ${(err as Error).message}`);
}

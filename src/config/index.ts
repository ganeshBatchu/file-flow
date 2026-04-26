import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileFlowConfigSchema, type FileFlowConfig } from './schema.js';
import { DEFAULT_CONFIG, CONFIG_PATH, CONFIG_DIR } from './defaults.js';

export { isExcluded } from './exclusions.js';
export { DEFAULT_CONFIG, CONFIG_PATH, CONFIG_DIR } from './defaults.js';
export type { FileFlowConfig, CategoryConfig } from './schema.js';

/**
 * Load and validate config from disk. Falls back to defaults on any error.
 */
export async function loadConfig(): Promise<FileFlowConfig> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.warn('[loadConfig] No config file found at', CONFIG_PATH, '— using defaults');
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = FileFlowConfigSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.error('[loadConfig] Zod validation FAILED — falling back to defaults!');
    console.error('[loadConfig] Validation errors:', JSON.stringify(result.error.issues, null, 2));
    return { ...DEFAULT_CONFIG };
  } catch (err) {
    console.error('[loadConfig] Parse/read error — falling back to defaults:', (err as Error).message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write config to disk.
 */
export async function saveConfig(config: FileFlowConfig): Promise<void> {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Expand ~ in all path fields of the config.
 */
export function resolveConfigPaths(config: FileFlowConfig): FileFlowConfig {
  const home = os.homedir();
  const expandPath = (p: string) => p.replace(/^~/, home);

  return {
    ...config,
    watch_directories: config.watch_directories.map(expandPath),
    // Expand ~ in every directory_group path so runtime comparisons against
    // absolute file paths work without surprises.
    directory_groups: (config.directory_groups ?? []).map((g) => ({
      ...g,
      leader: expandPath(g.leader),
      members: g.members.map(expandPath),
    })),
    duplicates: {
      ...config.duplicates,
      hash_cache_path: expandPath(config.duplicates.hash_cache_path),
    },
    journal_path: expandPath(config.journal_path),
  };
}

/**
 * Ensure the config directory and default config file exist.
 */
export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }
}

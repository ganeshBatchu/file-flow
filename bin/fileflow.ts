#!/usr/bin/env node
/**
 * FileFlow CLI — cross-platform intelligent file organizer
 *
 * Commands:
 *   fileflow start            Start the background daemon
 *   fileflow stop             Stop the daemon
 *   fileflow status           Show daemon status + stats
 *   fileflow organize [dir]   One-shot organize with preview
 *   fileflow categories       List categories
 *   fileflow scan [dir]       Re-scan and suggest categories
 *   fileflow history          Show operation history
 *   fileflow undo [id]        Undo last operation (or by ID)
 *   fileflow quarantine       List quarantined files
 *   fileflow config           Show current config
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { loadConfig, saveConfig, ensureConfigDir, resolveConfigPaths } from '../src/config/index.js';
import { FileFlowDaemon } from '../src/daemon/index.js';
import { buildPreviewPlan } from '../src/safety/dryrun.js';
import { organizeFiles } from '../src/organizer/mover.js';
import { undoLast, undoById } from '../src/organizer/undo.js';
import { listQuarantined, resolveQuarantined, deleteQuarantined } from '../src/safety/quarantine.js';
import { queryJournal } from '../src/safety/journal.js';
import { CategoryManager } from '../src/classifier/categories.js';
import { loadHashCache, saveHashCache } from '../src/organizer/dedup.js';
import { CONFIG_DIR } from '../src/config/defaults.js';

const DAEMON_STATE_PATH = path.join(CONFIG_DIR, 'daemon.state.json');

const program = new Command();

program
  .name('fileflow')
  .description('Intelligent file organizer using TF-IDF classification')
  .version('1.0.0');

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the background file watcher daemon')
  .action(async () => {
    ensureConfigDir();
    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);

    console.log(chalk.green('Starting FileFlow daemon...'));
    console.log(chalk.dim(`Watching: ${resolved.watch_directories.join(', ')}`));

    const daemon = new FileFlowDaemon(resolved);

    daemon.onActivity((activity) => {
      const ts = activity.timestamp.toLocaleTimeString();
      switch (activity.type) {
        case 'move':
          console.log(
            chalk.green(`[${ts}] MOVE`) +
            ` ${path.basename(activity.srcPath)} → ${activity.category}/` +
            chalk.dim(` (${(activity.confidence! * 100).toFixed(0)}%)`),
          );
          break;
        case 'quarantine':
          console.log(
            chalk.yellow(`[${ts}] SKIP`) +
            ` ${path.basename(activity.srcPath)} → Uncategorized` +
            (activity.confidence ? chalk.dim(` (${(activity.confidence * 100).toFixed(0)}%)`) : ''),
          );
          break;
        case 'dedup':
          console.log(
            chalk.blue(`[${ts}] DEDUP`) +
            ` ${path.basename(activity.srcPath)} (duplicate skipped)`,
          );
          break;
        case 'error':
          console.log(
            chalk.red(`[${ts}] ERROR`) +
            ` ${path.basename(activity.srcPath)}: ${activity.message}`,
          );
          break;
      }
    });

    daemon.start();
    fs.writeFileSync(DAEMON_STATE_PATH, JSON.stringify({ running: true, pid: process.pid }));

    console.log(chalk.green('Daemon running. Press Ctrl+C to stop.'));

    process.on('SIGINT', () => {
      daemon.stop();
      fs.writeFileSync(DAEMON_STATE_PATH, JSON.stringify({ running: false }));
      console.log(chalk.yellow('\nDaemon stopped.'));
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      daemon.stop();
      fs.writeFileSync(DAEMON_STATE_PATH, JSON.stringify({ running: false }));
      process.exit(0);
    });

    // Keep process alive
    setInterval(() => {}, 60_000);
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show daemon status and statistics')
  .action(async () => {
    ensureConfigDir();
    let state = { running: false, pid: null as number | null };
    try {
      if (fs.existsSync(DAEMON_STATE_PATH)) {
        state = JSON.parse(fs.readFileSync(DAEMON_STATE_PATH, 'utf-8'));
      }
    } catch { /* ignore */ }

    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);

    const statusDot = state.running ? chalk.green('●') : chalk.gray('○');
    const statusText = state.running ? chalk.green('Running') : chalk.gray('Stopped');

    console.log(`\nDaemon: ${statusDot} ${statusText}`);
    console.log(`Watching: ${resolved.watch_directories.join(', ')}`);
    console.log(`Categories: ${Object.keys(config.categories).length}`);
    console.log(`Confidence threshold: ${(config.confidence_threshold * 100).toFixed(0)}%`);
    console.log(`Journal: ${resolved.journal_path}\n`);
  });

// ─── organize ─────────────────────────────────────────────────────────────────

program
  .command('organize [dir]')
  .description('Organize files in a directory (shows preview first)')
  .option('--yes', 'Skip confirmation and execute immediately')
  .action(async (dir: string | undefined, opts: { yes?: boolean }) => {
    ensureConfigDir();
    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);
    const targetDir = dir
      ? path.resolve(dir)
      : resolved.watch_directories[0];

    if (!fs.existsSync(targetDir)) {
      console.error(chalk.red(`Directory not found: ${targetDir}`));
      process.exit(1);
    }

    const spinner = ora('Scanning and classifying files...').start();
    const cache = loadHashCache(resolved.duplicates.hash_cache_path);

    let plan;
    try {
      plan = await buildPreviewPlan(targetDir, resolved, cache);
      spinner.succeed(`Scanned ${plan.totalFiles} files`);
    } catch (err) {
      spinner.fail(`Scan failed: ${(err as Error).message}`);
      process.exit(1);
    }

    // Show preview
    console.log('');
    if (plan.moves.length === 0 && plan.quarantined.length === 0) {
      console.log(chalk.dim('Nothing to organize.'));
      return;
    }

    if (plan.moves.length > 0) {
      console.log(chalk.bold(`Planned moves (${plan.moves.length}):`));
      const table = new Table({
        head: ['File', 'Category', 'Confidence', 'Note'],
        colWidths: [40, 20, 12, 12],
      });
      for (const m of plan.moves.slice(0, 30)) {
        table.push([
          path.basename(m.srcPath),
          m.category,
          `${(m.confidence * 100).toFixed(0)}%`,
          m.duplicate ? chalk.blue('duplicate') : m.collision ? chalk.yellow('renamed') : '',
        ]);
      }
      if (plan.moves.length > 30) {
        console.log(chalk.dim(`  ... and ${plan.moves.length - 30} more`));
      }
      console.log(table.toString());
    }

    if (plan.quarantined.length > 0) {
      console.log(chalk.yellow(`\nQuarantined (low confidence): ${plan.quarantined.length} files`));
    }

    if (plan.duplicates.length > 0) {
      console.log(chalk.blue(`\nDuplicates detected: ${plan.duplicates.length} pairs`));
    }

    if (plan.errors.length > 0) {
      console.log(chalk.red(`\nErrors: ${plan.errors.length} files`));
    }

    // Require categories before first run
    if (Object.keys(resolved.categories).length === 0) {
      console.log(chalk.yellow('\nNo categories defined. Run `fileflow scan` first to suggest categories.'));
      return;
    }

    const confirmed =
      opts.yes ||
      (
        await inquirer.prompt([
          {
            type: 'confirm',
            name: 'ok',
            message: `Execute ${plan.moves.length} move(s)?`,
            default: false,
          },
        ])
      ).ok;

    if (!confirmed) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    const executeSpinner = ora('Organizing files...').start();
    const moveBatch = plan.moves
      .filter((m) => !m.duplicate)
      .map((m) => ({
        srcPath: m.srcPath,
        destDir: m.destDir,
        category: m.category,
        confidence: m.confidence,
      }));

    const result = await organizeFiles(moveBatch, resolved, cache);
    saveHashCache(resolved.duplicates.hash_cache_path, cache);

    executeSpinner.succeed(`Moved ${result.moved.length} files`);
    if (result.errors.length > 0) {
      console.log(chalk.red(`${result.errors.length} errors:`));
      for (const e of result.errors) {
        console.log(chalk.red(`  ${path.basename(e.path)}: ${e.error}`));
      }
    }
  });

// ─── scan ─────────────────────────────────────────────────────────────────────

program
  .command('scan [dir]')
  .description('Scan directory and suggest categories using TF-IDF clustering')
  .option('-k, --clusters <n>', 'Number of clusters (default: 5)', '5')
  .action(async (dir: string | undefined, opts: { clusters: string }) => {
    ensureConfigDir();
    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);
    const targetDir = dir
      ? path.resolve(dir)
      : resolved.watch_directories[0];

    if (!fs.existsSync(targetDir)) {
      console.error(chalk.red(`Directory not found: ${targetDir}`));
      process.exit(1);
    }

    const spinner = ora('Scanning files and building TF-IDF model...').start();

    // Collect files
    const files: string[] = [];
    function collect(d: string) {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, entry.name);
          if (entry.isDirectory()) collect(fp);
          else if (entry.isFile()) files.push(fp);
        }
      } catch { /* skip */ }
    }
    collect(targetDir);

    const manager = new CategoryManager(resolved);
    const k = Math.max(1, parseInt(opts.clusters, 10));
    const suggestions = await manager.suggestCategories(
      files.map((p) => ({ path: p })),
      k,
    );

    spinner.succeed(`Found ${suggestions.length} suggested categories from ${files.length} files`);

    if (suggestions.length === 0) {
      console.log(chalk.dim('No meaningful clusters found.'));
      return;
    }

    console.log('\n' + chalk.bold('Suggested categories:'));
    const table = new Table({
      head: ['Category', 'Files', 'Top Keywords'],
      colWidths: [25, 8, 50],
    });
    for (const s of suggestions) {
      table.push([s.name, s.fileCount, s.keywords.slice(0, 6).join(', ')]);
    }
    console.log(table.toString());

    const { chosen } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'chosen',
        message: 'Select categories to save (space to toggle, enter to confirm):',
        choices: suggestions.map((s) => ({ name: `${s.name} (${s.fileCount} files)`, value: s.name, checked: true })),
      },
    ]);

    if (chosen.length === 0) {
      console.log(chalk.dim('No categories selected.'));
      return;
    }

    // Allow renaming
    const renames: { original: string; final: string }[] = [];
    for (const name of chosen) {
      const { renamed } = await inquirer.prompt([
        {
          type: 'input',
          name: 'renamed',
          message: `Name for category "${name}":`,
          default: name,
        },
      ]);
      renames.push({ original: name, final: renamed });
    }

    // Save selected categories to config
    const saveSpinner = ora('Saving categories...').start();
    for (const { original, final } of renames) {
      const suggestion = suggestions.find((s) => s.name === original)!;
      await manager.saveCategoryToConfig(final, suggestion.keywords, suggestion.centroid);
    }
    saveSpinner.succeed(`Saved ${renames.length} categories to config`);
    console.log(chalk.dim(`Config: ${path.join(os.homedir(), '.config', 'fileflow', 'config.json')}`));
  });

// ─── categories ───────────────────────────────────────────────────────────────

program
  .command('categories')
  .alias('cat')
  .description('List all defined categories')
  .action(async () => {
    const config = await loadConfig();
    const cats = Object.entries(config.categories);

    if (cats.length === 0) {
      console.log(chalk.dim('No categories defined. Run `fileflow scan` to suggest some.'));
      return;
    }

    const table = new Table({
      head: ['Category', 'Keywords'],
      colWidths: [25, 60],
    });
    for (const [name, cat] of cats) {
      table.push([name, cat.keywords.slice(0, 8).join(', ')]);
    }
    console.log(table.toString());
  });

// ─── history ──────────────────────────────────────────────────────────────────

program
  .command('history')
  .description('Show operation history')
  .option('-n, --limit <n>', 'Number of entries to show', '20')
  .option('--category <name>', 'Filter by category')
  .option('--search <query>', 'Search by filename')
  .action(async (opts: { limit: string; category?: string; search?: string }) => {
    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);

    const entries = queryJournal(resolved.journal_path, {
      category: opts.category,
      search: opts.search,
    });

    const limit = parseInt(opts.limit, 10);
    const shown = entries.slice(-limit).reverse();

    if (shown.length === 0) {
      console.log(chalk.dim('No history entries found.'));
      return;
    }

    const table = new Table({
      head: ['ID (short)', 'Time', 'Action', 'From', 'To', 'Category'],
      colWidths: [14, 10, 8, 30, 30, 18],
    });

    for (const entry of shown) {
      const shortId = entry.id.slice(-8);
      const time = new Date(entry.timestamp).toLocaleTimeString();
      for (const op of entry.operations) {
        if (op.type === 'move') {
          table.push([
            shortId,
            time,
            op.type.toUpperCase(),
            path.basename(op.from ?? ''),
            path.basename(op.to ?? ''),
            entry.category ?? '',
          ]);
        }
      }
    }

    console.log(table.toString());
    console.log(chalk.dim(`Showing ${shown.length} of ${entries.length} total entries`));
  });

// ─── undo ─────────────────────────────────────────────────────────────────────

program
  .command('undo [id]')
  .description('Undo the last operation, or a specific operation by ID')
  .action(async (id: string | undefined) => {
    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);

    const spinner = ora('Undoing...').start();
    const result = id
      ? await undoById(id, resolved.journal_path)
      : await undoLast(resolved.journal_path);

    if (!result) {
      spinner.fail('No operation found to undo.');
      return;
    }

    if (result.errors.length === 0) {
      spinner.succeed(`Undone: ${result.reversed.join(', ')}`);
    } else {
      spinner.warn(`Partially undone. Errors:`);
      for (const e of result.errors) {
        console.log(chalk.red(`  ${e.path}: ${e.error}`));
      }
    }
  });

// ─── quarantine ───────────────────────────────────────────────────────────────

program
  .command('quarantine')
  .alias('q')
  .description('Review and resolve quarantined files')
  .action(async () => {
    const config = await loadConfig();
    const resolved = resolveConfigPaths(config);
    const watchDir = resolved.watch_directories[0];

    const files = listQuarantined(watchDir, resolved);

    if (files.length === 0) {
      console.log(chalk.dim('No quarantined files.'));
      return;
    }

    console.log(chalk.yellow(`${files.length} quarantined file(s):\n`));

    for (const file of files) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(2);
      console.log(chalk.bold(file.filename) + chalk.dim(` (${sizeMb} MB)`));

      const categories = Object.keys(config.categories);
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: `  Action for ${file.filename}:`,
          choices: [
            { name: 'Leave in place', value: 'skip' },
            ...categories.map((c) => ({ name: `Move to → ${c}/`, value: `cat:${c}` })),
            { name: 'Create new category', value: 'new' },
            { name: chalk.red('Delete'), value: 'delete' },
          ],
        },
      ]);

      const cache = loadHashCache(resolved.duplicates.hash_cache_path);

      if (action === 'skip') {
        continue;
      } else if (action === 'delete') {
        deleteQuarantined(file.path);
        console.log(chalk.red(`  Deleted ${file.filename}`));
      } else if (action === 'new') {
        const { newName } = await inquirer.prompt([
          { type: 'input', name: 'newName', message: '  New category name:' },
        ]);
        if (newName) {
          await resolveQuarantined(file.path, newName, watchDir, resolved, cache);
          console.log(chalk.green(`  Moved to ${newName}/`));
        }
      } else if (action.startsWith('cat:')) {
        const catName = action.slice(4);
        await resolveQuarantined(file.path, catName, watchDir, resolved, cache);
        console.log(chalk.green(`  Moved to ${catName}/`));
      }

      saveHashCache(resolved.duplicates.hash_cache_path, cache);
    }
  });

// ─── config ───────────────────────────────────────────────────────────────────

program
  .command('config')
  .description('Show current configuration')
  .option('--set <key=value>', 'Set a top-level config value')
  .option('--reset', 'Reset config to defaults')
  .action(async (opts: { set?: string; reset?: boolean }) => {
    ensureConfigDir();

    if (opts.reset) {
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: 'Reset config to defaults?', default: false },
      ]);
      if (confirm) {
        const { DEFAULT_CONFIG } = await import('../src/config/defaults.js');
        await saveConfig(DEFAULT_CONFIG);
        console.log(chalk.green('Config reset to defaults.'));
      }
      return;
    }

    if (opts.set) {
      const eqIdx = opts.set.indexOf('=');
      if (eqIdx === -1) {
        console.error(chalk.red('Use --set key=value'));
        process.exit(1);
      }
      const key = opts.set.slice(0, eqIdx);
      const val = opts.set.slice(eqIdx + 1);
      const config = await loadConfig();
      (config as Record<string, unknown>)[key] = isNaN(Number(val)) ? val : Number(val);
      await saveConfig(config);
      console.log(chalk.green(`Set ${key} = ${val}`));
      return;
    }

    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

program.parse(process.argv);

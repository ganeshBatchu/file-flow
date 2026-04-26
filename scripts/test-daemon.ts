/* eslint-disable no-console */
/**
 * Daemon end-to-end test harness.
 *
 * Boots a real FileFlowDaemon against a throwaway temp dir, drops files into
 * it, and asserts the daemon routes them to the right destination. There's
 * no test framework here on purpose — this script runs as `npx tsx
 * scripts/test-daemon.ts`, exits 0 on success / 1 on failure, and prints a
 * tick/cross summary. Cheap to invoke from CI or by hand.
 *
 * Why a real daemon and not unit tests on the classifier: bugs that have hit
 * users in this codebase have lived in the seams — chokidar watch options,
 * the debounce-classify-move chain, the rescan-after-organize loop. A unit
 * test on `classifyAndOrganize` in isolation can't catch those. Spinning up
 * the watcher exercises every layer in production order.
 *
 * The harness backs up `~/.config/fileflow/config.json` before each scenario
 * because the daemon's auto-register-on-success path calls `saveConfig()` to
 * the real config path on disk. We restore on teardown so a failed test run
 * never clobbers a user's real config.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileFlowDaemon, type DaemonActivity } from '../src/daemon/index.js';
import { DEFAULT_CONFIG, CONFIG_PATH } from '../src/config/defaults.js';
import type { FileFlowConfig } from '../src/config/schema.js';

const WORK_DIR = path.join(os.tmpdir(), `fileflow-test-${Date.now()}`);
const WATCH_DIR = path.join(WORK_DIR, 'watched');
const UNCAT_DIR = path.join(WATCH_DIR, 'Uncategorized');
const CONFIG_BACKUP = path.join(WORK_DIR, 'config.backup.json');

// chokidar's stabilityThreshold (1s in watcher.ts) + the configurable debounce
// dominate the wait. Plus a small slack so concurrent tests don't fail on
// scheduling jitter. Bumping this is the first thing to try if the suite gets
// flaky on a slow disk.
const STABILITY_PLUS_DEBOUNCE_MS = 1_500;

function makeConfig(overrides: Partial<FileFlowConfig> = {}): FileFlowConfig {
  return {
    ...DEFAULT_CONFIG,
    watch_directories: [WATCH_DIR],
    categories: {},
    daemon: {
      ...DEFAULT_CONFIG.daemon,
      // Slow tests just sit on this debounce, so push it as low as the schema
      // allows. The 1s chokidar stability threshold still gates each event.
      debounce_seconds: 0.1,
    },
    duplicates: {
      default_action: 'skip',
      hash_cache_path: path.join(WORK_DIR, 'hash_cache.json'),
    },
    journal_path: path.join(WORK_DIR, 'journal.json'),
    ...overrides,
  };
}

let daemon: FileFlowDaemon | null = null;
const activities: DaemonActivity[] = [];

function backupConfig(): void {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, CONFIG_BACKUP);
  }
}

function restoreConfig(): void {
  if (fs.existsSync(CONFIG_BACKUP)) {
    fs.copyFileSync(CONFIG_BACKUP, CONFIG_PATH);
  }
}

async function setup(config: FileFlowConfig): Promise<void> {
  fs.mkdirSync(WATCH_DIR, { recursive: true });
  daemon = new FileFlowDaemon(config);
  daemon.onActivity((a) => activities.push(a));
  daemon.start();
  // Give chokidar a beat to attach its listeners before tests start dropping
  // files. Without this the first drop in a freshly-started daemon
  // occasionally races the FSWatcher.add binding.
  await sleep(300);
}

async function teardown(): Promise<void> {
  if (daemon) {
    daemon.stop();
    daemon = null;
  }
  // Drain any in-flight chokidar events before nuking the dir, otherwise
  // chokidar's pollers can throw ENOENT into the test runner's stderr.
  await sleep(200);
  fs.rmSync(WATCH_DIR, { recursive: true, force: true });
  // Wipe the per-test categories-and-counters state from the real config too.
  restoreConfig();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dropFile(name: string, content = 'placeholder content for tests'): string {
  const fp = path.join(WATCH_DIR, name);
  fs.writeFileSync(fp, content);
  return fp;
}

async function waitForActivity(
  srcPath: string,
  predicate: (a: DaemonActivity) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<DaemonActivity> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = activities.find((a) => a.srcPath === srcPath && predicate(a));
    if (found) return found;
    await sleep(100);
  }
  throw new Error(`Timeout waiting for activity matching ${path.basename(srcPath)}`);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  activities.length = 0;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${(err as Error).message}`);
    failed++;
  }
}

async function main(): Promise<void> {
  console.log(`Daemon test harness — temp dir ${WORK_DIR}\n`);
  fs.mkdirSync(WORK_DIR, { recursive: true });
  backupConfig();

  try {
    // ── Persona pack routing ──────────────────────────────────────
    console.log('Persona packs:');
    await setup(makeConfig());

    await test('installer extension routes to Installers/', async () => {
      const fp = dropFile('app-installer.dmg');
      const a = await waitForActivity(fp);
      assert(a.type === 'move', `expected type=move, got ${a.type}`);
      assert(a.category === 'Installers', `expected Installers, got ${a.category}`);
      assert(
        fs.existsSync(path.join(WATCH_DIR, 'Installers', 'app-installer.dmg')),
        'file not at WATCH_DIR/Installers/',
      );
    });

    await test('design doc filename routes to Design Docs/', async () => {
      const fp = dropFile('Design_doc_auth.md');
      const a = await waitForActivity(fp);
      assert(a.category === 'Design Docs', `expected Design Docs, got ${a.category}`);
    });

    await test('SLO review routes to Performance/ (not Meetings)', async () => {
      const fp = dropFile('SLO_review_billing.md');
      const a = await waitForActivity(fp);
      assert(
        a.category === 'Performance',
        `expected Performance, got ${a.category} — general-office's "review" keyword is winning`,
      );
    });

    await test('oncall handoff routes to Operations/', async () => {
      const fp = dropFile('Oncall_handoff_2025.md');
      const a = await waitForActivity(fp);
      assert(a.category === 'Operations', `expected Operations, got ${a.category}`);
    });

    await test('README routes to Documentation/', async () => {
      const fp = dropFile('README_api_gateway.md');
      const a = await waitForActivity(fp);
      assert(a.category === 'Documentation', `expected Documentation, got ${a.category}`);
    });

    await test('tech debt routes to Tech Debt/', async () => {
      const fp = dropFile('Tech_debt_inventory.md');
      const a = await waitForActivity(fp);
      assert(a.category === 'Tech Debt', `expected Tech Debt, got ${a.category}`);
    });

    await test('threat model routes to Design Docs/', async () => {
      const fp = dropFile('Threat_model_payments.md');
      const a = await waitForActivity(fp);
      assert(a.category === 'Design Docs', `expected Design Docs, got ${a.category}`);
    });

    await teardown();

    // ── Course detection ──────────────────────────────────────────
    console.log('\nCourse detection:');
    await setup(makeConfig());

    await test('course code in content routes to course folder', async () => {
      const fp = dropFile('homework.txt', 'Solutions to CS 3100 Algorithms problem set 5.');
      const a = await waitForActivity(fp);
      assert(a.category === 'CS 3100', `expected CS 3100, got ${a.category}`);
    });

    await teardown();

    // ── Custom rules ──────────────────────────────────────────────
    console.log('\nCustom rules:');
    await setup(
      makeConfig({
        custom_rules: [{ pattern: '^Project-(\\w+)_', destination: 'Projects/$1' }],
      }),
    );

    await test('user regex with capture group routes to substituted folder', async () => {
      const fp = dropFile('Project-Atlas_design.md');
      const a = await waitForActivity(fp);
      assert(a.category === 'Projects/Atlas', `expected Projects/Atlas, got ${a.category}`);
    });

    await teardown();

    // ── Quarantine ────────────────────────────────────────────────
    console.log('\nQuarantine:');
    await setup(makeConfig({ personas: [] }));

    await test('unmatched file with no categories quarantines', async () => {
      const fp = dropFile('mysterious_file.xyz');
      const a = await waitForActivity(fp);
      assert(a.type === 'quarantine', `expected quarantine, got ${a.type}`);
      assert(
        fs.existsSync(path.join(UNCAT_DIR, 'mysterious_file.xyz')),
        'file not at WATCH_DIR/Uncategorized/',
      );
    });

    await teardown();

    // ── Race protection ───────────────────────────────────────────
    console.log('\nRace protection:');
    await setup(makeConfig());

    await test('file deleted before debounce fires emits no error', async () => {
      const fp = dropFile('transient.dmg');
      // Beat the awaitWriteFinish + debounce window.
      await sleep(50);
      fs.unlinkSync(fp);
      await sleep(STABILITY_PLUS_DEBOUNCE_MS + 500);
      const errored = activities.find((a) => a.srcPath === fp && a.type === 'error');
      assert(!errored, 'should not emit error for vanished file');
    });

    await teardown();

    // ── Depth-0 watching ──────────────────────────────────────────
    console.log('\nDepth-0 watching:');
    await setup(makeConfig());

    await test('files in nested folders are not picked up', async () => {
      const sub = path.join(WATCH_DIR, 'subdir');
      fs.mkdirSync(sub, { recursive: true });
      const nested = path.join(sub, 'nested.dmg');
      fs.writeFileSync(nested, 'fake');
      await sleep(STABILITY_PLUS_DEBOUNCE_MS + 500);
      const evt = activities.find((a) => a.srcPath === nested);
      assert(!evt, 'depth:0 watcher should ignore files at depth 1');
    });

    await teardown();

    // ── Uncategorized rescan ──────────────────────────────────────
    console.log('\nUncategorized rescan:');
    await setup(makeConfig());

    await test('rescan moves stuck file out of Uncategorized after a sibling organize', async () => {
      // Pre-populate Uncategorized/ with a file the persona pack will match.
      // The watcher won't see this directly (depth:0 + uncat exclusion),
      // so it stays put until the rescan walks the folder.
      fs.mkdirSync(UNCAT_DIR, { recursive: true });
      const stuck = path.join(UNCAT_DIR, 'ADR_database_choice.md');
      fs.writeFileSync(stuck, 'fake');

      // A live drop triggers organize, which schedules the 1.5s rescan.
      const trigger = dropFile('Performance_report_auth.md');
      await waitForActivity(trigger);

      // Wait through the rescan debounce + processing.
      await sleep(3_500);

      assert(!fs.existsSync(stuck), 'stuck file should have moved out of Uncategorized');
      assert(
        fs.existsSync(path.join(WATCH_DIR, 'Design Docs', 'ADR_database_choice.md')),
        'stuck file should be in Design Docs/',
      );
    });

    await teardown();

    // ── Filename heuristic fallback ───────────────────────────────
    console.log('\nFilename heuristic:');
    await setup(makeConfig({ personas: [] }));

    await test('Resume_*.pdf routes via filename heuristic when personas disabled', async () => {
      const fp = dropFile('Ganesh_Resume_2025.pdf');
      const a = await waitForActivity(fp);
      assert(a.category === 'Personal', `expected Personal, got ${a.category}`);
    });

    await teardown();
  } finally {
    restoreConfig();
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
  }

  const total = passed + failed;
  console.log(`\n${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in test harness:', err);
  restoreConfig();
  process.exit(1);
});

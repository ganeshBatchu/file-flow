import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { loadConfig, resolveConfigPaths, saveConfig, ensureConfigDir } from '../config/index.js';
import { extractContent } from '../extractor/index.js';
import { tokenize } from '../classifier/tokenizer.js';
import { buildCorpusTFIDF } from '../classifier/tfidf.js';
import { findBestCategory } from '../classifier/confidence.js';
import { moveFile, organizeFiles } from '../organizer/mover.js';
import { buildPreviewPlan } from '../safety/dryrun.js';
import { loadHashCache, saveHashCache } from '../organizer/dedup.js';
import { loadJournal } from '../safety/journal.js';
import { listQuarantined } from '../safety/quarantine.js';
import { undoLast, undoById } from '../organizer/undo.js';
import { CategoryManager } from '../classifier/categories.js';
import { FileFlowDaemon } from '../daemon/index.js';
import chokidar from 'chokidar';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3333;

ensureConfigDir();
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Serve built GUI in production
const guiDist = path.join(__dirname, '../../gui/dist');
if (fs.existsSync(guiDist)) {
  app.use(express.static(guiDist));
}

// Broadcast to all WS clients
function broadcast(data: object) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ── Config ──────────────────────────────────────────────────
app.get('/api/config', async (_req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  res.json(config);
});

app.put('/api/config', async (req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  const updated = { ...config, ...req.body };
  await saveConfig(updated);
  res.json({ ok: true });
});

// ── Files ────────────────────────────────────────────────────
app.get('/api/files', async (req, res) => {
  const dir = req.query.dir as string;
  if (!dir) return res.status(400).json({ error: 'dir required' });
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => ({
      name: e.name,
      path: path.join(dir, e.name),
      isDir: e.isDirectory(),
      size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0,
      mtime: e.isFile() ? fs.statSync(path.join(dir, e.name)).mtimeMs : 0,
    }));
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/mkdir', async (req, res) => {
  const { dir } = req.body as { dir: string };
  try {
    fs.mkdirSync(dir, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/move', async (req, res) => {
  const { src, destDir } = req.body as { src: string; destDir: string };
  const config = resolveConfigPaths(await loadConfig());
  const cache = loadHashCache(config.duplicates.hash_cache_path);
  try {
    const result = await moveFile(src, destDir, config, cache);
    saveHashCache(config.duplicates.hash_cache_path, cache);
    broadcast({ type: 'file-moved', from: src, to: result.to });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Classify ─────────────────────────────────────────────────
app.post('/api/classify', async (req, res) => {
  const { filePath } = req.body as { filePath: string };
  const config = resolveConfigPaths(await loadConfig());
  try {
    const extracted = await extractContent(filePath, config.max_file_size_mb);
    const tokens = tokenize(extracted.text);
    if (tokens.length === 0) return res.json({ category: null, score: 0 });
    const { vectors } = buildCorpusTFIDF([tokens]);
    const vector = vectors[0];
    const match = findBestCategory(vector, config.categories);
    res.json(match ?? { category: null, score: 0 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Organize (dry-run + execute) ─────────────────────────────
app.post('/api/organize/preview', async (req, res) => {
  const { dir } = req.body as { dir: string };
  const config = resolveConfigPaths(await loadConfig());
  const cache = loadHashCache(config.duplicates.hash_cache_path);
  try {
    const plan = await buildPreviewPlan(dir, config, cache);
    // Normalize to a simpler shape for the GUI
    const normalized = {
      moves: plan.moves.map(m => ({
        srcPath: m.srcPath,
        destDir: m.destDir,
        category: m.category,
        confidence: m.confidence,
      })),
      quarantine: plan.quarantined.map(q => q.srcPath),
      duplicates: plan.duplicates.map(d => ({ src: d.duplicate, existing: d.original })),
      errors: plan.errors.map(e => ({ path: e.path, reason: e.error })),
    };
    res.json(normalized);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/organize/execute', async (req, res) => {
  const { moves } = req.body as { moves: { srcPath: string; destDir: string; category: string; confidence: number }[] };
  const config = resolveConfigPaths(await loadConfig());
  const cache = loadHashCache(config.duplicates.hash_cache_path);
  try {
    const result = await organizeFiles(moves, config, cache);
    saveHashCache(config.duplicates.hash_cache_path, cache);
    result.moved.forEach(m => broadcast({ type: 'file-moved', from: m.from, to: m.to }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Categories ───────────────────────────────────────────────
app.get('/api/categories', async (_req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  res.json(config.categories);
});

app.post('/api/categories/scan', async (req, res) => {
  const { dir, k } = req.body as { dir: string; k?: number };
  const config = resolveConfigPaths(await loadConfig());
  const files = fs.readdirSync(dir).map(f => ({ path: path.join(dir, f) }))
    .filter(f => fs.statSync(f.path).isFile());
  const mgr = new CategoryManager(config);
  const suggestions = await mgr.suggestCategories(files, k ?? 5);
  res.json(suggestions);
});

app.post('/api/categories/save', async (req, res) => {
  const { name, keywords, centroid } = req.body as { name: string; keywords: string[]; centroid: number[] };
  const config = resolveConfigPaths(await loadConfig());
  const mgr = new CategoryManager(config);
  await mgr.saveCategoryToConfig(name, keywords, centroid);
  res.json({ ok: true });
});

app.delete('/api/categories/:name', async (req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  const mgr = new CategoryManager(config);
  await mgr.removeCategory(req.params.name);
  res.json({ ok: true });
});

// ── Quarantine ───────────────────────────────────────────────
app.get('/api/quarantine', async (req, res) => {
  const dir = req.query.dir as string;
  const config = resolveConfigPaths(await loadConfig());
  const files = listQuarantined(dir, config);
  res.json(files.map(f => f.path));
});

// ── History & Undo ───────────────────────────────────────────
app.get('/api/history', async (_req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  res.json(loadJournal(config.journal_path).slice(-100).reverse());
});

app.post('/api/undo', async (req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  const { id } = req.body as { id?: string };
  try {
    const result = id
      ? await undoById(id, config.journal_path)
      : await undoLast(config.journal_path);
    if (!result) return res.json({ reversed: [], errors: ['Nothing to undo'] });
    res.json({
      reversed: result.reversed,
      errors: result.errors.map(e => e.error),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Directory watch for live file list updates ───────────────
const dirWatchers = new Map<string, chokidar.FSWatcher>();

app.post('/api/watch-dir', (req, res) => {
  const { dir } = req.body as { dir: string };
  if (dirWatchers.has(dir)) return res.json({ ok: true });
  const w = chokidar.watch(dir, { depth: 0, ignoreInitial: true });
  w.on('all', (event, filePath) => {
    broadcast({ type: 'dir-changed', event, path: filePath, dir });
  });
  dirWatchers.set(dir, w);
  res.json({ ok: true });
});

// ── Daemon ───────────────────────────────────────────────────
let daemon: FileFlowDaemon | null = null;

app.get('/api/daemon/status', async (_req, res) => {
  const config = resolveConfigPaths(await loadConfig());
  res.json({ running: daemon?.isRunning ?? false, watchedPaths: config.watch_directories });
});

app.post('/api/daemon/start', async (_req, res) => {
  if (daemon?.isRunning) return res.json({ ok: true });
  const config = resolveConfigPaths(await loadConfig());
  daemon = new FileFlowDaemon(config);
  daemon.onActivity((evt) => {
    broadcast({
      type: 'daemon-event',
      eventType: evt.type,
      path: evt.srcPath,
      category: evt.category,
      confidence: evt.confidence,
      destination: evt.destPath,
      error: evt.message,
    });
  });
  daemon.start();
  res.json({ ok: true });
});

app.post('/api/daemon/stop', (_req, res) => {
  daemon?.stop();
  daemon = null;
  res.json({ ok: true });
});

// Fallback: serve index.html for SPA routes
app.get('*', (_req, res) => {
  const indexPath = path.join(guiDist, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('GUI not built. Run: cd gui && npm run build');
});

server.listen(PORT, () => {
  console.log(`FileFlow server running at http://localhost:${PORT}`);
});

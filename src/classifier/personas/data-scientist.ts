import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Data scientist / ML engineer persona pack.
 *
 * Routing axes:
 *   • Notebooks (.ipynb) → Notebooks/ with leading-numeric ordering preserved
 *   • Datasets (.csv/.parquet/.tsv/.jsonl/.h5/.npy/...) above a size threshold
 *     → Datasets/ (stem-grouped: train/val/test of the same name go together)
 *   • Model checkpoints (model_*.pt, *.safetensors, *.onnx, etc.) → Models/
 *   • Experiment runs (filename has run_<id> / experiment_<id> / wandb-<id>)
 *     → Experiments/<Run>/
 *
 * Datasets are size-gated (default 1 MB) because tiny `.csv` files are often
 * configuration / tabular notes, not real data. We don't extract or
 * tokenize — content classification on a 5 GB Parquet would do nothing
 * useful and costs a lot.
 *
 * Auto-blacklist directories (mlruns/, wandb/, .ipynb_checkpoints/, etc.)
 * are handled in `defaults.ts` exclusions, not here — those are at the
 * scanner layer.
 */

const NOTEBOOK_EXT = '.ipynb';

const DATASET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.csv', '.tsv', '.parquet', '.jsonl', '.h5', '.hdf5',
  '.npy', '.npz', '.feather', '.arrow', '.zarr',
]);

const CHECKPOINT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pt', '.pth', '.safetensors', '.onnx', '.pb', '.h5', '.bin',
  '.ckpt', '.tflite', '.gguf',
]);

const CHECKPOINT_NAME_RE = /\b(model|checkpoint|ckpt|epoch|weights|state[_\-]?dict)\b/i;
const RUN_RE = /\b(run|experiment|wandb|exp)[\s_\-]?([\w\-]{4,})/i;
const NOTEBOOK_ORDER_RE = /^(\d{1,3})[_\-\s]/;

const DATASET_MIN_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Strip a notebook-style numeric prefix to get the canonical stem.
 * "01_eda.ipynb" → "01_eda" — used to group ordered notebooks together.
 */
function stemFor(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

export function classifyDataScientist(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  const ext = path.extname(filename).toLowerCase();
  const stem = stemFor(filename);

  // ── Experiment run prefix ──────────────────────────────────────────────
  // Tested first because run_<id>_metrics.csv would otherwise be classified
  // as a generic dataset; the run grouping is more useful.
  const runMatch = stem.match(RUN_RE);
  if (runMatch) {
    const runId = runMatch[2];
    return {
      pack: 'data-scientist',
      category: `Experiments/${runId}`,
      confidence: 0.85,
    };
  }

  // ── Notebooks ──────────────────────────────────────────────────────────
  if (ext === NOTEBOOK_EXT) {
    // Numeric-prefix notebooks form an ordered series.
    if (NOTEBOOK_ORDER_RE.test(stem)) {
      return {
        pack: 'data-scientist',
        category: 'Notebooks/Ordered',
        confidence: 0.9,
      };
    }
    return {
      pack: 'data-scientist',
      category: 'Notebooks',
      confidence: 0.85,
    };
  }

  // ── Model checkpoints ──────────────────────────────────────────────────
  // Either the extension is checkpoint-y AND a model-family keyword appears
  // in the name, OR the extension is unambiguously checkpoint-only
  // (.safetensors, .gguf — basically never anything else).
  const isCheckpointExt = CHECKPOINT_EXTENSIONS.has(ext);
  const looksLikeCheckpoint =
    isCheckpointExt && (
      ext === '.safetensors' || ext === '.gguf' || ext === '.ckpt' ||
      CHECKPOINT_NAME_RE.test(stem)
    );
  if (looksLikeCheckpoint) {
    return {
      pack: 'data-scientist',
      category: 'Models',
      confidence: 0.9,
    };
  }

  // ── Datasets ───────────────────────────────────────────────────────────
  if (DATASET_EXTENSIONS.has(ext)) {
    // Size gate — small CSVs are usually notes / configs, not real data.
    // Without a known size we assume "probably a real dataset" and route.
    if (input.fileSizeBytes !== undefined && input.fileSizeBytes < DATASET_MIN_BYTES) {
      return null;
    }
    return {
      pack: 'data-scientist',
      category: 'Datasets',
      confidence: 0.8,
    };
  }

  return null;
}

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ExtractedContent } from './index.js';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif', '.webp', '.gif', '.bmp']);
const VISION_TIMEOUT_MS = 12_000;

/** Locate the compiled Swift Vision helper binary. */
function visionHelperPath(): string {
  // electron sets process.resourcesPath in both dev and packaged modes
  if (process.resourcesPath) {
    const p = path.join(process.resourcesPath, 'fileflow-vision-helper');
    if (fs.existsSync(p)) return p;
  }
  // fallback for running outside Electron (tests, CLI)
  const cwd = path.join(process.cwd(), 'resources', 'fileflow-vision-helper');
  if (fs.existsSync(cwd)) return cwd;
  return '';
}

interface VisionResult {
  text: string;
  labels: { label: string; confidence: number }[];
}

/** Run the Vision helper binary and parse its JSON output. */
async function runVision(imagePath: string): Promise<VisionResult | null> {
  const bin = visionHelperPath();
  if (!bin) return null;

  try {
    const { stdout } = await execFileAsync(bin, [imagePath], {
      timeout: VISION_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout.trim()) as VisionResult;
    return parsed;
  } catch {
    return null;
  }
}

export async function extractMetadata(filePath: string): Promise<ExtractedContent> {
  const baseName = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath).toLowerCase();

  // Split filename into meaningful tokens
  const filenameTokens = baseName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .join(' ');

  let statInfo: Record<string, unknown> = {};
  try {
    const stat = fs.statSync(filePath);
    statInfo = { size: stat.size, mtime: stat.mtime.toISOString() };
  } catch {}

  // ── Apple Vision (macOS only, images only) ───────────────────
  if (IMAGE_EXTS.has(ext)) {
    const vision = await runVision(filePath);

    if (vision) {
      // Label tokens: "food prepared" "outdoor" etc. — appended as TF-IDF signal
      const labelTokens = vision.labels
        .map((l) => l.label)
        .join(' ');

      // OCR text takes priority; labels fill in when there's no readable text
      const visionText = [vision.text, labelTokens].filter(Boolean).join(' ');

      // Combine: filename tokens + vision output
      const combined = [filenameTokens, visionText].filter(Boolean).join(' ');

      return {
        text: combined,
        metadata: {
          filename: path.basename(filePath),
          extension: ext,
          ...statInfo,
          vision: {
            ocr: vision.text,
            labels: vision.labels,
          },
        },
      };
    }
  }

  // ── Fallback: EXIF strings (non-macOS or vision failed) ──────
  let exifData: Record<string, unknown> = {};
  if (IMAGE_EXTS.has(ext)) {
    try {
      const exifr = await import('exifr');
      const exif = await exifr.default.parse(filePath);
      if (exif && typeof exif === 'object') exifData = exif as Record<string, unknown>;
    } catch {}
  }

  const exifStrings: string[] = [];
  for (const [key, val] of Object.entries(exifData)) {
    if (typeof val === 'string' && val.length > 0 && val.length < 200) {
      exifStrings.push(`${key} ${val}`);
    }
  }

  const text = [filenameTokens, ...exifStrings].filter(Boolean).join(' ');

  return {
    text,
    metadata: {
      filename: path.basename(filePath),
      extension: ext,
      ...statInfo,
      exif: exifData,
    },
  };
}

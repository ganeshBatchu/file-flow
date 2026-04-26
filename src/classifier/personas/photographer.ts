import fs from 'fs';
import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Photographer persona pack.
 *
 * Photo files don't yield meaningful tokens to TF-IDF — the only useful
 * organising signal is the capture timestamp from EXIF. We bucket by
 * year-month (`Photos/2024-03`) which is the most common photographer
 * convention and balances folder count with browseability.
 *
 * Failure modes & fallbacks:
 *   • EXIF read fails (corrupt file, no metadata) → fall back to filesystem
 *     mtime. This is less accurate (transferring files often clobbers
 *     mtime) but better than dropping the file into Uncategorized.
 *   • RAW + JPEG sibling pairing is handled at the move layer rather than
 *     classification — both files independently route to the same
 *     year-month bucket via their EXIF, which already keeps them together.
 *
 * EXIF parsing is async — we lazy-import `exifr` so the persona can be
 * loaded even on systems that haven't installed it. The dynamic import
 * caches across calls.
 */

const RASTER_IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tiff', '.tif', '.webp',
  '.bmp', '.gif',
]);

const RAW_IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2',
  '.pef', '.srw', '.x3f', '.iiq', '.3fr', '.kdc',
]);

function isImage(ext: string): boolean {
  return RASTER_IMAGE_EXTS.has(ext) || RAW_IMAGE_EXTS.has(ext);
}

interface ExifrModule {
  parse: (input: string, opts: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
}
let exifrPromise: Promise<ExifrModule | null> | null = null;
function loadExifr(): Promise<ExifrModule | null> {
  if (!exifrPromise) {
    exifrPromise = import('exifr')
      .then((mod): ExifrModule => (mod as { default?: ExifrModule }).default ?? (mod as unknown as ExifrModule))
      .catch(() => null);
  }
  return exifrPromise;
}

/**
 * Format a Date as `YYYY-MM`. Used as the folder bucket.
 */
function yearMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function getCaptureDate(filePath: string): Promise<Date | null> {
  // 1. EXIF DateTimeOriginal (preferred — survives copy/transfer)
  try {
    const exifr = await loadExifr();
    if (exifr) {
      const tags = await exifr.parse(filePath, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
      });
      const candidate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.ModifyDate;
      if (candidate instanceof Date && !isNaN(candidate.getTime())) {
        return candidate;
      }
    }
  } catch {
    // Fall through to mtime
  }

  // 2. Filesystem mtime (less reliable — gets clobbered by transfers, but
  //    better than nothing)
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime;
  } catch {
    return null;
  }
}

export async function classifyPhotographer(
  input: PersonaInput,
): Promise<PersonaMatch | null> {
  const ext = path.extname(input.filePath).toLowerCase();
  if (!isImage(ext)) return null;

  const date = await getCaptureDate(input.filePath);
  if (!date) {
    // Image with no readable date — group as undated rather than letting
    // it fall through to TF-IDF (which can't classify image content).
    return {
      pack: 'photographer',
      category: 'Photos/Undated',
      confidence: 0.7,
    };
  }

  const subBucket = RAW_IMAGE_EXTS.has(ext) ? 'RAW/' : '';
  return {
    pack: 'photographer',
    category: `Photos/${subBucket}${yearMonth(date)}`,
    confidence: 0.9,
  };
}

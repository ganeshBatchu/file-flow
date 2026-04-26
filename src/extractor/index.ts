import fs from 'fs';
import path from 'path';
import { supportsPlaintext, extractPlaintext } from './plaintext.js';
import { supportsDocument, extractDocument } from './document.js';
import { supportsCode, extractCode } from './code.js';
import { extractMetadata } from './metadata.js';

export interface ExtractedContent {
  text: string;
  metadata: Record<string, unknown>;
}

const EXTRACT_TIMEOUT_MS = 5000;

/**
 * Extract text content from a file based on its extension.
 * Falls back to filename tokens on any error.
 */
export async function extractContent(
  filePath: string,
  maxFileSizeMb: number = 50,
): Promise<ExtractedContent> {
  // Check file size
  try {
    const stat = fs.statSync(filePath);
    const sizeMb = stat.size / (1024 * 1024);
    if (sizeMb > maxFileSizeMb) {
      return fallback(filePath, `File too large: ${sizeMb.toFixed(1)}MB > ${maxFileSizeMb}MB`);
    }
  } catch (err) {
    return fallback(filePath, `Stat failed: ${(err as Error).message}`);
  }

  const ext = path.extname(filePath).toLowerCase();

  const extractPromise = doExtract(filePath, ext);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Extraction timeout')), EXTRACT_TIMEOUT_MS),
  );

  try {
    return await Promise.race([extractPromise, timeoutPromise]);
  } catch (err) {
    return fallback(filePath, `Extraction error: ${(err as Error).message}`);
  }
}

async function doExtract(filePath: string, ext: string): Promise<ExtractedContent> {
  if (supportsPlaintext(ext)) {
    return extractPlaintext(filePath);
  }
  if (supportsDocument(ext)) {
    return extractDocument(filePath);
  }
  if (supportsCode(ext)) {
    return extractCode(filePath);
  }
  // Fallback to metadata extraction
  return extractMetadata(filePath);
}

function fallback(filePath: string, reason: string): ExtractedContent {
  const baseName = path.basename(filePath, path.extname(filePath));
  const tokens = baseName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]/g, ' ')
    .toLowerCase();

  return {
    text: tokens,
    metadata: {
      fallback: true,
      reason,
      filename: path.basename(filePath),
    },
  };
}

export { supportsPlaintext, supportsDocument, supportsCode };

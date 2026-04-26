import fs from 'fs';
import type { ExtractedContent } from './index.js';

const PLAINTEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.log', '.json', '.yaml', '.yml', '.toml',
]);

export function supportsPlaintext(ext: string): boolean {
  return PLAINTEXT_EXTENSIONS.has(ext.toLowerCase());
}

export async function extractPlaintext(filePath: string): Promise<ExtractedContent> {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Fallback to latin-1
    try {
      const buf = fs.readFileSync(filePath);
      text = buf.toString('latin1');
    } catch (err) {
      throw new Error(`Failed to read file ${filePath}: ${(err as Error).message}`);
    }
  }

  return {
    text,
    metadata: {
      encoding: 'utf-8',
      lines: text.split('\n').length,
    },
  };
}

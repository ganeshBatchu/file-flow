import fs from 'fs';
import path from 'path';
import type { ExtractedContent } from './index.js';

const CODE_EXTENSIONS = new Set([
  '.rs', '.py', '.js', '.ts', '.java', '.cpp', '.c', '.go',
  '.rb', '.php', '.cs', '.swift', '.kt', '.scala', '.r',
]);

export function supportsCode(ext: string): boolean {
  return CODE_EXTENSIONS.has(ext.toLowerCase());
}

export async function extractCode(filePath: string): Promise<ExtractedContent> {
  let source = '';
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read code file ${filePath}: ${(err as Error).message}`);
  }

  const tokens: string[] = [];

  // Extract single-line comments (// and #)
  const singleLineComments = extractSingleLineComments(source);
  tokens.push(...singleLineComments);

  // Extract multi-line comments (/* */ and """ """)
  const multiLineComments = extractMultiLineComments(source);
  tokens.push(...multiLineComments);

  // Extract string literals
  const stringLiterals = extractStringLiterals(source);
  tokens.push(...stringLiterals);

  // Extract identifier tokens
  const identifiers = extractIdentifiers(source);
  tokens.push(...identifiers);

  const text = tokens.join(' ');

  return {
    text,
    metadata: {
      language: path.extname(filePath).toLowerCase().slice(1),
      lines: source.split('\n').length,
    },
  };
}

function extractSingleLineComments(source: string): string[] {
  const results: string[] = [];
  // Match // comments and # comments (not inside strings)
  const lineCommentRegex = /(?:\/\/|#)(.+?)$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineCommentRegex.exec(source)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractMultiLineComments(source: string): string[] {
  const results: string[] = [];

  // C-style /* */ comments
  const cBlockRegex = /\/\*[\s\S]*?\*\//g;
  let match: RegExpExecArray | null;
  while ((match = cBlockRegex.exec(source)) !== null) {
    results.push(match[0].replace(/\/\*|\*\//g, '').trim());
  }

  // Python/triple-quoted """ """ comments
  const tripleDoubleRegex = /"""[\s\S]*?"""/g;
  while ((match = tripleDoubleRegex.exec(source)) !== null) {
    results.push(match[0].replace(/"""/g, '').trim());
  }

  // Python/triple-quoted ''' ''' comments
  const tripleSingleRegex = /'''[\s\S]*?'''/g;
  while ((match = tripleSingleRegex.exec(source)) !== null) {
    results.push(match[0].replace(/'''/g, '').trim());
  }

  return results;
}

function extractStringLiterals(source: string): string[] {
  const results: string[] = [];

  // Double-quoted strings (skip triple-quoted - already handled)
  const doubleQuoteRegex = /"([^"\\]|\\.)*"/g;
  let match: RegExpExecArray | null;
  while ((match = doubleQuoteRegex.exec(source)) !== null) {
    const content = match[0].slice(1, -1).replace(/\\./g, ' ');
    if (content.length > 2 && content.length < 200) {
      results.push(content);
    }
  }

  // Single-quoted strings
  const singleQuoteRegex = /'([^'\\]|\\.)*'/g;
  while ((match = singleQuoteRegex.exec(source)) !== null) {
    const content = match[0].slice(1, -1).replace(/\\./g, ' ');
    if (content.length > 2 && content.length < 200) {
      results.push(content);
    }
  }

  return results;
}

function extractIdentifiers(source: string): string[] {
  const results: string[] = [];

  // Match identifiers
  const identRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
  let match: RegExpExecArray | null;
  while ((match = identRegex.exec(source)) !== null) {
    const ident = match[0];
    // Skip very short or very long identifiers
    if (ident.length < 2 || ident.length > 50) continue;

    // Split camelCase: getUserName -> get, User, Name
    const camelParts = ident.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
    // Split snake_case: get_user_name -> get, user, name
    const allParts = camelParts.flatMap((p) => p.split('_'));

    for (const part of allParts) {
      if (part.length >= 2) {
        results.push(part.toLowerCase());
      }
    }
  }

  return results;
}

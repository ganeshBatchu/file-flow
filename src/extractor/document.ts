import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ExtractedContent } from './index.js';

const execFileAsync = promisify(execFile);
const VISION_TIMEOUT_MS = 30_000; // PDFs can be slow — allow 30s for multi-page

function visionHelperPath(): string {
  if (process.resourcesPath) {
    const p = path.join(process.resourcesPath, 'fileflow-vision-helper');
    if (fs.existsSync(p)) return p;
  }
  const p = path.join(process.cwd(), 'resources', 'fileflow-vision-helper');
  return fs.existsSync(p) ? p : '';
}

async function visionOcrPdf(filePath: string): Promise<string> {
  const bin = visionHelperPath();
  if (!bin) return '';
  try {
    const { stdout } = await execFileAsync(bin, [filePath], { timeout: VISION_TIMEOUT_MS });
    const result = JSON.parse(stdout.trim()) as { text: string };
    return result.text ?? '';
  } catch {
    return '';
  }
}

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx']);

export function supportsDocument(ext: string): boolean {
  return DOCUMENT_EXTENSIONS.has(ext.toLowerCase());
}

export async function extractDocument(filePath: string): Promise<ExtractedContent> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return extractPdf(filePath);
  } else if (ext === '.docx' || ext === '.pptx') {
    return extractOfficeXml(filePath);
  }

  throw new Error(`Unsupported document type: ${ext}`);
}

async function extractPdf(filePath: string): Promise<ExtractedContent> {
  let pdfText = '';
  let pdfMeta: Record<string, unknown> = {};

  // 1. Try pdf-parse for text-layer PDFs (fast, works offline)
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    pdfText = data.text ?? '';
    pdfMeta = { pages: data.numpages, info: data.info };
  } catch {
    // pdf-parse failed — will fall through to Vision
  }

  // 2. If pdf-parse returned thin/no text, run Vision OCR on the rendered pages
  //    Threshold: < 100 meaningful chars suggests an image-based PDF
  const isTextPoor = pdfText.replace(/\s+/g, '').length < 100;
  if (isTextPoor) {
    const visionText = await visionOcrPdf(filePath);
    if (visionText.trim().length > pdfText.trim().length) {
      pdfText = visionText;
      pdfMeta = { ...pdfMeta, extractedBy: 'vision-ocr' };
    }
  }

  if (!pdfText.trim()) {
    throw new Error(`PDF extraction returned no text for ${filePath}`);
  }

  return { text: pdfText, metadata: pdfMeta };
}

async function extractOfficeXml(filePath: string): Promise<ExtractedContent> {
  try {
    const unzipper = await import('unzipper');
    const xml2js = await import('xml2js');

    const textParts: string[] = [];
    const zip = await unzipper.Open.file(filePath);

    for (const entry of zip.files) {
      const name = entry.path;
      // Word: word/document.xml, PowerPoint: ppt/slides/slide*.xml
      if (
        name.endsWith('.xml') &&
        (name.startsWith('word/') || name.startsWith('ppt/slides/') || name.startsWith('xl/'))
      ) {
        try {
          const content = await entry.buffer();
          const xmlStr = content.toString('utf-8');
          const parsed = await xml2js.parseStringPromise(xmlStr, { explicitArray: false });
          const extracted = extractTextFromXmlObject(parsed);
          textParts.push(extracted);
        } catch {
          // Skip malformed XML entries
        }
      }
    }

    return {
      text: textParts.join('\n'),
      metadata: {
        format: path.extname(filePath).toLowerCase().slice(1),
      },
    };
  } catch (err) {
    throw new Error(`Office XML extraction failed for ${filePath}: ${(err as Error).message}`);
  }
}

function extractTextFromXmlObject(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  if (obj === null || obj === undefined) return '';
  if (Array.isArray(obj)) return obj.map(extractTextFromXmlObject).join(' ');
  if (typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>)
      .map(extractTextFromXmlObject)
      .join(' ');
  }
  return String(obj);
}

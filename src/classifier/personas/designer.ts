import path from 'path';
import type { PersonaInput, PersonaMatch } from './index.js';

/**
 * Designer / creative persona pack.
 *
 * Detects:
 *   • Project files (`.psd`, `.ai`, `.sketch`, `.fig`, `.indd`, `.afdesign`,
 *     `.afphoto`, `.xd`, `.aep`, `.prproj`) — high-confidence routing to
 *     Design/Projects with sub-bucketing by app family.
 *   • Brand asset filenames (`brand`, `logo`, `style-guide`, `wordmark`,
 *     `palette`, `swatches`) → Design/Brand Assets.
 *   • Stock asset filenames (`unsplash-*`, `pexels-*`, `iStock-*`,
 *     `shutterstock_*`, `adobestock_*`) → Design/Stock.
 *   • Common image exports paired by stem with a project file — left to
 *     sibling-inference / future cross-file pairing module; not handled
 *     here (per-file classifier scope).
 *
 * Confidence is high (0.85–0.95) — extension match on creative project
 * formats almost never collides with anything else.
 */

interface ProjectExtRule {
  ext: string;
  family: string;
}

const PROJECT_EXTS: ProjectExtRule[] = [
  { ext: '.psd', family: 'Photoshop' },
  { ext: '.ai', family: 'Illustrator' },
  { ext: '.indd', family: 'InDesign' },
  { ext: '.sketch', family: 'Sketch' },
  { ext: '.fig', family: 'Figma' },
  { ext: '.afdesign', family: 'Affinity Designer' },
  { ext: '.afphoto', family: 'Affinity Photo' },
  { ext: '.afpub', family: 'Affinity Publisher' },
  { ext: '.xd', family: 'Adobe XD' },
  { ext: '.aep', family: 'After Effects' },
  { ext: '.prproj', family: 'Premiere Pro' },
  { ext: '.dwg', family: 'CAD' },
  { ext: '.dxf', family: 'CAD' },
  { ext: '.blend', family: 'Blender' },
  { ext: '.c4d', family: 'Cinema 4D' },
];

const BRAND_RE = /\b(brand|logo|style[\s_\-]?guide|brand[\s_\-]?kit|wordmark|mark|palette|swatches|colour[\s_\-]?palette|color[\s_\-]?palette|typography)\b/i;

const STOCK_PREFIXES_RE = /^(unsplash|pexels|istock|shutterstock|adobestock|adobe[\s_\-]?stock|gettyimages|pixabay|freepik)[_\s\-]/i;

function projectFamily(ext: string): string | null {
  for (const rule of PROJECT_EXTS) {
    if (rule.ext === ext) return rule.family;
  }
  return null;
}

export function classifyDesigner(input: PersonaInput): PersonaMatch | null {
  const filename = path.basename(input.filePath);
  const stem = filename.replace(/\.[^.]+$/, '');
  const ext = path.extname(filename).toLowerCase();

  // ── Project file extensions — highest precision ────────────────────────
  const family = projectFamily(ext);
  if (family) {
    return {
      pack: 'designer',
      category: `Design/Projects/${family}`,
      confidence: 0.95,
    };
  }

  // ── Stock library — prefix match on standard provider names ───────────
  if (STOCK_PREFIXES_RE.test(filename)) {
    return {
      pack: 'designer',
      category: 'Design/Stock',
      confidence: 0.95,
    };
  }

  // ── Brand assets — keyword match. Limited to image / vector / doc
  //   extensions to avoid catching e.g. "logo.txt" notes. ────────────────
  if (BRAND_RE.test(stem)) {
    const okExts = new Set([
      '.png', '.jpg', '.jpeg', '.svg', '.pdf', '.eps',
      '.ai', '.psd', '.fig', '.sketch',
    ]);
    if (okExts.has(ext)) {
      return {
        pack: 'designer',
        category: 'Design/Brand Assets',
        confidence: 0.9,
      };
    }
  }

  return null;
}

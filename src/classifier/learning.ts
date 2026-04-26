import { extractContent } from '../extractor/index.js';
import { tokenize } from './tokenizer.js';
import { buildCorpusTFIDF } from './tfidf.js';
import type { FileFlowConfig } from '../config/schema.js';

/**
 * Online category refinement from user corrections.
 *
 * When a user manually moves a file into an existing category (including
 * accepting the "Move anyway" override on a close-match suggestion), we take
 * that as a strong signal: the file *is* this category. Feed its top TF-IDF
 * terms back into the category's keyword list so the next similar file
 * classifies above threshold automatically.
 *
 * Semantics:
 *   • Keyword list is unioned with the new file's top-10 terms, then capped
 *     at 30 entries (oldest dropped). The cap keeps scoring fast and
 *     prevents drift.
 *   • Centroid is regenerated as a simple monotonically-decreasing weight
 *     vector aligned with the keyword list (first keyword weighted highest).
 *     This matches how `suggestCategories` produces initial centroids.
 */

/**
 * Categories that classify by rule, not by keywords. Don't try to "learn" new
 * keywords into these — a CS 3100 folder is matched by the course regex, and
 * Personal / Build Logs are matched by filename patterns. Polluting their
 * keyword lists with document terms would only confuse TF-IDF matching
 * downstream.
 */
const COURSE_NAME_RE = /^[A-Z]{2,6} \d{3,4}[A-Z]{0,2}$/;
const RULE_BASED_CATEGORIES = new Set(['Personal', 'Build Logs']);

export function isRuleBasedCategory(name: string): boolean {
  return COURSE_NAME_RE.test(name) || RULE_BASED_CATEGORIES.has(name);
}

const TOP_TERMS_PER_CORRECTION = 10;
const MAX_KEYWORDS_PER_CATEGORY = 30;

/**
 * Mutates `config.categories[categoryName]` in place with refined keywords +
 * centroid. Returns true if the config was updated (caller should persist
 * afterward), false if there was nothing to learn (rule-based category,
 * unknown category, no extractable text, etc.).
 *
 * Throws on extraction / tokenization errors — callers should catch and
 * treat as non-fatal (the move itself already succeeded).
 */
export async function learnFromCorrection(
  filePath: string,
  categoryName: string,
  config: FileFlowConfig,
): Promise<boolean> {
  if (isRuleBasedCategory(categoryName)) return false;
  const cat = config.categories[categoryName];
  if (!cat) return false;

  const extracted = await extractContent(filePath, config.max_file_size_mb);
  const tokens = tokenize(extracted.text);
  if (tokens.length === 0) return false;

  const { vectors } = buildCorpusTFIDF([tokens]);
  const vec = vectors[0];
  if (vec.size === 0) return false;

  const topTerms = [...vec.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TERMS_PER_CORRECTION)
    .map(([term]) => term);

  // Union existing keywords with new top terms. We append new-to-this-file
  // terms at the end so the LRU-style cap drops the *oldest* keywords first
  // — recent user corrections outweigh stale initial clustering.
  const seen = new Set(cat.keywords);
  const merged = [...cat.keywords];
  for (const term of topTerms) {
    if (!seen.has(term)) {
      merged.push(term);
      seen.add(term);
    }
  }
  if (merged.length === cat.keywords.length) return false; // no new terms

  const finalKeywords = merged.slice(-MAX_KEYWORDS_PER_CATEGORY);
  const finalCentroid = finalKeywords.map((_, i) => Math.max(0.1, 1.0 - i * 0.03));

  config.categories[categoryName] = {
    keywords: finalKeywords,
    centroid: finalCentroid,
  };
  return true;
}

// Comprehensive English stopwords list (100+ words)
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 's', 't', 'just', 'don', 'about', 'above', 'after', 'again',
  'against', 'ain', 'also', 'am', 'aren', 'as', 'because', 'before',
  'below', 'between', 'couldn', 'during', 'each', 'further', 'hadn',
  'hasn', 'haven', 'here', 'if', 'into', 'isn', 'itself', 'let',
  'ma', 'mightn', 'mustn', 'needn', 'now', 'o', 'off', 'once', 'out',
  'over', 'own', 're', 'same', 'shan', 'shouldn', 'through', 'under',
  'until', 'up', 'wasn', 'weren', 'while', 'won', 'wouldn', 'yourself',
  'etc', 'like', 'get', 'got', 'use', 'used', 'using', 'make', 'made',
  'new', 'go', 'come', 'know', 'think', 'see', 'look', 'want', 'give',
  'take', 'find', 'tell', 'ask', 'seem', 'feel', 'try', 'leave', 'call',
  'put', 'keep', 'let', 'begin', 'show', 'hear', 'play', 'run', 'move',
  'live', 'believe', 'hold', 'bring', 'write', 'provide', 'sit', 'stand',
  'lose', 'pay', 'meet', 'set', 'add', 'send', 'expect', 'build', 'stay',
  'fall', 'cut', 'reach', 'kill', 'remain', 'suggest', 'raise', 'pass',
]);

/**
 * Split a camelCase or PascalCase word into its component words.
 */
function splitCamelCase(word: string): string[] {
  return word.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
}

/**
 * Tokenize text into stemmed, filtered tokens.
 */
export function tokenize(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  // Lowercase
  let lower = text.toLowerCase();

  // Strip punctuation except apostrophes, underscores, hyphens used in words
  lower = lower.replace(/[^\w\s'-]/g, ' ');

  // Split on whitespace, underscores, hyphens, slashes, dots
  const rawTokens = lower.split(/[\s_\-\/\.]+/);

  const tokens: string[] = [];
  for (const raw of rawTokens) {
    // Remove leading/trailing apostrophes
    const cleaned = raw.replace(/^'+|'+$/g, '');

    if (cleaned.length < 2) continue;

    // Further split camelCase
    const parts = splitCamelCase(cleaned);
    for (const part of parts) {
      const p = part.trim();
      if (p.length < 2) continue;

      // Remove non-alpha characters for stopword check
      const alphaOnly = p.replace(/[^a-z]/g, '');
      if (alphaOnly.length < 2) continue;
      if (STOPWORDS.has(alphaOnly)) continue;

      // Apply Porter stemmer
      const stemmed = porterStem(alphaOnly);
      if (stemmed.length >= 2) {
        tokens.push(stemmed);
      }
    }
  }

  return tokens;
}

// ============================================================
// Porter Stemmer: Classic 5-step algorithm
// ============================================================

function isConsonant(word: string, i: number): boolean {
  const c = word[i];
  if ('aeiou'.includes(c)) return false;
  if (c === 'y') {
    if (i === 0) return true;
    return !isConsonant(word, i - 1);
  }
  return true;
}

function measure(word: string): number {
  // Count VC sequences (m)
  let n = 0;
  let i = 0;
  const len = word.length;

  // Skip initial consonants
  while (i < len && isConsonant(word, i)) i++;

  while (i < len) {
    // Skip vowels
    while (i < len && !isConsonant(word, i)) i++;
    // Count VC pair
    while (i < len && isConsonant(word, i)) i++;
    n++;
  }
  return n;
}

function containsVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

function endsWithDoubleConsonant(word: string): boolean {
  const len = word.length;
  if (len < 2) return false;
  if (word[len - 1] !== word[len - 2]) return false;
  return isConsonant(word, len - 1);
}

function endsCVC(word: string): boolean {
  const len = word.length;
  if (len < 3) return false;
  const c = word[len - 1];
  if ('wxy'.includes(c)) return false;
  return (
    isConsonant(word, len - 1) &&
    !isConsonant(word, len - 2) &&
    isConsonant(word, len - 3)
  );
}

function replaceSuffix(word: string, suffix: string, replacement: string): string {
  return word.slice(0, word.length - suffix.length) + replacement;
}

function step1a(word: string): string {
  if (word.endsWith('sses')) return replaceSuffix(word, 'sses', 'ss');
  if (word.endsWith('ies')) return replaceSuffix(word, 'ies', 'i');
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return replaceSuffix(word, 's', '');
  return word;
}

function step1b(word: string): string {
  if (word.endsWith('eed')) {
    const stem = replaceSuffix(word, 'eed', '');
    if (measure(stem) > 0) return stem + 'ee';
    return word;
  }

  let flag = false;
  let w = word;

  if (word.endsWith('ed')) {
    const stem = replaceSuffix(word, 'ed', '');
    if (containsVowel(stem)) {
      w = stem;
      flag = true;
    }
  } else if (word.endsWith('ing')) {
    const stem = replaceSuffix(word, 'ing', '');
    if (containsVowel(stem)) {
      w = stem;
      flag = true;
    }
  }

  if (flag) {
    if (w.endsWith('at')) return w + 'e';
    if (w.endsWith('bl')) return w + 'e';
    if (w.endsWith('iz')) return w + 'e';
    if (endsWithDoubleConsonant(w)) {
      const last = w[w.length - 1];
      if (!'lsz'.includes(last)) return w.slice(0, -1);
    }
    if (measure(w) === 1 && endsCVC(w)) return w + 'e';
  }

  return w;
}

function step1c(word: string): string {
  if (word.endsWith('y')) {
    const stem = replaceSuffix(word, 'y', '');
    if (containsVowel(stem)) return stem + 'i';
  }
  return word;
}

const STEP2_MAP: [string, string][] = [
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['izer', 'ize'],
  ['abli', 'able'],
  ['alli', 'al'],
  ['entli', 'ent'],
  ['eli', 'e'],
  ['ousli', 'ous'],
  ['ization', 'ize'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['alism', 'al'],
  ['iveness', 'ive'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
];

function step2(word: string): string {
  for (const [suffix, replacement] of STEP2_MAP) {
    if (word.endsWith(suffix)) {
      const stem = replaceSuffix(word, suffix, '');
      if (measure(stem) > 0) return stem + replacement;
    }
  }
  return word;
}

const STEP3_MAP: [string, string][] = [
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
];

function step3(word: string): string {
  for (const [suffix, replacement] of STEP3_MAP) {
    if (word.endsWith(suffix)) {
      const stem = replaceSuffix(word, suffix, '');
      if (measure(stem) > 0) return stem + replacement;
    }
  }
  return word;
}

const STEP4_SUFFIXES = [
  'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement',
  'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
];

function step4(word: string): string {
  for (const suffix of STEP4_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = replaceSuffix(word, suffix, '');
      if (suffix === 'ion') {
        if (measure(stem) > 1 && (stem.endsWith('s') || stem.endsWith('t'))) {
          return stem;
        }
      } else {
        if (measure(stem) > 1) return stem;
      }
    }
  }
  return word;
}

function step5a(word: string): string {
  if (word.endsWith('e')) {
    const stem = replaceSuffix(word, 'e', '');
    if (measure(stem) > 1) return stem;
    if (measure(stem) === 1 && !endsCVC(stem)) return stem;
  }
  return word;
}

function step5b(word: string): string {
  if (measure(word) > 1 && endsWithDoubleConsonant(word) && word.endsWith('l')) {
    return word.slice(0, -1);
  }
  return word;
}

export function porterStem(word: string): string {
  if (word.length <= 2) return word;

  let w = word.toLowerCase();
  w = step1a(w);
  w = step1b(w);
  w = step1c(w);
  w = step2(w);
  w = step3(w);
  w = step4(w);
  w = step5a(w);
  w = step5b(w);

  return w;
}

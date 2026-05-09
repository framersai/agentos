/**
 * @fileoverview Removes tokens that match a configurable stop word list.
 * @module agentos/nlp/filters/StopWordFilter
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
import { getNaturalModule } from '../naturalInterop';

/** ~120 common English stop words. */
export const ENGLISH_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'get', 'got', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'might', 'more', 'most', 'must', 'my', 'myself', 'no', 'nor',
  'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
  'yourself', 'yourselves',
]);

/**
 * Stop words for code search. These are noise in code but NOT programming keywords.
 * Note: `class`, `function`, `import`, `const`, `let`, `var`, `return`, `this`
 * are deliberately NOT in this list — they're meaningful in code search.
 */
export const CODE_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'out', 'also', 'it', 'its',
]);

/**
 * Extended stop word list from the `natural` NLP library (170 words).
 * Loaded lazily — falls back to ENGLISH_STOP_WORDS if natural is unavailable.
 */
let _naturalStopWords: ReadonlySet<string> | null = null;
export function getNaturalStopWords(): ReadonlySet<string> {
  if (_naturalStopWords) return _naturalStopWords;
  const natural = getNaturalModule();
  if (natural?.stopwords && Array.isArray(natural.stopwords)) {
    _naturalStopWords = new Set(natural.stopwords as string[]);
    return _naturalStopWords;
  }
  _naturalStopWords = ENGLISH_STOP_WORDS;
  return _naturalStopWords;
}

/**
 * Filters tokens whose `.text` appears in the provided stop word set.
 * Case-sensitive — apply after LowercaseNormalizer for case-insensitive filtering.
 */
export class StopWordFilter implements ITextProcessor {
  readonly name = 'StopWordFilter';
  private stopWords: ReadonlySet<string>;

  /**
   * @param stopWords — stop word set to filter against. Defaults to `natural`'s
   * 170-word list when available, falls back to the built-in 120-word ENGLISH_STOP_WORDS.
   */
  constructor(stopWords?: ReadonlySet<string>) {
    this.stopWords = stopWords ?? getNaturalStopWords();
  }

  process(tokens: Token[]): Token[] {
    return tokens.filter(t => !this.stopWords.has(t.text));
  }
}

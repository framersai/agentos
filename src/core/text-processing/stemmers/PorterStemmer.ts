/**
 * @fileoverview Porter stemmer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * @module agentos/core/text-processing/stemmers/PorterStemmer
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
import { getNaturalModule } from '../naturalInterop';

/** Lazy-loaded stem function from the `natural` package. */
let stemFn: ((word: string) => string) | null | undefined;

function loadStemmer(): void {
  if (stemFn !== undefined) return;
  const natural = getNaturalModule();
  const porterStemmer = natural?.PorterStemmer;
  if (porterStemmer && typeof porterStemmer.stem === 'function') {
    stemFn = (word: string) => porterStemmer.stem(word);
    return;
  }
  /* natural not installed — stemmer will be a no-op */
  stemFn = null;
}

/**
 * Porter stemmer — reduces words to their morphological root.
 * `running` → `run`, `foxes` → `fox`, `connected` → `connect`.
 *
 * Uses the `natural` npm package (already in agentos dependencies).
 * Falls back to no-op if `natural` can't be imported.
 *
 * Sets `token.stem` with the stemmed form. Also updates `token.text`
 * so downstream processors work with stemmed tokens.
 */
export class PorterStemmer implements ITextProcessor {
  readonly name = 'PorterStemmer';

  process(tokens: Token[]): Token[] {
    loadStemmer();
    if (!stemFn) return tokens;

    return tokens.map(t => {
      const stemmed = stemFn!(t.text);
      return { ...t, text: stemmed, stem: stemmed };
    });
  }

  /**
   * Optional eager initialization hook for callers that want to load
   * `natural` ahead of the first `process()` call.
   */
  async initialize(): Promise<void> {
    loadStemmer();
  }
}

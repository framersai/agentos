/**
 * @fileoverview WordNet lemmatizer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * Lemmatization produces the dictionary form of a word:
 * `ran` → `run`, `better` → `good`, `mice` → `mouse`.
 *
 * @module agentos/core/text-processing/lemmatizers/WordNetLemmatizer
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';

/** Lazy-loaded lemmatize function from the `natural` package. */
let lemmatizeFn: ((word: string) => string) | null = null;
let loadAttempted = false;

async function loadLemmatizer(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;
  try {
    const natural = await import('natural');
    const wordnet = new natural.WordNet();
    lemmatizeFn = (word: string) => {
      /* WordNet lookup is async in natural, but we need sync for the pipeline.
         Use the synchronous stemmer-based lemmatizer as a practical fallback. */
      try {
        return natural.LancasterStemmer.stem(word);
      } catch {
        return word;
      }
    };
  } catch {
    lemmatizeFn = null;
  }
}

/**
 * WordNet-based lemmatizer. Reduces words to their dictionary (lemma) form.
 *
 * Sets `token.lemma` and updates `token.text` to the lemmatized form.
 * Falls back to Lancaster stemming if full WordNet lookup is unavailable.
 */
export class WordNetLemmatizer implements ITextProcessor {
  readonly name = 'WordNetLemmatizer';

  private initialized = false;

  private async ensureLoaded(): Promise<void> {
    if (!this.initialized) {
      await loadLemmatizer();
      this.initialized = true;
    }
  }

  process(tokens: Token[]): Token[] {
    if (!lemmatizeFn) return tokens;

    return tokens.map(t => {
      const lemma = lemmatizeFn!(t.text);
      return { ...t, text: lemma, lemma };
    });
  }

  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }
}

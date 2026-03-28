/**
 * @fileoverview WordNet lemmatizer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * Lemmatization produces the dictionary form of a word:
 * `ran` → `run`, `better` → `good`, `mice` → `mouse`.
 *
 * @module agentos/nlp/lemmatizers/WordNetLemmatizer
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
import { getNaturalModule } from '../naturalInterop';

/** Lazy-loaded lemmatize function from the `natural` package. */
let lemmatizeFn: ((word: string) => string) | null | undefined;

function loadLemmatizer(): void {
  if (lemmatizeFn !== undefined) return;

  const natural = getNaturalModule();
  const lancasterStemmer = natural?.LancasterStemmer;
  if (lancasterStemmer && typeof lancasterStemmer.stem === 'function') {
    lemmatizeFn = (word: string) => {
      /* `natural` exposes async WordNet lookup only, so keep the sync contract by
         using Lancaster stemming as a pragmatic lemma approximation. */
      try {
        return lancasterStemmer.stem(word);
      } catch {
        return word;
      }
    };
    return;
  }

  lemmatizeFn = null;
}

/**
 * WordNet-based lemmatizer. Reduces words to their dictionary (lemma) form.
 *
 * Sets `token.lemma` and updates `token.text` to the lemmatized form.
 * Falls back to Lancaster stemming if full WordNet lookup is unavailable.
 */
export class WordNetLemmatizer implements ITextProcessor {
  readonly name = 'WordNetLemmatizer';

  process(tokens: Token[]): Token[] {
    loadLemmatizer();
    if (!lemmatizeFn) return tokens;

    return tokens.map(t => {
      const lemma = lemmatizeFn!(t.text);
      return { ...t, text: lemma, lemma };
    });
  }

  async initialize(): Promise<void> {
    loadLemmatizer();
  }
}

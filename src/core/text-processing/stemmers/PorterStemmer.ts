/**
 * @fileoverview Porter stemmer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * @module agentos/core/text-processing/stemmers/PorterStemmer
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';

/** Lazy-loaded stem function from the `natural` package. */
let stemFn: ((word: string) => string) | null = null;
let loadAttempted = false;

async function loadStemmer(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;
  try {
    const natural = await import('natural');
    stemFn = (word: string) => natural.PorterStemmer.stem(word);
  } catch {
    /* natural not installed — stemmer will be a no-op */
    stemFn = null;
  }
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

  private initialized = false;

  private async ensureLoaded(): Promise<void> {
    if (!this.initialized) {
      await loadStemmer();
      this.initialized = true;
    }
  }

  process(tokens: Token[]): Token[] {
    /* Synchronous path if already loaded */
    if (!stemFn) return tokens;

    return tokens.map(t => {
      const stemmed = stemFn!(t.text);
      return { ...t, text: stemmed, stem: stemmed };
    });
  }

  /**
   * Async initialization — call once before first use to load `natural`.
   * The pipeline calls this automatically, but you can call it early
   * to avoid the lazy-load delay on first process() call.
   */
  async initialize(): Promise<void> {
    await this.ensureLoaded();
  }
}

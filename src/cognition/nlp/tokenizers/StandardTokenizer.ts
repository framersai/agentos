/**
 * @fileoverview Unicode-aware word tokenizer.
 * Splits on whitespace, punctuation, and special characters.
 * Produces tokens with position tracking.
 *
 * @module agentos/nlp/tokenizers/StandardTokenizer
 */

import type { Token } from '../types';
import type { ITokenizer } from '../ITextProcessor';

/** Matches word-like sequences: letters, digits, underscores. */
const WORD_REGEX = /[\p{L}\p{N}_]+/gu;

/**
 * Standard tokenizer that splits text on Unicode word boundaries.
 * Handles punctuation, whitespace, hyphens, and special characters.
 * Preserves position offsets for each token.
 */
export class StandardTokenizer implements ITokenizer {
  readonly name = 'StandardTokenizer';

  /** Minimum token length to emit (default 2). */
  private minLength: number;

  constructor(minLength: number = 2) {
    this.minLength = minLength;
  }

  tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let match: RegExpExecArray | null;

    WORD_REGEX.lastIndex = 0;
    while ((match = WORD_REGEX.exec(text)) !== null) {
      const word = match[0];
      if (word.length >= this.minLength) {
        tokens.push({
          text: word,
          original: word,
          position: match.index,
        });
      }
    }

    return tokens;
  }
}

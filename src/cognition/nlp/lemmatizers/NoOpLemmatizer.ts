/**
 * @fileoverview Pass-through lemmatizer that does nothing.
 * @module agentos/nlp/lemmatizers/NoOpLemmatizer
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';

export class NoOpLemmatizer implements ITextProcessor {
  readonly name = 'NoOpLemmatizer';

  process(tokens: Token[]): Token[] {
    return tokens;
  }
}

/**
 * @fileoverview Lowercases all token text. Preserves original.
 * @module agentos/core/text-processing/normalizers/LowercaseNormalizer
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';

export class LowercaseNormalizer implements ITextProcessor {
  readonly name = 'LowercaseNormalizer';

  process(tokens: Token[]): Token[] {
    return tokens.map(t => ({ ...t, text: t.text.toLowerCase() }));
  }
}

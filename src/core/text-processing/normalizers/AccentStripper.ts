/**
 * @fileoverview Strips diacritics/accents from token text.
 * `café` → `cafe`, `naïve` → `naive`.
 *
 * @module agentos/core/text-processing/normalizers/AccentStripper
 */

import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';

/**
 * Removes combining diacritical marks after Unicode NFD decomposition.
 * This makes accent-insensitive search possible.
 */
export class AccentStripper implements ITextProcessor {
  readonly name = 'AccentStripper';

  process(tokens: Token[]): Token[] {
    return tokens.map(t => ({
      ...t,
      text: t.text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    }));
  }
}

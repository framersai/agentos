/**
 * @fileoverview Strips diacritics/accents from token text.
 * `café` → `cafe`, `naïve` → `naive`.
 *
 * @module agentos/nlp/normalizers/AccentStripper
 */
import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
/**
 * Removes combining diacritical marks after Unicode NFD decomposition.
 * This makes accent-insensitive search possible.
 */
export declare class AccentStripper implements ITextProcessor {
    readonly name = "AccentStripper";
    process(tokens: Token[]): Token[];
}
//# sourceMappingURL=AccentStripper.d.ts.map
/**
 * @fileoverview Unicode-aware word tokenizer.
 * Splits on whitespace, punctuation, and special characters.
 * Produces tokens with position tracking.
 *
 * @module agentos/nlp/tokenizers/StandardTokenizer
 */
import type { Token } from '../types';
import type { ITokenizer } from '../ITextProcessor';
/**
 * Standard tokenizer that splits text on Unicode word boundaries.
 * Handles punctuation, whitespace, hyphens, and special characters.
 * Preserves position offsets for each token.
 */
export declare class StandardTokenizer implements ITokenizer {
    readonly name = "StandardTokenizer";
    /** Minimum token length to emit (default 2). */
    private minLength;
    constructor(minLength?: number);
    tokenize(text: string): Token[];
}
//# sourceMappingURL=StandardTokenizer.d.ts.map
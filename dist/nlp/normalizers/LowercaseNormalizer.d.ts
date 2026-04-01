/**
 * @fileoverview Lowercases all token text. Preserves original.
 * @module agentos/nlp/normalizers/LowercaseNormalizer
 */
import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
export declare class LowercaseNormalizer implements ITextProcessor {
    readonly name = "LowercaseNormalizer";
    process(tokens: Token[]): Token[];
}
//# sourceMappingURL=LowercaseNormalizer.d.ts.map
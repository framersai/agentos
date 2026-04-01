/**
 * @fileoverview Pass-through stemmer that does nothing.
 * Use for code identifiers where stemming would be harmful
 * (e.g. `kubernetes` → `kubernet` is wrong).
 *
 * @module agentos/nlp/stemmers/NoOpStemmer
 */
import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
export declare class NoOpStemmer implements ITextProcessor {
    readonly name = "NoOpStemmer";
    process(tokens: Token[]): Token[];
}
//# sourceMappingURL=NoOpStemmer.d.ts.map
/**
 * @fileoverview Porter stemmer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * @module agentos/nlp/stemmers/PorterStemmer
 */
import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
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
export declare class PorterStemmer implements ITextProcessor {
    readonly name = "PorterStemmer";
    process(tokens: Token[]): Token[];
    /**
     * Optional eager initialization hook for callers that want to load
     * `natural` ahead of the first `process()` call.
     */
    initialize(): Promise<void>;
}
//# sourceMappingURL=PorterStemmer.d.ts.map
/**
 * @fileoverview Removes tokens that match a configurable stop word list.
 * @module agentos/nlp/filters/StopWordFilter
 */
import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
/** ~120 common English stop words. */
export declare const ENGLISH_STOP_WORDS: ReadonlySet<string>;
/**
 * Stop words for code search. These are noise in code but NOT programming keywords.
 * Note: `class`, `function`, `import`, `const`, `let`, `var`, `return`, `this`
 * are deliberately NOT in this list — they're meaningful in code search.
 */
export declare const CODE_STOP_WORDS: ReadonlySet<string>;
export declare function getNaturalStopWords(): ReadonlySet<string>;
/**
 * Filters tokens whose `.text` appears in the provided stop word set.
 * Case-sensitive — apply after LowercaseNormalizer for case-insensitive filtering.
 */
export declare class StopWordFilter implements ITextProcessor {
    readonly name = "StopWordFilter";
    private stopWords;
    /**
     * @param stopWords — stop word set to filter against. Defaults to `natural`'s
     * 170-word list when available, falls back to the built-in 120-word ENGLISH_STOP_WORDS.
     */
    constructor(stopWords?: ReadonlySet<string>);
    process(tokens: Token[]): Token[];
}
//# sourceMappingURL=StopWordFilter.d.ts.map
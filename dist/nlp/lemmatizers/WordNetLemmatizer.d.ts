/**
 * @fileoverview WordNet lemmatizer wrapping the `natural` package.
 * Falls back to no-op if `natural` is not installed.
 *
 * Lemmatization produces the dictionary form of a word:
 * `ran` → `run`, `better` → `good`, `mice` → `mouse`.
 *
 * @module agentos/nlp/lemmatizers/WordNetLemmatizer
 */
import type { Token } from '../types';
import type { ITextProcessor } from '../ITextProcessor';
/**
 * WordNet-based lemmatizer. Reduces words to their dictionary (lemma) form.
 *
 * Sets `token.lemma` and updates `token.text` to the lemmatized form.
 * Falls back to Lancaster stemming if full WordNet lookup is unavailable.
 */
export declare class WordNetLemmatizer implements ITextProcessor {
    readonly name = "WordNetLemmatizer";
    process(tokens: Token[]): Token[];
    initialize(): Promise<void>;
}
//# sourceMappingURL=WordNetLemmatizer.d.ts.map
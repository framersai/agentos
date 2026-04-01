/**
 * @fileoverview Configurable text processing pipeline.
 * Chains a tokenizer + N processors to produce processed tokens from raw text.
 *
 * @module agentos/nlp/TextProcessingPipeline
 */
import type { Token } from './types';
import type { ITextProcessor, ITokenizer } from './ITextProcessor';
/**
 * Orchestrates a chain of text processors: tokenizer → processors → output.
 *
 * @example
 * const pipeline = new TextProcessingPipeline(new StandardTokenizer())
 *   .add(new LowercaseNormalizer())
 *   .add(new StopWordFilter(ENGLISH_STOP_WORDS))
 *   .add(new PorterStemmer());
 *
 * const tokens = pipeline.process('The quick brown foxes are running');
 * // tokens[0].text === 'quick', tokens[0].stem === 'quick'
 * // tokens[1].text === 'brown', ...
 */
export declare class TextProcessingPipeline {
    private tokenizer;
    private processors;
    /**
     * @param tokenizer — the first stage that splits raw text into tokens
     */
    constructor(tokenizer: ITokenizer);
    /** Add a processing stage to the pipeline. Returns `this` for chaining. */
    add(processor: ITextProcessor): this;
    /**
     * Process raw text through the full pipeline.
     *
     * @param text — raw input text
     * @returns array of processed tokens with position and linguistic annotations
     */
    process(text: string): Token[];
    /**
     * Convenience: process text and return just the token strings.
     * Useful for BM25 indexing and FTS where only the text values are needed.
     *
     * @param text — raw input text
     * @returns array of processed token strings
     */
    processToStrings(text: string): string[];
    /** Get the names of all stages for debugging. */
    getStageNames(): string[];
}
//# sourceMappingURL=TextProcessingPipeline.d.ts.map
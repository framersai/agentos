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
export class TextProcessingPipeline {
  private tokenizer: ITokenizer;
  private processors: ITextProcessor[] = [];

  /**
   * @param tokenizer — the first stage that splits raw text into tokens
   */
  constructor(tokenizer: ITokenizer) {
    this.tokenizer = tokenizer;
  }

  /** Add a processing stage to the pipeline. Returns `this` for chaining. */
  add(processor: ITextProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /**
   * Process raw text through the full pipeline.
   *
   * @param text — raw input text
   * @returns array of processed tokens with position and linguistic annotations
   */
  process(text: string): Token[] {
    let tokens = this.tokenizer.tokenize(text);

    for (const processor of this.processors) {
      tokens = processor.process(tokens);
    }

    return tokens;
  }

  /**
   * Convenience: process text and return just the token strings.
   * Useful for BM25 indexing and FTS where only the text values are needed.
   *
   * @param text — raw input text
   * @returns array of processed token strings
   */
  processToStrings(text: string): string[] {
    return this.process(text).map(t => t.text);
  }

  /** Get the names of all stages for debugging. */
  getStageNames(): string[] {
    return [this.tokenizer.name, ...this.processors.map(p => p.name)];
  }
}

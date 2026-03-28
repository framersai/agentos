/**
 * @fileoverview Interface for a single stage in the text processing pipeline.
 * @module agentos/nlp/ITextProcessor
 */

import type { Token } from './types';

/**
 * A single processing stage in a {@link TextProcessingPipeline}.
 * Each processor receives tokens from the previous stage and returns
 * transformed tokens for the next stage.
 *
 * Tokenizers are also processors — the first stage in the pipeline
 * receives an empty token array and produces the initial tokens from
 * raw text via the pipeline's entry point.
 */
export interface ITextProcessor {
  /** Human-readable name for debugging and logging. */
  readonly name: string;

  /**
   * Process an array of tokens, returning transformed tokens.
   * May filter, modify, split, or annotate tokens.
   *
   * @param tokens — tokens from the previous pipeline stage
   * @returns transformed tokens for the next stage
   */
  process(tokens: Token[]): Token[];
}

/**
 * A tokenizer is the first stage in a pipeline — it converts raw text
 * into an initial array of tokens. Separate interface because it takes
 * a string, not Token[].
 */
export interface ITokenizer {
  /** Human-readable name for debugging and logging. */
  readonly name: string;

  /**
   * Split raw text into tokens with position tracking.
   *
   * @param text — raw input text
   * @returns initial token array
   */
  tokenize(text: string): Token[];
}

/**
 * @fileoverview Pre-built pipeline configurations for common use cases.
 * @module agentos/core/text-processing/presets
 */

import { TextProcessingPipeline } from './TextProcessingPipeline';
import { StandardTokenizer } from './tokenizers/StandardTokenizer';
import { CodeTokenizer } from './tokenizers/CodeTokenizer';
import { LowercaseNormalizer } from './normalizers/LowercaseNormalizer';
import { AccentStripper } from './normalizers/AccentStripper';
import { StopWordFilter, ENGLISH_STOP_WORDS, CODE_STOP_WORDS } from './filters/StopWordFilter';
import { PorterStemmer } from './stemmers/PorterStemmer';
import { NoOpStemmer } from './stemmers/NoOpStemmer';

/**
 * Pipeline for English prose text.
 * Standard tokenizer → lowercase → strip accents → remove stop words → Porter stem.
 */
export function createProsePipeline(): TextProcessingPipeline {
  return new TextProcessingPipeline(new StandardTokenizer())
    .add(new LowercaseNormalizer())
    .add(new AccentStripper())
    .add(new StopWordFilter(ENGLISH_STOP_WORDS))
    .add(new PorterStemmer());
}

/**
 * Pipeline for source code and technical identifiers.
 * Code tokenizer (camelCase/snake_case split) → lowercase → code stop words → no stemming.
 */
export function createCodePipeline(): TextProcessingPipeline {
  return new TextProcessingPipeline(new CodeTokenizer())
    .add(new LowercaseNormalizer())
    .add(new StopWordFilter(CODE_STOP_WORDS))
    .add(new NoOpStemmer());
}

/**
 * Default pipeline for RAG / hybrid search.
 * Standard tokenizer → lowercase → remove stop words → Porter stem.
 * Good balance of recall and precision for mixed-content corpora.
 */
export function createRagPipeline(): TextProcessingPipeline {
  return new TextProcessingPipeline(new StandardTokenizer())
    .add(new LowercaseNormalizer())
    .add(new StopWordFilter(ENGLISH_STOP_WORDS))
    .add(new PorterStemmer());
}

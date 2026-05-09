/**
 * @fileoverview Pluggable text processing pipeline for AgentOS.
 * Feeds into BM25 keyword search, FTS5, and embedding generation.
 *
 * @module agentos/nlp
 */

export { TextProcessingPipeline } from './TextProcessingPipeline';
export type { ITextProcessor, ITokenizer } from './ITextProcessor';
export type { Token } from './types';

// Tokenizers
export { StandardTokenizer } from './tokenizers/StandardTokenizer';
export { CodeTokenizer } from './tokenizers/CodeTokenizer';

// Normalizers
export { LowercaseNormalizer } from './normalizers/LowercaseNormalizer';
export { AccentStripper } from './normalizers/AccentStripper';

// Filters
export { StopWordFilter, ENGLISH_STOP_WORDS, CODE_STOP_WORDS, getNaturalStopWords } from './filters/StopWordFilter';

// Stemmers
export { PorterStemmer } from './stemmers/PorterStemmer';
export { NoOpStemmer } from './stemmers/NoOpStemmer';

// Lemmatizers
export { WordNetLemmatizer } from './lemmatizers/WordNetLemmatizer';
export { NoOpLemmatizer } from './lemmatizers/NoOpLemmatizer';

// Presets
export { createProsePipeline, createCodePipeline, createRagPipeline } from './presets';

// AI Utility services (classification, sentiment, similarity, etc.)
export * from './ai_utilities/index.js';

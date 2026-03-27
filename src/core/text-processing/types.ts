/**
 * @fileoverview Core types for the text processing pipeline.
 * @module agentos/core/text-processing/types
 */

/** A single processed token with position and optional linguistic annotations. */
export interface Token {
  /** The processed token text (after normalization, stemming, etc.). */
  text: string;
  /** The original text before any processing. */
  original: string;
  /** Character offset in the source text. */
  position: number;
  /** Stemmed form (set by stemmer processors). */
  stem?: string;
  /** Lemmatized form (set by lemmatizer processors). */
  lemma?: string;
}

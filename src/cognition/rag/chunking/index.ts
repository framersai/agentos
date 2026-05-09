/**
 * @fileoverview Semantic chunking module for boundary-aware text splitting.
 *
 * Exports:
 * - {@link SemanticChunker} — Splits text on heading/paragraph/sentence boundaries
 *
 * @module agentos/rag/chunking
 */

export {
  SemanticChunker,
  type SemanticChunkerConfig,
  type SemanticChunk,
  type BoundaryType,
} from './SemanticChunker.js';

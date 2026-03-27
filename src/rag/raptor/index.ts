/**
 * @fileoverview RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval)
 * module for hierarchical corpus summarization.
 *
 * Exports:
 * - {@link RaptorTree} — Builds and searches hierarchical summary trees
 *
 * @module agentos/rag/raptor
 */

export {
  RaptorTree,
  type RaptorTreeConfig,
  type RaptorInputChunk,
  type RaptorTreeStats,
  type RaptorResult,
} from './RaptorTree.js';

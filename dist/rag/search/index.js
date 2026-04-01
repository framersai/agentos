/**
 * @fileoverview Hybrid search module combining dense vector search with BM25 sparse retrieval.
 *
 * Exports:
 * - {@link BM25Index} — Sparse keyword index using BM25 ranking
 * - {@link HybridSearcher} — Fuses dense + sparse results via RRF or other strategies
 *
 * @module agentos/rag/search
 */
export { BM25Index } from './BM25Index.js';
export { HybridSearcher } from './HybridSearcher.js';
//# sourceMappingURL=index.js.map
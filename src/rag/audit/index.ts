/**
 * @fileoverview RAG Audit Trail module — types and collector for transparent
 * tracking of RAG operations (vector search, graph search, reranking, embeddings).
 * @module @framers/agentos/rag/audit
 */

export type {
  RAGAuditTrail,
  RAGOperationEntry,
  RAGSourceAttribution,
} from './RAGAuditTypes.js';

export {
  RAGAuditCollector,
  RAGOperationHandle,
  type RAGAuditCollectorOptions,
} from './RAGAuditCollector.js';

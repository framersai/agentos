/**
 * Unified Retrieval Module
 *
 * Single-entry-point retrieval orchestrator that executes a structured
 * {@link RetrievalPlan} across ALL available sources in parallel, merges
 * results via Reciprocal Rank Fusion, reranks, and feeds back into
 * cognitive memory.
 *
 * @module agentos/rag/unified
 *
 * @example
 * ```typescript
 * import { UnifiedRetriever, buildDefaultPlan } from '../../rag/unified/index.js';
 *
 * const retriever = new UnifiedRetriever({ hybridSearcher, memoryManager });
 * const plan = buildDefaultPlan('moderate');
 * const result = await retriever.retrieve('How does auth work?', plan);
 * ```
 */
export { buildDefaultPlan } from './types.js';
// Core
export { UnifiedRetriever } from './UnifiedRetriever.js';
//# sourceMappingURL=index.js.map
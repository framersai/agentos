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
 * import { UnifiedRetriever, buildDefaultPlan } from '@framers/agentos/rag/unified';
 *
 * const retriever = new UnifiedRetriever({ hybridSearcher, memoryManager });
 * const plan = buildDefaultPlan('moderate');
 * const result = await retriever.retrieve('How does auth work?', plan);
 * ```
 */
export type { RetrievalPlan, RetrievalPlanSources, MemoryTypeFilter, ModalityFilter, TemporalConfig, GraphTraversalConfig, UnifiedRetrievalResult, SourceDiagnostics, UnifiedRetrieverEvent, } from './types.js';
export { buildDefaultPlan } from './types.js';
export type { MemoryRetrievalPolicy, MemoryRetrievalProfile, ResolvedMemoryRetrievalPolicy, } from './policy.js';
export { DEFAULT_MEMORY_RETRIEVAL_POLICY, buildRetrievalPlanFromPolicy, getCandidateLimit, resolveMemoryRetrievalPolicy, } from './policy.js';
export type { RetrievalConfidenceInput, RetrievalConfidenceSummary, } from './confidence.js';
export { evaluateRetrievalConfidence } from './confidence.js';
export { UnifiedRetriever } from './UnifiedRetriever.js';
export type { UnifiedRetrieverDeps } from './UnifiedRetriever.js';
//# sourceMappingURL=index.d.ts.map
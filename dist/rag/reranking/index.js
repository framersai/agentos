/**
 * Cross-encoder reranking module for the AgentOS RAG pipeline.
 *
 * This module provides pluggable reranking capabilities using cross-encoder models
 * to improve retrieval relevance. Supports both local models (via transformers.js)
 * and cloud APIs (Cohere).
 *
 * @module @framers/agentos/rag/reranking
 *
 * @example Basic usage with local model
 * ```typescript
 * import { RerankerService, LocalCrossEncoderReranker } from '../../rag/reranking/index.js';
 *
 * const service = new RerankerService({
 *   config: {
 *     providers: [{ providerId: 'local' }],
 *     defaultProviderId: 'local'
 *   }
 * });
 *
 * service.registerProvider(new LocalCrossEncoderReranker({
 *   providerId: 'local',
 *   defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2'
 * }));
 *
 * const reranked = await service.rerankChunks(query, chunks);
 * ```
 *
 * @example Using Cohere API
 * ```typescript
 * import { RerankerService, CohereReranker } from '../../rag/reranking/index.js';
 *
 * const service = new RerankerService({
 *   config: {
 *     providers: [{ providerId: 'cohere', apiKey: process.env.COHERE_API_KEY }],
 *     defaultProviderId: 'cohere'
 *   }
 * });
 *
 * service.registerProvider(new CohereReranker({
 *   providerId: 'cohere',
 *   apiKey: process.env.COHERE_API_KEY!
 * }));
 *
 * const reranked = await service.rerankChunks(query, chunks, {
 *   modelId: 'rerank-v3.5',
 *   topN: 5
 * });
 * ```
 */
// Main service
export { RerankerService } from './RerankerService.js';
// Providers
export { CohereReranker, COHERE_RERANKER_MODELS, } from './providers/CohereReranker.js';
export { LocalCrossEncoderReranker, LOCAL_RERANKER_MODELS, } from './providers/LocalCrossEncoderReranker.js';
export { LlmJudgeReranker, } from './providers/LlmJudgeReranker.js';
//# sourceMappingURL=index.js.map
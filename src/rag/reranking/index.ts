/**
 * @fileoverview Cross-encoder reranking module for AgentOS RAG pipeline.
 *
 * This module provides pluggable reranking capabilities using cross-encoder models
 * to improve retrieval relevance. Supports both local models (via transformers.js)
 * and cloud APIs (Cohere).
 *
 * @module backend/agentos/rag/reranking
 *
 * @example Basic usage with local model
 * ```typescript
 * import { RerankerService, LocalCrossEncoderReranker } from '@framers/agentos/rag/reranking';
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
 * import { RerankerService, CohereReranker } from '@framers/agentos/rag/reranking';
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

// Types and interfaces
export type {
  IRerankerProvider,
  RerankerInput,
  RerankerOutput,
  RerankerDocument,
  RerankedDocument,
  RerankerRequestConfig,
  RerankerProviderConfig,
  RerankerServiceConfig,
  RerankerDiagnostics,
} from './IRerankerService';

// Main service
export { RerankerService, type RerankerServiceOptions } from './RerankerService';

// Providers
export {
  CohereReranker,
  type CohereRerankerConfig,
  COHERE_RERANKER_MODELS,
  type CohereRerankerModel,
} from './providers/CohereReranker';

export {
  LocalCrossEncoderReranker,
  type LocalCrossEncoderConfig,
  LOCAL_RERANKER_MODELS,
  type LocalRerankerModel,
} from './providers/LocalCrossEncoderReranker';

/**
 * @fileoverview Provider-agnostic reranker service that orchestrates cross-encoder
 * reranking operations. Supports multiple backend providers (local models, cloud APIs).
 *
 * @module backend/agentos/rag/reranking/RerankerService
 */
import type { ILogger } from '../../logging/ILogger';
import type { RagRetrievedChunk } from '../IRetrievalAugmentor';
import type { IRerankerProvider, RerankerInput, RerankerOutput, RerankerRequestConfig, RerankerServiceConfig, RerankChainStage, RerankerProviderConfig } from './IRerankerService';
/**
 * Configuration for the RerankerService constructor.
 */
export interface RerankerServiceOptions {
    /** Service configuration */
    config: RerankerServiceConfig;
    /** Optional logger instance */
    logger?: ILogger;
}
/**
 * Provider-agnostic reranker service.
 *
 * Orchestrates cross-encoder reranking across multiple providers (local models,
 * cloud APIs) with a unified interface. Handles provider selection, request
 * routing, and result mapping back to RAG chunk format.
 *
 * @example
 * ```typescript
 * const service = new RerankerService({
 *   config: {
 *     providers: [
 *       { providerId: 'local', defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2' },
 *       { providerId: 'cohere', apiKey: process.env.COHERE_API_KEY }
 *     ],
 *     defaultProviderId: 'local'
 *   }
 * });
 *
 * // Register provider implementations
 * service.registerProvider(new LocalCrossEncoderReranker(...));
 * service.registerProvider(new CohereReranker(...));
 *
 * // Rerank chunks
 * const reranked = await service.rerankChunks(query, chunks, { providerId: 'local' });
 * ```
 */
export declare class RerankerService {
    private readonly providers;
    private readonly providerConfigs;
    private readonly config;
    private readonly logger?;
    constructor(options: RerankerServiceOptions);
    /**
     * Register a reranker provider implementation.
     *
     * @param provider - Provider instance to register
     */
    registerProvider(provider: IRerankerProvider): void;
    /**
     * Get a registered provider by ID.
     *
     * @param providerId - Provider identifier
     * @returns Provider instance or undefined if not found
     */
    getProvider(providerId: string): IRerankerProvider | undefined;
    /**
     * Get configuration for a provider.
     *
     * @param providerId - Provider identifier
     * @returns Provider configuration or undefined if not found
     */
    getProviderConfig(providerId: string): RerankerProviderConfig | undefined;
    /**
     * List all registered provider IDs.
     *
     * @returns Array of provider identifiers
     */
    listProviders(): string[];
    /**
     * Check if a provider is available.
     *
     * @param providerId - Provider identifier
     * @returns True if provider is registered and available
     */
    isProviderAvailable(providerId: string): Promise<boolean>;
    /**
     * Rerank documents using the specified or default provider.
     *
     * @param input - Query and documents to rerank
     * @param config - Request configuration (optional, uses defaults if not provided)
     * @returns Reranked documents with relevance scores
     * @throws Error if provider not found or reranking fails
     */
    rerank(input: RerankerInput, config?: Partial<RerankerRequestConfig>): Promise<RerankerOutput>;
    /**
     * Rerank RAG chunks and return updated chunks with new relevance scores.
     *
     * This is the main method used by RetrievalAugmentor. It accepts RagRetrievedChunk[],
     * performs reranking, and returns the same type with updated scores.
     *
     * @param query - User query
     * @param chunks - Retrieved chunks to rerank
     * @param config - Request configuration
     * @returns Reranked chunks sorted by relevance
     */
    rerankChunks(query: string, chunks: RagRetrievedChunk[], config?: Partial<RerankerRequestConfig>): Promise<RagRetrievedChunk[]>;
    /**
     * Run chunks through a multi-stage reranker pipeline.
     * Each stage's output feeds into the next, narrowing the result set.
     * Unavailable providers are silently skipped.
     *
     * @param query - The search query.
     * @param chunks - Input chunks to rerank.
     * @param chain - Ordered array of reranking stages.
     * @returns Reranked chunks after all stages.
     */
    rerankChain(query: string, chunks: RagRetrievedChunk[], chain: RerankChainStage[]): Promise<RagRetrievedChunk[]>;
}
//# sourceMappingURL=RerankerService.d.ts.map
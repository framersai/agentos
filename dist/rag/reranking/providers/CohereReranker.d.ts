/**
 * @fileoverview Cohere Rerank API provider implementation.
 * Uses Cohere's cloud-based cross-encoder reranking service.
 *
 * @module backend/agentos/rag/reranking/providers/CohereReranker
 * @see https://docs.cohere.com/reference/rerank
 */
import type { IRerankerProvider, RerankerInput, RerankerOutput, RerankerRequestConfig, RerankerProviderConfig } from '../IRerankerService';
/**
 * Cohere-specific provider configuration.
 */
export interface CohereRerankerConfig extends RerankerProviderConfig {
    providerId: 'cohere';
    /** Cohere API key (required) */
    apiKey: string;
    /** Base URL for Cohere API. Default: 'https://api.cohere.ai' */
    baseUrl?: string;
}
/**
 * Available Cohere reranker models.
 */
export declare const COHERE_RERANKER_MODELS: readonly ["rerank-v4.0-pro", "rerank-v4.0-fast", "rerank-v3.5", "rerank-english-v3.0", "rerank-multilingual-v3.0", "rerank-english-v2.0", "rerank-multilingual-v2.0"];
export type CohereRerankerModel = (typeof COHERE_RERANKER_MODELS)[number];
/**
 * Cohere Rerank API provider.
 *
 * Cloud-based cross-encoder reranking using Cohere's Rerank models.
 * Provides high-quality relevance scoring with low latency (~100ms for 50 docs).
 *
 * **Pricing**: ~$0.10 per 1,000 search queries (as of 2024)
 *
 * @example
 * ```typescript
 * const reranker = new CohereReranker({
 *   providerId: 'cohere',
 *   apiKey: process.env.COHERE_API_KEY!,
 *   defaultModelId: 'rerank-v3.5'
 * });
 *
 * const result = await reranker.rerank(
 *   { query: 'machine learning', documents: [...] },
 *   { providerId: 'cohere', modelId: 'rerank-v3.5', topN: 5 }
 * );
 * ```
 */
export declare class CohereReranker implements IRerankerProvider {
    readonly providerId: "cohere";
    private readonly apiKey;
    private readonly baseUrl;
    private readonly defaultModelId;
    private readonly defaultTimeoutMs;
    constructor(config: CohereRerankerConfig);
    /**
     * Check if the Cohere API is accessible.
     */
    isAvailable(): Promise<boolean>;
    /**
     * Get supported Cohere reranker models.
     */
    getSupportedModels(): string[];
    /**
     * Rerank documents using Cohere's Rerank API.
     */
    rerank(input: RerankerInput, config: RerankerRequestConfig): Promise<RerankerOutput>;
}
//# sourceMappingURL=CohereReranker.d.ts.map
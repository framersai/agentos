/**
 * @fileoverview Implements the RetrievalAugmentor, the core orchestrator for the
 * AgentOS Retrieval Augmented Generation (RAG) system. It adheres to the
 * `IRetrievalAugmentor` interface.
 *
 * This class is responsible for:
 * - Ingesting documents: Involves chunking, embedding generation via `IEmbeddingManager`,
 * and storage into vector databases via `IVectorStoreManager`.
 * - Retrieving context: Embeds queries, searches relevant vector stores for similar
 * chunks, optionally re-ranks, and formats the results into a context string suitable
 * for augmenting LLM prompts.
 * - Managing document lifecycle (delete, update).
 * - Providing health checks and graceful shutdown.
 *
 * @module backend/agentos/rag/RetrievalAugmentor
 * @see ./IRetrievalAugmentor.ts for the interface definition.
 * @see ../config/RetrievalAugmentorConfiguration.ts for `RetrievalAugmentorServiceConfig`.
 * @see ./IEmbeddingManager.ts
 * @see ./IVectorStoreManager.ts
 */
import { IRetrievalAugmentor, RagDocumentInput, RagIngestionOptions, RagIngestionResult, RagRetrievalOptions, RagRetrievalResult } from './IRetrievalAugmentor';
import { RetrievalAugmentorServiceConfig } from '../core/config/RetrievalAugmentorConfiguration';
import { IEmbeddingManager } from './IEmbeddingManager';
import { IVectorStoreManager } from './IVectorStoreManager';
import { type HydeLlmCaller } from './HydeRetriever';
/**
 * @class RetrievalAugmentor
 * @implements {IRetrievalAugmentor}
 * Orchestrates the RAG pipeline including ingestion, retrieval, and document management.
 */
export declare class RetrievalAugmentor implements IRetrievalAugmentor {
    readonly augmenterId: string;
    private config;
    private embeddingManager;
    private vectorStoreManager;
    private rerankerService?;
    private isInitialized;
    /**
     * Optional HyDE (Hypothetical Document Embedding) retriever.
     *
     * Created lazily on the first retrieval that enables HyDE, or eagerly when
     * a default LLM caller is supplied via {@link setHydeLlmCaller}.
     *
     * @see HydeRetriever
     */
    private hydeRetriever?;
    /**
     * LLM caller function injected by the consumer for HyDE hypothesis
     * generation. Must be set before HyDE retrieval can be used.
     */
    private hydeLlmCaller?;
    /**
     * Constructs a RetrievalAugmentor instance.
     * It is not operational until `initialize` is successfully called.
     */
    constructor();
    /**
     * @inheritdoc
     */
    initialize(config: RetrievalAugmentorServiceConfig, embeddingManager: IEmbeddingManager, vectorStoreManager: IVectorStoreManager): Promise<void>;
    /**
     * Ensures that the augmenter has been initialized.
     * @private
     * @throws {GMIError} If not initialized.
     */
    private ensureInitialized;
    /**
     * Register a reranker provider with the RerankerService.
     *
     * Call this after initialization to add reranker providers (e.g., CohereReranker,
     * LocalCrossEncoderReranker) that will be available for reranking operations.
     *
     * @param provider - A reranker provider instance implementing IRerankerProvider
     * @throws {GMIError} If RerankerService is not configured
     *
     * @example
     * ```typescript
     * import { CohereReranker, LocalCrossEncoderReranker } from '@framers/agentos/rag/reranking';
     *
     * // After initialization
     * augmentor.registerRerankerProvider(new CohereReranker({
     *   providerId: 'cohere',
     *   apiKey: process.env.COHERE_API_KEY!
     * }));
     *
     * augmentor.registerRerankerProvider(new LocalCrossEncoderReranker({
     *   providerId: 'local',
     *   defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2'
     * }));
     * ```
     */
    registerRerankerProvider(provider: import('./reranking/IRerankerService').IRerankerProvider): void;
    /**
     * Register an LLM caller for HyDE hypothesis generation.
     *
     * HyDE (Hypothetical Document Embedding) improves retrieval quality by
     * generating a hypothetical answer first, then embedding that answer
     * instead of the raw query. The hypothesis is semantically closer to the
     * stored documents, yielding better vector similarity matches.
     *
     * The caller must be set before HyDE-enabled retrieval can be used. Once
     * set, HyDE can be activated per-request via `options.hyde.enabled` on
     * {@link retrieveContext}, or it can be activated globally by passing a
     * default HyDE config.
     *
     * @param llmCaller - An async function that takes `(systemPrompt, userPrompt)`
     *   and returns the LLM completion text. The system prompt contains
     *   instructions for hypothesis generation; the user prompt is the query.
     *
     * @example
     * ```typescript
     * augmentor.setHydeLlmCaller(async (systemPrompt, userPrompt) => {
     *   const response = await openai.chat.completions.create({
     *     model: 'gpt-4o-mini',
     *     messages: [
     *       { role: 'system', content: systemPrompt },
     *       { role: 'user', content: userPrompt },
     *     ],
     *     max_tokens: 200,
     *   });
     *   return response.choices[0].message.content ?? '';
     * });
     * ```
     */
    setHydeLlmCaller(llmCaller: HydeLlmCaller): void;
    /**
     * Lazily create (or re-use) a HydeRetriever configured for this augmentor.
     *
     * @param overrides - Per-request HyDE config overrides from
     *   {@link RagRetrievalOptions.hyde}.
     * @returns A configured HydeRetriever, or `undefined` if no LLM caller
     *   has been registered.
     * @private
     */
    private getOrCreateHydeRetriever;
    /**
     * @inheritdoc
     */
    ingestDocuments(documents: RagDocumentInput | RagDocumentInput[], options?: RagIngestionOptions): Promise<RagIngestionResult>;
    /**
     * Processes a batch of documents for ingestion.
     * @private
     */
    private processDocumentBatch;
    /**
     * Chunks a single document based on the provided or default strategy.
     * @private
     */
    private chunkDocument;
    /**
     * Applies cross-encoder reranking to retrieved chunks.
     *
     * @param queryText - The user query
     * @param chunks - Retrieved chunks to rerank
     * @param rerankerConfig - Reranking configuration from request options
     * @returns Reranked chunks sorted by cross-encoder relevance scores
     * @private
     */
    private _applyReranking;
    private cosineSimilarity;
    private applyMMR;
    /**
     * @inheritdoc
     */
    retrieveContext(queryText: string, options?: RagRetrievalOptions): Promise<RagRetrievalResult>;
    /**
     * @inheritdoc
     */
    deleteDocuments(documentIds: string[], dataSourceId?: string, options?: {
        ignoreNotFound?: boolean;
    }): Promise<{
        successCount: number;
        failureCount: number;
        errors?: Array<{
            documentId: string;
            message: string;
            details?: any;
        }>;
    }>;
    /**
     * @inheritdoc
     */
    updateDocuments(documents: RagDocumentInput | RagDocumentInput[], options?: RagIngestionOptions): Promise<RagIngestionResult>;
    /**
     * @inheritdoc
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: Record<string, unknown>;
    }>;
    /**
     * @inheritdoc
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=RetrievalAugmentor.d.ts.map
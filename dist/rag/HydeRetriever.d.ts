/**
 * @fileoverview HyDE (Hypothetical Document Embedding) retriever.
 *
 * Instead of embedding the raw user query for retrieval, HyDE first generates
 * a hypothetical answer using an LLM, then embeds THAT answer to search the
 * vector store. The hypothesis is semantically closer to stored answers than
 * the raw question, improving retrieval quality.
 *
 * Supports adaptive thresholding: starts at a high similarity threshold and
 * steps down until content is found, ensuring full coverage.
 *
 * Based on: Gao et al. 2023 "Precise Zero-Shot Dense Retrieval without
 * Relevance Labels" and Lei et al. 2025 "Never Come Up Empty: Adaptive HyDE
 * Retrieval for Improving LLM Developer Support".
 *
 * @module agentos/rag/HydeRetriever
 */
import type { IEmbeddingManager } from './IEmbeddingManager.js';
import type { IVectorStore, QueryOptions, QueryResult } from './IVectorStore.js';
export interface HydeConfig {
    /** Enable HyDE retrieval. Default: false. */
    enabled?: boolean;
    /** Initial similarity threshold. Default: 0.7. */
    initialThreshold?: number;
    /** Minimum threshold to step down to. Default: 0.3. */
    minThreshold?: number;
    /** Step size for adaptive thresholding. Default: 0.1. */
    thresholdStep?: number;
    /** Use adaptive thresholding (step down when no results). Default: true. */
    adaptiveThreshold?: boolean;
    /** Max tokens for hypothesis generation. Default: 200. */
    maxHypothesisTokens?: number;
    /** Custom system prompt for hypothesis generation. */
    hypothesisSystemPrompt?: string;
    /** Use full-answer granularity (recommended by research). Default: true. */
    fullAnswerGranularity?: boolean;
    /**
     * Number of diverse hypothetical documents to generate per query.
     *
     * Multi-hypothesis HyDE generates N hypotheses from different perspectives
     * (technical, practical/example, overview) and searches with each embedding.
     * Results are deduplicated by chunk ID, keeping the highest score.
     *
     * Higher values improve recall at the cost of additional LLM calls.
     * - 1: Original single-hypothesis HyDE (fastest)
     * - 3: Recommended default (good diversity/cost tradeoff)
     * - 5: Maximum diversity (highest recall, most expensive)
     *
     * Default: 3.
     */
    hypothesisCount?: number;
}
export declare const DEFAULT_HYDE_CONFIG: Required<HydeConfig>;
/** Merge partial config with defaults. */
export declare function resolveHydeConfig(partial?: Partial<HydeConfig>): Required<HydeConfig>;
/** Minimal interface for the LLM call needed by HyDE. */
export type HydeLlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string>;
export interface HydeRetrievalResult {
    /** The generated hypothesis used for embedding. */
    hypothesis: string;
    /** The embedding of the hypothesis. */
    hypothesisEmbedding: number[];
    /** Vector store query result. */
    queryResult: QueryResult;
    /** Final similarity threshold that produced results. */
    effectiveThreshold: number;
    /** Number of threshold steps taken (0 = first try worked). */
    thresholdSteps: number;
    /** Time taken for hypothesis generation (ms). */
    hypothesisLatencyMs: number;
    /** Time taken for embedding + retrieval (ms). */
    retrievalLatencyMs: number;
}
/**
 * Result from multi-hypothesis HyDE retrieval.
 *
 * Contains all generated hypotheses and the deduplicated, merged result set
 * from searching with each hypothesis embedding.
 *
 * @interface HydeMultiRetrievalResult
 */
export interface HydeMultiRetrievalResult {
    /** All generated hypotheses. */
    hypotheses: string[];
    /** Deduplicated query result (union of all hypothesis searches, highest score per doc). */
    queryResult: QueryResult;
    /** Number of hypotheses generated. */
    hypothesisCount: number;
    /** Total time for all hypothesis generations (ms). */
    hypothesisLatencyMs: number;
    /** Total time for all embedding + retrieval passes (ms). */
    retrievalLatencyMs: number;
}
/**
 * HyDE retriever: generates a hypothetical answer, embeds it, and searches
 * the vector store with adaptive thresholding.
 */
export declare class HydeRetriever {
    private config;
    private llmCaller;
    private embeddingManager;
    constructor(opts: {
        config?: Partial<HydeConfig>;
        llmCaller: HydeLlmCaller;
        embeddingManager: IEmbeddingManager;
    });
    /** Whether HyDE is enabled. */
    get enabled(): boolean;
    private buildHypothesisSystemPrompt;
    /**
     * Generate a hypothetical answer for a query.
     */
    generateHypothesis(query: string): Promise<{
        hypothesis: string;
        latencyMs: number;
    }>;
    /**
     * Generate multiple hypothetical documents from different perspectives.
     *
     * Each hypothesis approaches the query from a different angle, improving
     * recall by covering more of the semantic space. Uses chain-of-thought
     * prompting to ensure diverse, high-quality hypotheses.
     *
     * The system prompt asks the LLM to generate N diverse hypotheses:
     * - Hypothesis 1: Technical/formal perspective
     * - Hypothesis 2: Practical/example perspective
     * - Hypothesis 3: Overview/summary perspective
     * - (Additional hypotheses explore further angles)
     *
     * @param {string} query - The user query to generate hypotheses for.
     * @param {number} [count] - Number of hypotheses to generate. Default: config.hypothesisCount (3).
     * @returns {Promise<{ hypotheses: string[]; latencyMs: number }>} Generated hypotheses and timing.
     * @throws {Error} If the LLM call fails.
     *
     * @example
     * ```typescript
     * const { hypotheses, latencyMs } = await retriever.generateMultipleHypotheses(
     *   'How does BM25 scoring work?',
     *   3,
     * );
     * // hypotheses[0]: Technical explanation with formulas
     * // hypotheses[1]: Practical example with code
     * // hypotheses[2]: High-level conceptual overview
     * ```
     */
    generateMultipleHypotheses(query: string, count?: number): Promise<{
        hypotheses: string[];
        latencyMs: number;
    }>;
    /**
     * Multi-hypothesis retrieval: generates N diverse hypotheses, searches with each,
     * and merges results by deduplication (keeping the highest score per document).
     *
     * This dramatically improves recall compared to single-hypothesis HyDE because
     * one bad hypothesis doesn't ruin everything — other hypotheses can still find
     * relevant documents from different angles.
     *
     * Pipeline:
     * 1. Generate N hypotheses via {@link generateMultipleHypotheses}
     * 2. Embed each hypothesis
     * 3. Search the vector store with each embedding
     * 4. Union all results, deduplicate by document ID, keep highest score
     *
     * @param {object} opts - Retrieval options.
     * @param {string} opts.query - The user query.
     * @param {IVectorStore} opts.vectorStore - Vector store to search.
     * @param {string} opts.collectionName - Collection to search in.
     * @param {Partial<QueryOptions>} [opts.queryOptions] - Additional query options.
     * @param {number} [opts.hypothesisCount] - Override hypothesis count for this call.
     * @returns {Promise<HydeMultiRetrievalResult>} Deduplicated results from all hypotheses.
     *
     * @example
     * ```typescript
     * const result = await retriever.retrieveMulti({
     *   query: 'How does BM25 work?',
     *   vectorStore: myStore,
     *   collectionName: 'knowledge-base',
     *   hypothesisCount: 3,
     * });
     * console.log(`Found ${result.queryResult.documents.length} unique docs from ${result.hypothesisCount} hypotheses`);
     * ```
     */
    retrieveMulti(opts: {
        query: string;
        vectorStore: IVectorStore;
        collectionName: string;
        queryOptions?: Partial<QueryOptions>;
        hypothesisCount?: number;
    }): Promise<HydeMultiRetrievalResult>;
    /**
     * Embed the hypothesis and search the vector store.
     * Uses adaptive thresholding: starts at initialThreshold, steps down
     * until results are found or minThreshold is reached.
     */
    retrieve(opts: {
        query: string;
        vectorStore: IVectorStore;
        collectionName: string;
        queryOptions?: Partial<QueryOptions>;
        /** Pre-generated hypothesis (skip generation if provided). */
        hypothesis?: string;
    }): Promise<HydeRetrievalResult>;
    /**
     * Convenience: retrieve and format as augmented context string.
     */
    retrieveContext(opts: {
        query: string;
        vectorStore: IVectorStore;
        collectionName: string;
        queryOptions?: Partial<QueryOptions>;
        separator?: string;
    }): Promise<{
        context: string;
        hypothesis: string;
        effectiveThreshold: number;
        chunkCount: number;
        latencyMs: number;
    }>;
}
//# sourceMappingURL=HydeRetriever.d.ts.map
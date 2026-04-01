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
export const DEFAULT_HYDE_CONFIG = {
    enabled: false,
    initialThreshold: 0.7,
    minThreshold: 0.3,
    thresholdStep: 0.1,
    adaptiveThreshold: true,
    maxHypothesisTokens: 200,
    hypothesisSystemPrompt: 'You are a knowledgeable assistant. Generate a concise, factual answer to the following question. ' +
        'This answer will be used for semantic search, so be specific and include relevant technical terms.',
    fullAnswerGranularity: true,
    hypothesisCount: 3,
};
function clampUnitInterval(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(1, Math.max(0, value));
}
/** Merge partial config with defaults. */
export function resolveHydeConfig(partial) {
    const merged = { ...DEFAULT_HYDE_CONFIG, ...partial };
    const initialThreshold = clampUnitInterval(merged.initialThreshold, DEFAULT_HYDE_CONFIG.initialThreshold);
    const minThreshold = Math.min(initialThreshold, clampUnitInterval(merged.minThreshold, DEFAULT_HYDE_CONFIG.minThreshold));
    const thresholdStep = typeof merged.thresholdStep === 'number' && Number.isFinite(merged.thresholdStep) && merged.thresholdStep > 0
        ? merged.thresholdStep
        : DEFAULT_HYDE_CONFIG.thresholdStep;
    const maxHypothesisTokens = typeof merged.maxHypothesisTokens === 'number' && Number.isFinite(merged.maxHypothesisTokens) && merged.maxHypothesisTokens > 0
        ? Math.floor(merged.maxHypothesisTokens)
        : DEFAULT_HYDE_CONFIG.maxHypothesisTokens;
    const hypothesisCount = typeof merged.hypothesisCount === 'number' && Number.isFinite(merged.hypothesisCount) && merged.hypothesisCount >= 1
        ? Math.floor(merged.hypothesisCount)
        : DEFAULT_HYDE_CONFIG.hypothesisCount;
    return {
        ...merged,
        initialThreshold,
        minThreshold,
        thresholdStep,
        maxHypothesisTokens,
        hypothesisCount,
    };
}
// ── Core Retriever ─────────────────────────────────────────────────────────
/**
 * HyDE retriever: generates a hypothetical answer, embeds it, and searches
 * the vector store with adaptive thresholding.
 */
export class HydeRetriever {
    constructor(opts) {
        this.config = resolveHydeConfig(opts.config);
        this.llmCaller = opts.llmCaller;
        this.embeddingManager = opts.embeddingManager;
    }
    /** Whether HyDE is enabled. */
    get enabled() {
        return this.config.enabled;
    }
    buildHypothesisSystemPrompt() {
        const instructions = [this.config.hypothesisSystemPrompt];
        if (this.config.fullAnswerGranularity) {
            instructions.push('Return a concise but complete hypothetical answer in natural language prose, not just keywords or bullet fragments.');
        }
        else {
            instructions.push('Return only the shortest hypothetical answer needed for semantic retrieval.');
        }
        instructions.push(`Keep the answer under ${this.config.maxHypothesisTokens} tokens.`);
        return instructions.join(' ');
    }
    /**
     * Generate a hypothetical answer for a query.
     */
    async generateHypothesis(query) {
        const start = Date.now();
        const hypothesis = await this.llmCaller(this.buildHypothesisSystemPrompt(), query);
        return {
            hypothesis: hypothesis.trim(),
            latencyMs: Date.now() - start,
        };
    }
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
    async generateMultipleHypotheses(query, count) {
        const n = count ?? this.config.hypothesisCount;
        // For n=1, fall back to the single-hypothesis path
        if (n <= 1) {
            const result = await this.generateHypothesis(query);
            return { hypotheses: [result.hypothesis], latencyMs: result.latencyMs };
        }
        const start = Date.now();
        const systemPrompt = [
            this.config.hypothesisSystemPrompt,
            this.config.fullAnswerGranularity
                ? 'Write complete hypothetical answers in natural language prose.'
                : 'Write concise hypothetical answers suitable for semantic retrieval.',
            `Keep each answer under ${this.config.maxHypothesisTokens} tokens.`,
        ].join(' ');
        const userPrompt = [
            'Think step by step:',
            '1. What is this question really asking?',
            '2. What kind of document would contain the answer?',
            '3. What vocabulary and terminology would that document use?',
            '4. Write a brief version of that hypothetical document.',
            '',
            `Generate ${n} diverse hypothetical documents that would answer: "${query}"`,
            '',
            'Each hypothesis MUST take a DIFFERENT perspective or focus on a',
            'DIFFERENT aspect of the question. Be diverse in vocabulary and approach.',
            '',
            ...Array.from({ length: n }, (_, i) => {
                const perspectives = [
                    'technical/formal perspective with precise terminology',
                    'practical/example perspective with concrete use cases',
                    'overview/summary perspective with broad context',
                    'troubleshooting/diagnostic perspective',
                    'comparative perspective contrasting with alternatives',
                ];
                const perspectiveLabel = perspectives[i % perspectives.length];
                return `Hypothesis ${i + 1} (${perspectiveLabel}):`;
            }),
        ].join('\n');
        const rawResponse = await this.llmCaller(systemPrompt, userPrompt);
        // Parse the response: split on "Hypothesis N:" markers
        const hypotheses = [];
        const hypothesisRegex = /Hypothesis\s+\d+\s*(?:\([^)]*\))?:\s*/gi;
        const parts = rawResponse.split(hypothesisRegex).filter((p) => p.trim().length > 0);
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.length > 0) {
                hypotheses.push(trimmed);
            }
        }
        // If parsing failed (LLM didn't follow format), treat entire response as one hypothesis
        // and generate remaining hypotheses individually as fallback
        if (hypotheses.length === 0) {
            hypotheses.push(rawResponse.trim());
        }
        // If we got fewer hypotheses than requested, generate remaining individually
        while (hypotheses.length < n) {
            const fallbackResult = await this.generateHypothesis(query);
            hypotheses.push(fallbackResult.hypothesis);
        }
        // Trim to exactly n hypotheses
        return {
            hypotheses: hypotheses.slice(0, n),
            latencyMs: Date.now() - start,
        };
    }
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
    async retrieveMulti(opts) {
        const count = opts.hypothesisCount ?? this.config.hypothesisCount;
        // Step 1: Generate multiple hypotheses
        const { hypotheses, latencyMs: hypothesisLatencyMs } = await this.generateMultipleHypotheses(opts.query, count);
        // Step 2: Embed all hypotheses
        const retrievalStart = Date.now();
        const embeddingResponse = await this.embeddingManager.generateEmbeddings({
            texts: hypotheses,
        });
        if (!embeddingResponse.embeddings || embeddingResponse.embeddings.length === 0) {
            return {
                hypotheses,
                queryResult: { documents: [] },
                hypothesisCount: hypotheses.length,
                hypothesisLatencyMs,
                retrievalLatencyMs: Date.now() - retrievalStart,
            };
        }
        // Step 3: Search with each embedding in parallel
        const { minSimilarityScore: _ignoredMinSimilarityScore, ...extraQueryOptions } = opts.queryOptions ?? {};
        const searchPromises = embeddingResponse.embeddings
            .filter((emb) => emb && emb.length > 0)
            .map((embedding) => opts.vectorStore.query(opts.collectionName, embedding, {
            topK: extraQueryOptions.topK ?? 5,
            includeTextContent: true,
            includeMetadata: true,
            ...extraQueryOptions,
        }));
        const searchResults = await Promise.all(searchPromises);
        // Step 4: Merge and deduplicate — keep highest score per document ID
        const docMap = new Map();
        for (const result of searchResults) {
            for (const doc of result.documents) {
                const existing = docMap.get(doc.id);
                if (!existing || doc.similarityScore > existing.similarityScore) {
                    docMap.set(doc.id, doc);
                }
            }
        }
        // Sort by similarity score descending
        const mergedDocs = Array.from(docMap.values()).sort((a, b) => b.similarityScore - a.similarityScore);
        // Apply topK limit
        const topK = opts.queryOptions?.topK ?? 5;
        return {
            hypotheses,
            queryResult: { documents: mergedDocs.slice(0, topK) },
            hypothesisCount: hypotheses.length,
            hypothesisLatencyMs,
            retrievalLatencyMs: Date.now() - retrievalStart,
        };
    }
    /**
     * Embed the hypothesis and search the vector store.
     * Uses adaptive thresholding: starts at initialThreshold, steps down
     * until results are found or minThreshold is reached.
     */
    async retrieve(opts) {
        // Step 1: Generate hypothesis
        let hypothesis;
        let hypothesisLatencyMs;
        if (opts.hypothesis) {
            hypothesis = opts.hypothesis;
            hypothesisLatencyMs = 0;
        }
        else {
            const result = await this.generateHypothesis(opts.query);
            hypothesis = result.hypothesis;
            hypothesisLatencyMs = result.latencyMs;
        }
        // Step 2: Embed the hypothesis
        const retrievalStart = Date.now();
        const embeddingResponse = await this.embeddingManager.generateEmbeddings({
            texts: [hypothesis],
        });
        if (!embeddingResponse.embeddings?.[0]?.length) {
            // Embedding failed — return empty result
            return {
                hypothesis,
                hypothesisEmbedding: [],
                queryResult: { documents: [] },
                effectiveThreshold: this.config.initialThreshold,
                thresholdSteps: 0,
                hypothesisLatencyMs,
                retrievalLatencyMs: Date.now() - retrievalStart,
            };
        }
        const hypothesisEmbedding = embeddingResponse.embeddings[0];
        // Step 3: Adaptive threshold search
        let threshold = this.config.initialThreshold;
        let steps = 0;
        let queryResult = { documents: [] };
        while (threshold >= this.config.minThreshold) {
            const { minSimilarityScore: _ignoredMinSimilarityScore, ...extraQueryOptions } = opts.queryOptions ?? {};
            const queryOpts = {
                topK: extraQueryOptions.topK ?? 5,
                minSimilarityScore: threshold,
                includeTextContent: true,
                includeMetadata: true,
                ...extraQueryOptions,
            };
            queryResult = await opts.vectorStore.query(opts.collectionName, hypothesisEmbedding, queryOpts);
            if (queryResult.documents.length > 0 || !this.config.adaptiveThreshold) {
                break;
            }
            // Step down threshold
            const nextThreshold = Math.round((threshold - this.config.thresholdStep) * 100) / 100;
            if (nextThreshold < this.config.minThreshold) {
                break;
            }
            threshold = nextThreshold;
            steps++;
        }
        return {
            hypothesis,
            hypothesisEmbedding,
            queryResult,
            effectiveThreshold: Math.max(threshold, this.config.minThreshold),
            thresholdSteps: steps,
            hypothesisLatencyMs,
            retrievalLatencyMs: Date.now() - retrievalStart,
        };
    }
    /**
     * Convenience: retrieve and format as augmented context string.
     */
    async retrieveContext(opts) {
        const result = await this.retrieve(opts);
        const separator = opts.separator ?? '\n\n---\n\n';
        const chunks = result.queryResult.documents
            .map((doc) => doc.textContent || '')
            .filter(Boolean);
        return {
            context: chunks.join(separator),
            hypothesis: result.hypothesis,
            effectiveThreshold: result.effectiveThreshold,
            chunkCount: chunks.length,
            latencyMs: result.hypothesisLatencyMs + result.retrievalLatencyMs,
        };
    }
}
//# sourceMappingURL=HydeRetriever.js.map
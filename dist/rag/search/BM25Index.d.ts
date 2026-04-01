/**
 * @fileoverview BM25 sparse keyword index for hybrid retrieval.
 *
 * Dense embeddings excel at semantic similarity but miss exact keyword matches
 * (e.g., error codes, function names, product IDs). BM25 catches these by
 * scoring documents based on term frequency, inverse document frequency,
 * and document length normalization.
 *
 * Used alongside vector search in a hybrid fusion strategy:
 * - Vector search handles semantic "what does this mean?" queries
 * - BM25 handles lexical "find this exact thing" queries
 * - Reciprocal Rank Fusion (RRF) merges both result sets
 *
 * The BM25 ranking function is:
 * ```
 * score(D, Q) = sum_{t in Q} IDF(t) * (tf(t,D) * (k1 + 1)) / (tf(t,D) + k1 * (1 - b + b * |D| / avgdl))
 * ```
 *
 * Where:
 * - `k1` controls term frequency saturation (default 1.2)
 * - `b` controls document length normalization (default 0.75)
 * - `IDF(t) = log((N - n(t) + 0.5) / (n(t) + 0.5) + 1)` (Robertson-Walker IDF)
 *
 * @module agentos/rag/search/BM25Index
 * @see HybridSearcher for combining BM25 with dense vector search
 */
/**
 * Internal document representation stored in the BM25 index.
 *
 * @interface BM25Document
 * @property {string} id - Unique document identifier.
 * @property {number} length - Number of tokens in the document after tokenization.
 * @property {Record<string, unknown>} [metadata] - Optional metadata attached to the document.
 */
export interface BM25Document {
    /** Unique document identifier. */
    id: string;
    /** Number of tokens in the document after tokenization. */
    length: number;
    /** Optional metadata attached to the document. */
    metadata?: Record<string, unknown>;
}
/**
 * A single BM25 search result with relevance score.
 *
 * @interface BM25Result
 * @property {string} id - Document identifier.
 * @property {number} score - BM25 relevance score (higher = more relevant).
 * @property {Record<string, unknown>} [metadata] - Document metadata if available.
 */
export interface BM25Result {
    /** Document identifier. */
    id: string;
    /** BM25 relevance score (higher = more relevant). */
    score: number;
    /** Document metadata if available. */
    metadata?: Record<string, unknown>;
}
/**
 * Configuration options for the BM25 index.
 *
 * @interface BM25Config
 * @property {number} [k1=1.2] - Term saturation parameter. Higher values increase
 *   the influence of term frequency. Range: 1.2-2.0 typical.
 * @property {number} [b=0.75] - Document length normalization factor.
 *   0 = no normalization, 1 = full normalization. Range: 0-1.
 */
export interface BM25Config {
    /** Term saturation parameter. Default: 1.2. */
    k1?: number;
    /** Document length normalization factor. Default: 0.75. */
    b?: number;
    /**
     * Optional text processing pipeline for tokenization.
     * When provided, replaces the built-in regex tokenizer with configurable
     * stemming, lemmatization, and stop word handling.
     * @see createRagPipeline from nlp for the recommended default.
     */
    pipeline?: import('../../nlp/TextProcessingPipeline').TextProcessingPipeline;
}
/**
 * Index statistics for monitoring and debugging.
 *
 * @interface BM25Stats
 * @property {number} documentCount - Total documents in the index.
 * @property {number} termCount - Total unique terms across all documents.
 * @property {number} avgDocLength - Average document length in tokens.
 */
export interface BM25Stats {
    /** Total documents in the index. */
    documentCount: number;
    /** Total unique terms across all documents. */
    termCount: number;
    /** Average document length in tokens. */
    avgDocLength: number;
}
/**
 * BM25 sparse keyword index for hybrid retrieval.
 *
 * Dense embeddings excel at semantic similarity but miss exact keyword matches
 * (e.g., error codes, function names, product IDs). BM25 catches these by
 * scoring documents based on term frequency, inverse document frequency,
 * and document length normalization.
 *
 * @example Basic usage
 * ```typescript
 * const index = new BM25Index({ k1: 1.5, b: 0.75 });
 *
 * index.addDocuments([
 *   { id: 'doc-1', text: 'TypeScript compiler error TS2304' },
 *   { id: 'doc-2', text: 'JavaScript runtime TypeError explanation' },
 *   { id: 'doc-3', text: 'Fix error TS2304 by adding type declarations' },
 * ]);
 *
 * const results = index.search('error TS2304', 5);
 * // results[0].id === 'doc-3' (exact match on "error" + "TS2304")
 * // results[1].id === 'doc-1' (exact match on "error" + "TS2304")
 * ```
 *
 * @example Combined with HybridSearcher
 * ```typescript
 * const hybrid = new HybridSearcher(vectorStore, embeddingManager, bm25Index, {
 *   denseWeight: 0.7,
 *   sparseWeight: 0.3,
 * });
 * const results = await hybrid.search('What does error TS2304 mean?');
 * ```
 */
export declare class BM25Index {
    /** Term saturation parameter (typical range: 1.2-2.0). */
    private k1;
    /** Document length normalization (0 = none, 1 = full). */
    private b;
    /** Map of document ID to internal document representation. */
    private documents;
    /**
     * Inverted index mapping each term to a map of document IDs and their
     * raw term frequencies: `term -> { docId -> termFrequency }`.
     */
    private invertedIndex;
    /**
     * Pre-computed IDF (Inverse Document Frequency) for each indexed term.
     * Recomputed when documents are added or removed.
     */
    private idf;
    /** Average document length across the entire corpus (in tokens). */
    private avgDocLength;
    /** Whether the IDF cache needs recomputation. */
    private idfDirty;
    /**
     * Optional pluggable text processing pipeline. When set, replaces the
     * built-in regex tokenizer with configurable stemming, lemmatization,
     * and stop word handling.
     */
    private pipeline?;
    /**
     * Creates a new BM25 index.
     *
     * @param {BM25Config} [config] - Optional BM25 tuning parameters.
     * @param {number} [config.k1=1.2] - Term saturation parameter.
     * @param {number} [config.b=0.75] - Document length normalization.
     *
     * @example
     * ```typescript
     * // Use defaults (k1=1.2, b=0.75)
     * const index = new BM25Index();
     *
     * // Custom parameters for short documents
     * const shortDocIndex = new BM25Index({ k1: 1.5, b: 0.5 });
     * ```
     */
    constructor(config?: BM25Config);
    /**
     * Tokenizes raw text into an array of normalized terms.
     *
     * Processing pipeline:
     * 1. Convert to lowercase
     * 2. Split on whitespace and punctuation boundaries
     * 3. Filter out stop words and tokens shorter than 2 characters
     *
     * @param {string} text - Raw text to tokenize.
     * @returns {string[]} Array of normalized tokens.
     *
     * @example
     * ```typescript
     * // "The Quick Brown FOX!" -> ["quick", "brown", "fox"]
     * ```
     */
    private tokenize;
    /**
     * Recomputes IDF values for all terms in the index.
     *
     * Uses the Robertson-Walker IDF formula:
     * `IDF(t) = log((N - n(t) + 0.5) / (n(t) + 0.5) + 1)`
     *
     * Where:
     * - N = total number of documents
     * - n(t) = number of documents containing term t
     *
     * The `+ 1` prevents negative IDF values for extremely common terms.
     */
    private recomputeIdf;
    /**
     * Adds a single document to the BM25 index.
     *
     * The text is tokenized, stop words are removed, and term frequencies
     * are recorded in the inverted index. IDF values are lazily recomputed
     * on the next search.
     *
     * @param {string} id - Unique document identifier.
     * @param {string} text - Document text content to index.
     * @param {Record<string, unknown>} [metadata] - Optional metadata to store.
     * @throws {Error} If `id` is empty or `text` is empty.
     *
     * @example
     * ```typescript
     * index.addDocument('readme', 'AgentOS is a framework for building AI agents');
     * index.addDocument('changelog', 'v2.0: Added BM25 hybrid search', { version: '2.0' });
     * ```
     */
    addDocument(id: string, text: string, metadata?: Record<string, unknown>): void;
    /**
     * Adds multiple documents to the index in a single batch.
     *
     * More efficient than calling {@link addDocument} repeatedly because
     * IDF recomputation is deferred until the next search.
     *
     * @param {Array<{ id: string; text: string; metadata?: Record<string, unknown> }>} docs
     *   Array of documents to index.
     *
     * @example
     * ```typescript
     * index.addDocuments([
     *   { id: 'doc-1', text: 'First document content' },
     *   { id: 'doc-2', text: 'Second document content', metadata: { source: 'api' } },
     * ]);
     * ```
     */
    addDocuments(docs: Array<{
        id: string;
        text: string;
        metadata?: Record<string, unknown>;
    }>): void;
    /**
     * Searches the BM25 index for documents matching the query.
     *
     * Scoring formula per document D and query Q:
     * ```
     * score(D, Q) = sum_{t in Q} IDF(t) * (tf(t,D) * (k1 + 1)) / (tf(t,D) + k1 * (1 - b + b * |D| / avgdl))
     * ```
     *
     * @param {string} query - Search query text.
     * @param {number} [topK=10] - Maximum number of results to return.
     * @returns {BM25Result[]} Array of results sorted by BM25 score descending.
     *
     * @example
     * ```typescript
     * const results = index.search('typescript error TS2304', 5);
     * for (const r of results) {
     *   console.log(`${r.id}: score=${r.score.toFixed(4)}`);
     * }
     * ```
     */
    search(query: string, topK?: number): BM25Result[];
    /**
     * Removes a document from the index by its ID.
     *
     * Cleans up all term frequency entries in the inverted index and
     * marks IDF for recomputation.
     *
     * @param {string} id - Document ID to remove.
     * @returns {boolean} `true` if the document existed and was removed, `false` otherwise.
     *
     * @example
     * ```typescript
     * const removed = index.removeDocument('doc-obsolete');
     * console.log(removed ? 'Removed' : 'Not found');
     * ```
     */
    removeDocument(id: string): boolean;
    /**
     * Returns current index statistics.
     *
     * @returns {BM25Stats} Object containing document count, term count,
     *   and average document length.
     *
     * @example
     * ```typescript
     * const stats = index.getStats();
     * console.log(`${stats.documentCount} docs, ${stats.termCount} unique terms`);
     * ```
     */
    getStats(): BM25Stats;
}
//# sourceMappingURL=BM25Index.d.ts.map
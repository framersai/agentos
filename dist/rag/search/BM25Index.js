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
// ── Stop Words ────────────────────────────────────────────────────────────
import { getNaturalStopWords } from '../../nlp/filters/StopWordFilter.js';
/**
 * Stop words used by the fallback regex tokenizer (when no pipeline is configured).
 * Uses `natural`'s 170-word list when available, falls back to the built-in
 * 120-word ENGLISH_STOP_WORDS set.
 *
 * When a `TextProcessingPipeline` is configured via `BM25Config.pipeline`,
 * the pipeline handles stop word filtering internally and this set is not used.
 */
const STOP_WORDS = getNaturalStopWords();
// ── BM25 Index ────────────────────────────────────────────────────────────
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
export class BM25Index {
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
    constructor(config) {
        this.k1 = config?.k1 ?? 1.2;
        this.b = config?.b ?? 0.75;
        this.pipeline = config?.pipeline;
        this.documents = new Map();
        this.invertedIndex = new Map();
        this.idf = new Map();
        this.avgDocLength = 0;
        this.idfDirty = false;
    }
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
    tokenize(text) {
        /* Use pluggable pipeline when configured (supports stemming, lemmatization, etc.) */
        if (this.pipeline) {
            return this.pipeline.processToStrings(text);
        }
        /* Fallback: built-in regex tokenizer (backwards compatible) */
        return text
            .toLowerCase()
            .split(/[\s\-_.,;:!?'"()[\]{}<>/\\|@#$%^&*~`+=]+/)
            .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
    }
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
    recomputeIdf() {
        if (!this.idfDirty)
            return;
        const N = this.documents.size;
        this.idf.clear();
        for (const [term, docMap] of this.invertedIndex) {
            const n = docMap.size;
            // Robertson-Walker IDF: log((N - n + 0.5) / (n + 0.5) + 1)
            this.idf.set(term, Math.log((N - n + 0.5) / (n + 0.5) + 1));
        }
        // Recompute average document length
        if (N === 0) {
            this.avgDocLength = 0;
        }
        else {
            let totalLength = 0;
            for (const doc of this.documents.values()) {
                totalLength += doc.length;
            }
            this.avgDocLength = totalLength / N;
        }
        this.idfDirty = false;
    }
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
    addDocument(id, text, metadata) {
        if (!id)
            throw new Error('BM25Index.addDocument: id must not be empty.');
        if (!text)
            throw new Error('BM25Index.addDocument: text must not be empty.');
        // Remove previous version if exists
        if (this.documents.has(id)) {
            this.removeDocument(id);
        }
        const tokens = this.tokenize(text);
        // Count term frequencies for this document
        const termFreqs = new Map();
        for (const token of tokens) {
            termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
        }
        // Store document metadata
        this.documents.set(id, {
            id,
            length: tokens.length,
            metadata,
        });
        // Update inverted index
        for (const [term, freq] of termFreqs) {
            let docMap = this.invertedIndex.get(term);
            if (!docMap) {
                docMap = new Map();
                this.invertedIndex.set(term, docMap);
            }
            docMap.set(id, freq);
        }
        this.idfDirty = true;
    }
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
    addDocuments(docs) {
        for (const doc of docs) {
            this.addDocument(doc.id, doc.text, doc.metadata);
        }
    }
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
    search(query, topK = 10) {
        // Ensure IDF is up-to-date
        this.recomputeIdf();
        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0)
            return [];
        const scores = new Map();
        for (const term of queryTokens) {
            const idfValue = this.idf.get(term);
            if (idfValue === undefined)
                continue;
            const docMap = this.invertedIndex.get(term);
            if (!docMap)
                continue;
            for (const [docId, tf] of docMap) {
                const doc = this.documents.get(docId);
                const dl = doc.length;
                const avgdl = this.avgDocLength || 1;
                // BM25 score for this term in this document
                const numerator = tf * (this.k1 + 1);
                const denominator = tf + this.k1 * (1 - this.b + this.b * (dl / avgdl));
                const termScore = idfValue * (numerator / denominator);
                scores.set(docId, (scores.get(docId) ?? 0) + termScore);
            }
        }
        // Sort by score descending and return top K
        const results = [];
        for (const [id, score] of scores) {
            const doc = this.documents.get(id);
            results.push({ id, score, metadata: doc.metadata });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
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
    removeDocument(id) {
        const doc = this.documents.get(id);
        if (!doc)
            return false;
        // Remove all entries for this document from the inverted index
        for (const [term, docMap] of this.invertedIndex) {
            docMap.delete(id);
            if (docMap.size === 0) {
                this.invertedIndex.delete(term);
            }
        }
        this.documents.delete(id);
        this.idfDirty = true;
        return true;
    }
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
    getStats() {
        // Ensure avgDocLength is current
        this.recomputeIdf();
        return {
            documentCount: this.documents.size,
            termCount: this.invertedIndex.size,
            avgDocLength: this.avgDocLength,
        };
    }
}
//# sourceMappingURL=BM25Index.js.map
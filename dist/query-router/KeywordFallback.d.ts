/**
 * @fileoverview KeywordFallback — simple keyword-matching search used as
 * the degraded-mode fallback when the embedding API is unavailable.
 * @module @framers/agentos/query-router/KeywordFallback
 *
 * When the vector store or embedding service is down, the QueryRouter
 * activates this fallback to provide best-effort retrieval via plain
 * keyword matching. It is intentionally simple: split query into words,
 * filter stop words, score each corpus chunk by keyword hits (heading
 * matches weighted higher than content matches), and return the top-K
 * results sorted by score.
 */
import type { CorpusChunk, RetrievedChunk } from './types.js';
/**
 * Simple keyword-matching search over a corpus of chunks.
 *
 * Used as a degraded-mode fallback when the embedding API is unavailable.
 * Splits the query into keywords, filters out stop words and short tokens,
 * then scores each chunk by the number of keyword hits (heading matches
 * receive a higher weight than content matches).
 *
 * @example
 * ```typescript
 * const fallback = new KeywordFallback(corpusChunks);
 * const results = fallback.search('authentication tokens', 5);
 * // results: RetrievedChunk[] sorted by relevance, at most 5 entries
 * ```
 */
export declare class KeywordFallback {
    /** The corpus chunks to search over. */
    private readonly chunks;
    /**
     * Creates a new KeywordFallback instance.
     * @param chunks - The corpus chunks to search over.
     */
    constructor(chunks: CorpusChunk[]);
    /**
     * Searches the corpus for chunks matching the given query keywords.
     *
     * Scoring algorithm:
     * - Each keyword found in the chunk heading awards {@link HEADING_MATCH_SCORE} points.
     * - Each keyword found in the chunk content awards {@link CONTENT_MATCH_SCORE} point.
     * - Chunks with zero total score are excluded.
     * - Scores are normalized to the 0-1 range (relative to the maximum observed score).
     * - Results are sorted by score descending and sliced to topK.
     *
     * @param query - The user query string to match.
     * @param topK - Maximum number of results to return. Defaults to 5.
     * @returns Array of RetrievedChunk sorted by relevance, at most topK entries.
     */
    search(query: string, topK?: number): RetrievedChunk[];
    /**
     * Extracts meaningful keywords from a query string.
     * Splits on whitespace, lowercases, and filters out stop words
     * and tokens shorter than 3 characters.
     *
     * @param query - The raw query string.
     * @returns Array of lowercase keyword strings.
     */
    private extractKeywords;
    /**
     * Scores a single chunk against the given keywords.
     *
     * @param chunk - The corpus chunk to score.
     * @param keywords - The extracted query keywords (lowercase).
     * @returns The raw score (sum of heading and content matches).
     */
    private scoreChunk;
}
//# sourceMappingURL=KeywordFallback.d.ts.map
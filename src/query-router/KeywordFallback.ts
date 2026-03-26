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
 * Common English stop words that add noise to keyword matching.
 * Words shorter than 3 characters are also filtered out automatically.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has',
  'her', 'was', 'one', 'our', 'out', 'had', 'hot', 'how', 'its', 'let',
  'may', 'who', 'did', 'get', 'got', 'him', 'his', 'she', 'too', 'use',
  'that', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'been',
  'than', 'them', 'then', 'what', 'when', 'were', 'which', 'their', 'there',
  'these', 'those', 'would', 'about', 'could', 'other', 'into', 'more',
  'some', 'such', 'only', 'also', 'just', 'does', 'each', 'very',
]);

/** Points awarded for a keyword match in the chunk heading. */
const HEADING_MATCH_SCORE = 4;

/** Points awarded for a keyword match in the chunk content. */
const CONTENT_MATCH_SCORE = 1;

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
export class KeywordFallback {
  /** The corpus chunks to search over. */
  private readonly chunks: CorpusChunk[];

  /**
   * Creates a new KeywordFallback instance.
   * @param chunks - The corpus chunks to search over.
   */
  constructor(chunks: CorpusChunk[]) {
    this.chunks = chunks;
  }

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
  search(query: string, topK: number = 5): RetrievedChunk[] {
    const keywords = this.extractKeywords(query);

    if (keywords.length === 0) {
      return [];
    }

    /** Intermediate scored chunk before normalization. */
    interface ScoredChunk {
      chunk: CorpusChunk;
      rawScore: number;
    }

    const scored: ScoredChunk[] = [];

    for (const chunk of this.chunks) {
      const rawScore = this.scoreChunk(chunk, keywords);
      if (rawScore > 0) {
        scored.push({ chunk, rawScore });
      }
    }

    if (scored.length === 0) {
      return [];
    }

    // Sort by raw score descending
    scored.sort((a, b) => b.rawScore - a.rawScore);

    // Find the maximum score for normalization
    const maxScore = scored[0].rawScore;

    // Slice to topK and map to RetrievedChunk
    return scored.slice(0, topK).map(({ chunk, rawScore }): RetrievedChunk => ({
      id: chunk.id,
      content: chunk.content,
      heading: chunk.heading,
      sourcePath: chunk.sourcePath,
      relevanceScore: maxScore > 0 ? rawScore / maxScore : 0,
      matchType: 'vector',
    }));
  }

  /**
   * Extracts meaningful keywords from a query string.
   * Splits on whitespace, lowercases, and filters out stop words
   * and tokens shorter than 3 characters.
   *
   * @param query - The raw query string.
   * @returns Array of lowercase keyword strings.
   */
  private extractKeywords(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  }

  /**
   * Scores a single chunk against the given keywords.
   *
   * @param chunk - The corpus chunk to score.
   * @param keywords - The extracted query keywords (lowercase).
   * @returns The raw score (sum of heading and content matches).
   */
  private scoreChunk(chunk: CorpusChunk, keywords: string[]): number {
    const headingLower = chunk.heading.toLowerCase();
    const contentLower = chunk.content.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (headingLower.includes(keyword)) {
        score += HEADING_MATCH_SCORE;
      }
      if (contentLower.includes(keyword)) {
        score += CONTENT_MATCH_SCORE;
      }
    }

    return score;
  }
}

/**
 * @fileoverview TopicExtractor — scans corpus chunks and extracts a
 * deduplicated topic list for the QueryClassifier's system prompt.
 *
 * During QueryRouter initialisation the full corpus is chunked and
 * embedded, but the classifier prompt only needs a compact inventory
 * of what topics exist — not every chunk's content. TopicExtractor
 * produces that inventory by:
 *
 * 1. Walking every {@link CorpusChunk} and extracting its `heading`
 *    and `sourcePath`.
 * 2. Deduplicating by `heading::sourcePath` composite key so each
 *    unique section appears exactly once.
 * 3. Sorting alphabetically by topic name (then by source on tie).
 * 4. Capping the list at `maxTopics` (default 50) to keep the
 *    classifier prompt within a predictable token budget.
 *
 * The resulting {@link TopicEntry} array can be formatted into a
 * one-line-per-topic string via {@link TopicExtractor.formatForPrompt}.
 *
 * @module @framers/agentos/query-router/TopicExtractor
 */

import type { CorpusChunk, TopicEntry } from './types.js';

/**
 * Default maximum number of topics returned by {@link TopicExtractor.extract}.
 * Keeps the classifier system prompt under ~500 tokens for the topic block.
 */
const DEFAULT_MAX_TOPICS = 50;

/**
 * Options for the {@link TopicExtractor.extract} method.
 */
export interface TopicExtractorOptions {
  /**
   * Maximum number of topics to return.
   * Topics beyond this limit are silently dropped (after sort + dedup).
   * @default 50
   */
  maxTopics?: number;
}

/**
 * Extracts a compact, deduplicated topic list from a set of corpus chunks.
 *
 * Designed to feed into the QueryClassifier's system prompt so the LLM
 * knows which documentation topics exist without receiving the full corpus.
 *
 * @example
 * ```typescript
 * const extractor = new TopicExtractor();
 * const topics = extractor.extract(corpusChunks, { maxTopics: 30 });
 * const promptBlock = extractor.formatForPrompt(topics);
 * // "Authentication (docs/auth.md)\nDatabase (docs/database.md)\n..."
 * ```
 */
export class TopicExtractor {
  /**
   * Extract a deduplicated, sorted, and capped topic list from corpus chunks.
   *
   * Deduplication key: `heading::sourcePath`. Two chunks with the same
   * heading from the same source file are collapsed into a single entry.
   *
   * @param chunks - Corpus chunks to scan for topics.
   * @param options - Optional extraction parameters.
   * @returns Alphabetically sorted array of unique {@link TopicEntry} items,
   *          limited to `maxTopics` entries.
   */
  extract(chunks: CorpusChunk[], options?: TopicExtractorOptions): TopicEntry[] {
    if (chunks.length === 0) {
      return [];
    }

    const maxTopics = options?.maxTopics ?? DEFAULT_MAX_TOPICS;

    // Deduplicate by composite key heading::sourcePath
    const seen = new Set<string>();
    const unique: TopicEntry[] = [];

    for (const chunk of chunks) {
      const key = `${chunk.heading}::${chunk.sourcePath}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({
          name: chunk.heading,
          source: chunk.sourcePath,
        });
      }
    }

    // Sort alphabetically by name, then by source on tie
    unique.sort((a, b) => {
      const nameCmp = a.name.localeCompare(b.name);
      if (nameCmp !== 0) return nameCmp;
      return a.source.localeCompare(b.source);
    });

    // Cap at maxTopics
    return unique.slice(0, maxTopics);
  }

  /**
   * Format a topic list into a compact multi-line string suitable for
   * injection into a classifier system prompt.
   *
   * Each line follows the pattern: `TopicName (source/path.md)`
   *
   * @param topics - Array of topic entries to format.
   * @returns Newline-separated string with one topic per line.
   */
  formatForPrompt(topics: TopicEntry[]): string {
    return topics.map((t) => `${t.name} (${t.source})`).join('\n');
  }
}

/**
 * @fileoverview TopicEmbeddingIndex — semantic similarity lookup for topic guardrails.
 *
 * This module implements a lightweight in-memory embedding index that:
 *
 * 1. **Builds** per-topic centroid embeddings from descriptions + examples.
 * 2. **Matches** an arbitrary embedding or text string against all topic centroids
 *    using cosine similarity.
 * 3. **Answers** boolean on-topic queries at a configurable similarity threshold.
 *
 * ### How centroids are built
 * For each {@link TopicDescriptor} the index concatenates:
 * ```
 * texts = [descriptor.description, ...descriptor.examples]
 * ```
 * All topics are embedded in a single batch call to `embeddingFn` to minimise
 * round-trips.  The centroid for a topic is the component-wise average (mean)
 * of all its embedding vectors.
 *
 * ### Similarity scoring
 * Raw cosine similarity can be negative when vectors point in opposite directions.
 * `matchByVector` clamps scores to `Math.max(0, similarity)` so that all
 * {@link TopicMatch} values represent non-negative relevance scores.
 *
 * @module topicality/TopicEmbeddingIndex
 */

import { cosineSimilarity } from '../../../core/utils/text-utils';
import type { TopicDescriptor, TopicMatch } from './types';

// ---------------------------------------------------------------------------
// Internal storage shape
// ---------------------------------------------------------------------------

/**
 * Private per-topic record stored in the index map.
 *
 * @internal
 */
interface TopicEntry {
  /** Original descriptor, kept for metadata retrieval. */
  descriptor: TopicDescriptor;
  /**
   * Component-wise average of all embeddings derived from this topic's
   * description and example strings.
   */
  centroid: number[];
}

// ---------------------------------------------------------------------------
// TopicEmbeddingIndex
// ---------------------------------------------------------------------------

/**
 * Semantic embedding index for topicality guardrail matching.
 *
 * The index is intentionally **lazy** — it holds no embeddings until
 * {@link build} is called.  This makes instantiation cheap and lets the
 * caller defer the (potentially expensive) batch embedding call until the
 * agent's first message.
 *
 * @example
 * ```ts
 * const index = new TopicEmbeddingIndex(async (texts) => {
 *   const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: texts });
 *   return res.data.map(d => d.embedding);
 * });
 *
 * await index.build(TOPIC_PRESETS.customerSupport);
 *
 * const matches = await index.match('How do I cancel my subscription?');
 * // → [{ topicId: 'billing', topicName: 'Billing & Payments', similarity: 0.82 }, ...]
 *
 * const onTopic = await index.isOnTopic('Tell me a joke', 0.35);
 * // → false (a joke doesn't match any customer-support topic)
 * ```
 */
export class TopicEmbeddingIndex {
  /**
   * Caller-supplied batch embedding function.
   * Invoked once during {@link build} with all topic texts concatenated.
   */
  private readonly embeddingFn: (texts: string[]) => Promise<number[][]>;

  /**
   * Internal store mapping `topicId → TopicEntry`.
   * Populated by {@link build}; empty until then.
   */
  private readonly entries: Map<string, TopicEntry> = new Map();

  /** Whether {@link build} has been called and completed successfully. */
  private built: boolean = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a new `TopicEmbeddingIndex`.
   *
   * @param embeddingFn - Async function that converts an array of text strings
   *   into corresponding numeric embedding vectors.  All returned vectors must
   *   share the same dimensionality.  The function is called exactly **once**
   *   per {@link build} invocation with all texts for all topics batched
   *   together.
   */
  constructor(embeddingFn: (texts: string[]) => Promise<number[][]>) {
    this.embeddingFn = embeddingFn;
  }

  // -------------------------------------------------------------------------
  // Public API — build
  // -------------------------------------------------------------------------

  /**
   * Embeds all topic descriptions and examples, computes per-topic centroid
   * embeddings, and stores them in the internal index.
   *
   * Calling `build()` a second time replaces the existing index entirely,
   * allowing hot-reloading of topic configurations without recreating the
   * instance.
   *
   * ### Centroid computation
   * For each topic we collect `[description, ...examples]` as a list of
   * strings, embed them all in one batch, then average the resulting vectors
   * component-wise to produce a single representative centroid.
   *
   * All topics are embedded in a **single batch call** to minimise latency.
   *
   * @param topics - Array of {@link TopicDescriptor} objects to index.
   *   An empty array is valid — the index will simply return no matches.
   * @returns A promise that resolves once all embeddings are computed and
   *   stored.  Rejects if `embeddingFn` throws or returns vectors of
   *   mismatched length.
   */
  async build(topics: TopicDescriptor[]): Promise<void> {
    // Reset state before (re)building so a failed build leaves the index empty
    // rather than in a partial state.
    this.entries.clear();
    this.built = false;

    if (topics.length === 0) {
      // Nothing to embed — mark as built so isBuilt returns true.
      this.built = true;
      return;
    }

    // Collect, per topic, the list of texts to embed and the range of
    // indices they will occupy in the flat batch array.
    //
    // Layout: [topic0_desc, topic0_ex0, topic0_ex1, …, topic1_desc, …]
    const allTexts: string[] = [];
    const topicRanges: Array<{ topic: TopicDescriptor; start: number; end: number }> = [];

    for (const topic of topics) {
      const start = allTexts.length;
      // Always include the description as the first text for this topic.
      allTexts.push(topic.description);
      // Then all examples (may be empty — the centroid will just be the description).
      for (const example of topic.examples) {
        allTexts.push(example);
      }
      const end = allTexts.length; // exclusive
      topicRanges.push({ topic, start, end });
    }

    // Single batch embedding call — one round-trip regardless of how many
    // topics or examples are configured.
    const allEmbeddings = await this.embeddingFn(allTexts);

    // Validate that the embedding function returned the right number of vectors.
    if (allEmbeddings.length !== allTexts.length) {
      throw new Error(
        `TopicEmbeddingIndex.build: embeddingFn returned ${allEmbeddings.length} vectors ` +
          `but ${allTexts.length} texts were provided.`,
      );
    }

    // Compute centroid for each topic from its slice of the batch result.
    for (const { topic, start, end } of topicRanges) {
      const slice = allEmbeddings.slice(start, end);
      const centroid = computeCentroid(slice);
      this.entries.set(topic.id, { descriptor: topic, centroid });
    }

    this.built = true;
  }

  // -------------------------------------------------------------------------
  // Public API — matchByVector
  // -------------------------------------------------------------------------

  /**
   * Computes similarity between a pre-computed embedding vector and all topic
   * centroids **without** making any additional embedding calls.
   *
   * This is the hot path invoked by {@link TopicDriftTracker}, which maintains
   * its own running embedding and never needs to re-embed.
   *
   * Results are clamped to `[0, 1]` (negative cosine → 0) and sorted
   * descending by similarity.
   *
   * @param embedding - A numeric vector with the same dimensionality as the
   *   centroids produced during {@link build}.
   * @returns Array of {@link TopicMatch} objects sorted by similarity
   *   descending.  Returns an empty array if the index was not yet built or
   *   contains no topics.
   */
  matchByVector(embedding: number[]): TopicMatch[] {
    if (!this.built || this.entries.size === 0) {
      // Return empty rather than throwing — callers can treat no match as off-topic.
      return [];
    }

    const matches: TopicMatch[] = [];

    for (const [topicId, entry] of this.entries) {
      const raw = cosineSimilarity(embedding, entry.centroid);
      // Clamp to [0, 1] — negative similarity means "opposite direction" which
      // is no more useful than "unrelated" for topic matching.
      const similarity = Math.max(0, raw);

      matches.push({
        topicId,
        topicName: entry.descriptor.name,
        similarity,
      });
    }

    // Sort descending so the best match is first.
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches;
  }

  // -------------------------------------------------------------------------
  // Public API — match
  // -------------------------------------------------------------------------

  /**
   * Embeds `text` and returns similarity scores against all topic centroids.
   *
   * This is a convenience wrapper that handles the embedding step.  If you
   * already have an embedding (e.g. from the drift tracker's running vector)
   * prefer {@link matchByVector} to avoid a redundant embedding call.
   *
   * @param text - The user message or assistant output to evaluate.
   * @returns A promise resolving to {@link TopicMatch}[] sorted descending.
   */
  async match(text: string): Promise<TopicMatch[]> {
    // Embed the single query text.
    const [embedding] = await this.embeddingFn([text]);
    return this.matchByVector(embedding);
  }

  // -------------------------------------------------------------------------
  // Public API — isOnTopicByVector
  // -------------------------------------------------------------------------

  /**
   * Returns `true` if the given embedding vector scores above `threshold`
   * against **at least one** topic in the index.
   *
   * Uses {@link matchByVector} internally so no additional embedding call is
   * made.
   *
   * @param embedding - Pre-computed numeric vector.
   * @param threshold - Minimum similarity (in `[0, 1]`) for a topic to count
   *   as a match.
   * @returns `true` if any topic centroid has similarity > threshold; otherwise `false`.
   */
  isOnTopicByVector(embedding: number[], threshold: number): boolean {
    const matches = this.matchByVector(embedding);
    // The list is sorted descending, so we only need to check the first entry.
    return matches.length > 0 && matches[0].similarity > threshold;
  }

  // -------------------------------------------------------------------------
  // Public API — isOnTopic
  // -------------------------------------------------------------------------

  /**
   * Embeds `text` and returns `true` if it scores above `threshold` against
   * at least one allowed topic.
   *
   * @param text      - The text to evaluate.
   * @param threshold - Minimum cosine similarity for the text to be considered on-topic.
   * @returns A promise resolving to `true` if on-topic, `false` otherwise.
   */
  async isOnTopic(text: string, threshold: number): Promise<boolean> {
    const [embedding] = await this.embeddingFn([text]);
    return this.isOnTopicByVector(embedding, threshold);
  }

  // -------------------------------------------------------------------------
  // Getter
  // -------------------------------------------------------------------------

  /**
   * Whether {@link build} has been called and completed successfully.
   *
   * Use this to guard against calling {@link match} or {@link matchByVector}
   * before the index is ready.
   *
   * @example
   * ```ts
   * if (!index.isBuilt) await index.build(topics);
   * ```
   */
  get isBuilt(): boolean {
    return this.built;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes the component-wise average (centroid) of an array of embedding
 * vectors.
 *
 * All input vectors are assumed to have the same dimensionality.  If the
 * input array is empty an empty array is returned (safe no-op).
 *
 * @param vectors - One or more numeric vectors of equal length.
 * @returns A single vector whose i-th element is the mean of i-th elements
 *   across all input vectors.
 *
 * @internal
 */
function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];

  const dim = vectors[0].length;
  // Initialise accumulator to all zeros.
  const sum = new Array<number>(dim).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i];
    }
  }

  // Divide each component by the number of vectors to get the mean.
  return sum.map((v) => v / vectors.length);
}

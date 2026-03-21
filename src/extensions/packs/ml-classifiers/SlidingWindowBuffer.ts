/**
 * @fileoverview Sliding-window text buffer for streaming ML classifier evaluation.
 *
 * When an LLM streams its response token-by-token, we cannot wait for the
 * complete response before running safety classifiers — that would be too late
 * to block or sanitise harmful content.  At the same time, classifiers are
 * expensive: running one on every individual token is wasteful and introduces
 * unacceptable latency.
 *
 * `SlidingWindowBuffer` solves this by accumulating tokens from one or more
 * concurrent streams and emitting a {@link ChunkReady} event only when enough
 * tokens have accumulated to fill a `chunkSize`-token window.  Each window
 * also includes a `contextSize`-token "ring" from the previous chunk, so the
 * classifier can reason about content that spans window boundaries.
 *
 * Architecture
 * ------------
 * - **Per-stream state**: Stored in a `Map<streamId, WindowState>`.  Each
 *   stream is fully independent and can be used across multiple concurrent
 *   responses.
 * - **Token estimation**: Uses the 4-chars-per-token heuristic for speed;
 *   callers that need exact counts should pre-tokenise text before pushing.
 * - **Evaluation budget**: Once a stream reaches `maxEvaluations` chunks,
 *   `push()` returns `null` for all subsequent pushes, preventing unbounded
 *   classifier invocations on very long responses.
 * - **Stale-stream pruning**: Streams that have not received data within
 *   `streamTimeoutMs` milliseconds are lazily evicted from the map to prevent
 *   memory leaks in long-running servers.
 *
 * @module agentos/extensions/packs/ml-classifiers/SlidingWindowBuffer
 */

// ---------------------------------------------------------------------------
// Public configuration & result shapes
// ---------------------------------------------------------------------------

/**
 * Configuration for a {@link SlidingWindowBuffer} instance.
 *
 * All fields are optional; unset fields fall back to the defaults shown below.
 */
export interface SlidingWindowConfig {
  /**
   * Target window size in *estimated* tokens.  When the accumulated buffer
   * reaches or exceeds this many tokens, a {@link ChunkReady} is emitted and
   * the buffer is slid forward.
   *
   * @default 200
   */
  chunkSize: number;

  /**
   * Number of tokens from the tail of the previous window to carry into the
   * `text` field of the next {@link ChunkReady}.  This overlap prevents
   * boundary effects where a phrase split across two windows is misclassified.
   *
   * @default 50
   */
  contextSize: number;

  /**
   * Maximum number of {@link ChunkReady} events to emit per stream.  After
   * this budget is exhausted, `push()` returns `null` for the remainder of the
   * stream.  Use `flush()` to retrieve any buffered text that has not been
   * emitted yet.
   *
   * @default 100
   */
  maxEvaluations: number;

  /**
   * Milliseconds of inactivity after which a stream is considered stale and
   * eligible for eviction by {@link SlidingWindowBuffer.pruneStale}.
   *
   * @default 30000
   */
  streamTimeoutMs: number;
}

/**
 * Emitted by {@link SlidingWindowBuffer.push} when sufficient tokens have
 * accumulated to fill one evaluation window.
 */
export interface ChunkReady {
  /**
   * The full text to classify.  Equals `contextRing + newBuffer`, where
   * `contextRing` is the carried-forward tail from the previous window.
   * Always non-empty.
   */
  text: string;

  /**
   * Only the *new* text pushed since the last chunk was emitted (i.e. without
   * the context prefix).  Useful for determining which part of the response
   * was newly evaluated.
   */
  newText: string;

  /**
   * 1-indexed sequence number for this chunk within the stream.
   * The first chunk emitted for a stream has `evaluationNumber === 1`.
   */
  evaluationNumber: number;
}

// ---------------------------------------------------------------------------
// Private per-stream state
// ---------------------------------------------------------------------------

/**
 * Internal state tracked for each active stream.
 *
 * @internal
 */
interface WindowState {
  /**
   * Accumulated text that has not yet been emitted in a chunk.
   * Reset (but not cleared) after each chunk: the tail is moved to
   * `contextRing` and the buffer starts fresh.
   */
  buffer: string;

  /**
   * Running count of *estimated* tokens in `buffer`.
   * Derived from `Math.ceil(buffer.length / 4)`.
   */
  tokenCount: number;

  /**
   * The context tail from the previous chunk.  Prepended to `buffer` when
   * assembling the `text` field of {@link ChunkReady}.
   */
  contextRing: string;

  /**
   * Number of chunks already emitted for this stream.
   * Used to enforce the {@link SlidingWindowConfig.maxEvaluations} budget.
   */
  evaluationCount: number;

  /**
   * Unix timestamp (ms) of the last `push()` call for this stream.
   * Used by {@link SlidingWindowBuffer.pruneStale} to evict idle streams.
   */
  lastSeenAt: number;
}

// ---------------------------------------------------------------------------
// SlidingWindowBuffer implementation
// ---------------------------------------------------------------------------

/**
 * A stateful, multi-stream text accumulator that emits fixed-size windows
 * for ML classifier evaluation with configurable context carry-forward.
 *
 * @example
 * ```typescript
 * const buf = new SlidingWindowBuffer({ chunkSize: 200, contextSize: 50 });
 *
 * // Simulate streaming tokens
 * for (const token of streamedTokens) {
 *   const chunk = buf.push('stream-1', token);
 *   if (chunk) {
 *     const result = await toxicityClassifier.classify(chunk.text);
 *     if (result.confidence > 0.9) terminateStream();
 *   }
 * }
 *
 * // Evaluate remaining tokens
 * const finalChunk = buf.flush('stream-1');
 * if (finalChunk) {
 *   await toxicityClassifier.classify(finalChunk.text);
 * }
 * ```
 */
export class SlidingWindowBuffer {
  /** Resolved configuration (defaults applied). */
  private readonly config: SlidingWindowConfig;

  /**
   * Per-stream state map.  Keyed by the `streamId` passed to `push()`.
   * Entries are created lazily on first push and removed on flush or prune.
   */
  private readonly streams: Map<string, WindowState> = new Map();

  /**
   * Construct a new buffer with the supplied configuration.
   *
   * @param config - Partial configuration; unset fields fall back to defaults:
   *   `chunkSize=200`, `contextSize=50`, `maxEvaluations=100`,
   *   `streamTimeoutMs=30000`.
   */
  constructor(config?: Partial<SlidingWindowConfig>) {
    this.config = {
      chunkSize: config?.chunkSize ?? 200,
      contextSize: config?.contextSize ?? 50,
      maxEvaluations: config?.maxEvaluations ?? 100,
      streamTimeoutMs: config?.streamTimeoutMs ?? 30_000,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Push new text into the buffer for the specified stream.
   *
   * Internally the text is appended to the stream's accumulation buffer.
   * If the buffer's estimated token count reaches `chunkSize`, a
   * {@link ChunkReady} is assembled and returned; the buffer is then reset
   * (with the tail preserved as the context ring for the next window).
   *
   * Returns `null` when:
   * - The buffer has not yet accumulated `chunkSize` tokens.
   * - The stream has already emitted `maxEvaluations` chunks.
   *
   * When the map contains more than 10 streams, stale streams are pruned
   * lazily after the push is processed.
   *
   * @param streamId - Opaque identifier for the stream (e.g. a request UUID).
   * @param text     - The new text fragment to accumulate.
   * @returns A {@link ChunkReady} when an evaluation window is complete, or
   *   `null` if more data is needed (or the budget is exhausted).
   */
  push(streamId: string, text: string): ChunkReady | null {
    if (!text) {
      return null;
    }

    // Initialise state for a new stream.
    if (!this.streams.has(streamId)) {
      this.streams.set(streamId, {
        buffer: '',
        tokenCount: 0,
        contextRing: '',
        evaluationCount: 0,
        lastSeenAt: Date.now(),
      });
    }

    const state = this.streams.get(streamId)!;
    state.lastSeenAt = Date.now();

    // Respect the evaluation budget — stop emitting chunks once exhausted.
    if (state.evaluationCount >= this.config.maxEvaluations) {
      return null;
    }

    // Accumulate incoming text.
    state.buffer += text;
    state.tokenCount = this.estimateTokens(state.buffer);

    // Lazy pruning: clean up stale streams whenever the map grows large.
    // Done unconditionally (not just on chunk emit) so stale entries are
    // reclaimed even when streams are slow to accumulate a full window.
    if (this.streams.size > 10) {
      this.pruneStale();
    }

    // Not enough tokens yet — wait for more.
    if (state.tokenCount < this.config.chunkSize) {
      return null;
    }

    // We have a full window.  Assemble the chunk.
    const chunk = this.assembleChunk(state);

    // Slide the context ring forward: keep the last `contextSize` tokens'
    // worth of characters from the buffer that was just emitted.
    const contextCharBudget = this.config.contextSize * 4;
    state.contextRing = state.buffer.slice(-contextCharBudget);

    // Reset the buffer and token count for the next window.
    state.buffer = '';
    state.tokenCount = 0;
    state.evaluationCount += 1;

    return chunk;
  }

  /**
   * Flush any remaining buffered text for the stream as a final chunk.
   *
   * Call this after the stream ends (e.g. when the LLM emits its final
   * token) to ensure the classifier evaluates the tail of the response.
   *
   * The stream's state entry is removed from the map after flushing.
   *
   * @param streamId - Identifier of the stream to flush.
   * @returns A {@link ChunkReady} for the remaining buffer, or `null` if the
   *   buffer is empty or the stream does not exist.
   */
  flush(streamId: string): ChunkReady | null {
    const state = this.streams.get(streamId);

    // Nothing to flush if the stream is unknown or the buffer is empty.
    if (!state || state.buffer.length === 0) {
      // Always clean up the map entry, even for empty buffers.
      this.streams.delete(streamId);
      return null;
    }

    const chunk = this.assembleChunk(state);
    this.streams.delete(streamId);
    return chunk;
  }

  /**
   * Remove streams that have not received data within `streamTimeoutMs`.
   *
   * Called lazily by `push()` when the stream map grows beyond 10 entries.
   * May also be called proactively by a maintenance timer.
   */
  pruneStale(): void {
    const now = Date.now();
    for (const [id, state] of this.streams) {
      if (now - state.lastSeenAt > this.config.streamTimeoutMs) {
        this.streams.delete(id);
      }
    }
  }

  /**
   * Remove all stream state from the buffer.
   *
   * Useful for graceful shutdown or unit-test teardown to ensure no cross-test
   * state leaks.
   */
  clear(): void {
    this.streams.clear();
  }

  /**
   * The number of streams currently tracked (including stale ones not yet
   * pruned).
   *
   * Exposed primarily for testing and diagnostics.
   */
  get size(): number {
    return this.streams.size;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Assemble a {@link ChunkReady} from the current stream state.
   *
   * The `text` field is the concatenation of `contextRing` and the current
   * `buffer`, giving the classifier cross-boundary context.  The `newText`
   * field is just the raw `buffer` so callers can distinguish old from new.
   *
   * @param state - The mutable state for the stream being assembled.
   * @returns A fully-populated {@link ChunkReady}.
   */
  private assembleChunk(state: WindowState): ChunkReady {
    const newText = state.buffer;
    const text = state.contextRing + newText;
    return {
      text,
      newText,
      // evaluationCount is 0-indexed before increment, so +1 gives 1-indexed number.
      evaluationNumber: state.evaluationCount + 1,
    };
  }

  /**
   * Estimate the number of LLM tokens in a string using the 4-chars-per-token
   * heuristic.
   *
   * This deliberately mirrors {@link estimateTokens} from `core/utils/text-utils`
   * without importing it, keeping this module self-contained and safe to load
   * in Web Worker contexts where module resolution may differ.
   *
   * @param text - The string to estimate.
   * @returns Non-negative integer token count estimate.
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }
}

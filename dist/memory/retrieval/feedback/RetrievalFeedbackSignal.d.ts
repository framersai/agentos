/**
 * @fileoverview Retrieval feedback signal — detects which injected memory
 * traces were actually used vs ignored by the LLM response.
 *
 * ## Why this exists
 * When the memory system injects context traces into a prompt, not all of
 * them will be relevant to the model's generated response.  Tracking which
 * memories were actually referenced allows the spaced-repetition engine to:
 * - Reinforce genuinely helpful memories (via `updateOnRetrieval`).
 * - Accelerate decay on repeatedly-ignored memories (via `penalizeUnused`).
 *
 * ## Detection heuristic
 * A keyword overlap heuristic is used instead of a full LLM call to keep
 * the feedback loop non-blocking and low-latency:
 *   1. Extract unique words > 4 characters from each trace's content.
 *   2. Check how many of those keywords appear in the LLM's response.
 *   3. If matchRatio > 0.30 → signal = 'used', otherwise 'ignored'.
 *
 * An optional `similarityFn` can be injected for higher-fidelity semantic
 * detection, but is not required for the default path.
 *
 * ## Persistence
 * Each feedback event is written to the `retrieval_feedback` table in the
 * agent's `SqliteBrain`.  The `detect()` method therefore requires that a
 * corresponding row exists in `memory_traces` for every trace passed in
 * (i.e. the trace must already be persisted).
 *
 * @module agentos/memory/feedback/RetrievalFeedbackSignal
 */
import type { MemoryTrace } from '../../core/types.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
/**
 * A single retrieval feedback event for one memory trace.
 *
 * `signal`:
 * - `'used'`    — the LLM's response contained enough keywords from this trace
 *                 to be considered referenced (matchRatio > 0.30).
 * - `'ignored'` — the LLM did not appear to use this trace in its response.
 *
 * `context` carries the query or situational description that was active at
 * feedback time.  Stored in the `query` column of `retrieval_feedback`.
 */
export interface RetrievalFeedback {
    /** The ID of the memory trace this feedback relates to. */
    traceId: string;
    /** Whether the trace was referenced by the LLM response. */
    signal: 'used' | 'ignored';
    /** Optional contextual string (e.g. the original user query). */
    context?: string;
    /** Unix ms timestamp when the feedback was recorded. */
    timestamp: number;
}
/**
 * Detects which injected memory traces were used vs ignored by the LLM,
 * persists those signals to the `retrieval_feedback` table, and applies a
 * best-effort trace-strength update in `memory_traces`.
 *
 * **Lifecycle:**
 * 1. Before generation: retrieve relevant traces and inject them into the prompt.
 * 2. After response delivery (non-blocking): call `detect(injectedTraces, response)`.
 * 3. The signal is recorded immediately and the underlying trace is nudged
 *    toward reinforcement or decay.
 * 4. The consolidation pipeline can still read `getStats(traceId)` later for
 *    broader aggregate decisions.
 */
export declare class RetrievalFeedbackSignal {
    private readonly brain;
    private readonly similarityFn?;
    /**
     * @param brain        - The agent's SQLite brain; used to persist and query feedback rows.
     * @param similarityFn - Optional semantic similarity function for higher-fidelity detection.
     *   Receives two strings and returns a promise of a similarity score in [0, 1].
     *   When provided, the score supplements the keyword heuristic, but the
     *   current implementation uses the keyword path only (reserved for future use).
     */
    constructor(brain: SqliteBrain, similarityFn?: ((a: string, b: string) => Promise<number>) | undefined);
    /**
     * Detect which of the injected traces were referenced in `response`, persist
     * the signals to `retrieval_feedback`, update the corresponding
     * `memory_traces` rows, and return the full feedback array.
     *
     * **Keyword heuristic:**
     * - Extract all words > 4 characters from each trace's `content` field,
     *   lowercased and stripped of non-alphanumeric characters.
     * - Compute `matchRatio = (words found in response) / (unique keywords)`.
     * - Signal = `'used'` if matchRatio > 0.30, else `'ignored'`.
     *
     * When a trace has no qualifying keywords (all words ≤ 4 characters), it is
     * treated as `'ignored'` — there is nothing to match against.
     *
     * @param injectedTraces - Memory traces that were injected into the prompt.
     * @param response       - The LLM's generated response text.
     * @param context        - Optional retrieval context, typically the original query.
     * @returns Array of `RetrievalFeedback` events, one per injected trace.
     */
    detect(injectedTraces: MemoryTrace[], response: string, context?: string): Promise<RetrievalFeedback[]>;
    /**
     * Retrieve the feedback history for a single trace, ordered by most-recent
     * first.
     *
     * @param traceId - The memory trace ID to look up.
     * @param limit   - Maximum number of rows to return.  Defaults to 100.
     * @returns Array of `RetrievalFeedback` events, most-recent first.
     */
    getHistory(traceId: string, limit?: number): Promise<RetrievalFeedback[]>;
    /**
     * Return aggregate counts of `'used'` and `'ignored'` signals for a trace.
     *
     * Useful for the consolidation pipeline to decide whether to apply
     * `penalizeUnused` (many ignores) or `updateOnRetrieval` (many used).
     *
     * @param traceId - The memory trace ID to aggregate.
     * @returns `{ used, ignored }` counts.
     */
    getStats(traceId: string): Promise<{
        used: number;
        ignored: number;
    }>;
    /**
     * Extract unique keywords from a text string.
     *
     * A keyword is any word that:
     * - Has more than 4 characters after stripping non-alphanumeric characters.
     * - Is lowercased.
     *
     * Short stop-words (≤ 4 chars) are excluded because they appear in almost
     * every response and would inflate `matchRatio` without providing signal.
     *
     * @param text - The source text (typically a trace's `content` field).
     * @returns Deduplicated array of lowercase keywords longer than 4 characters.
     */
    private _extractKeywords;
    /**
     * Convert a raw `memory_traces` row into a minimal `MemoryTrace` envelope
     * suitable for reuse by the decay model.
     */
    private _buildTrace;
}
//# sourceMappingURL=RetrievalFeedbackSignal.d.ts.map
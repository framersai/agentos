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
 * Each feedback event is written synchronously to the `retrieval_feedback`
 * table in the agent's `SqliteBrain`.  The `detect()` method therefore
 * requires that a corresponding row exists in `memory_traces` for every
 * trace passed in (i.e. the trace must already be persisted).
 *
 * @module agentos/memory/feedback/RetrievalFeedbackSignal
 */

import type { MemoryTrace } from '../types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal row type (matches retrieval_feedback DDL)
// ---------------------------------------------------------------------------

/** Raw row shape returned by SQLite queries on `retrieval_feedback`. */
interface FeedbackRow {
  id: number;
  trace_id: string;
  signal: string;
  query: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// RetrievalFeedbackSignal
// ---------------------------------------------------------------------------

/**
 * Detects which injected memory traces were used vs ignored by the LLM, and
 * persists those signals to the `retrieval_feedback` table.
 *
 * **Lifecycle:**
 * 1. Before generation: retrieve relevant traces and inject them into the prompt.
 * 2. After response delivery (non-blocking): call `detect(injectedTraces, response)`.
 * 3. The decay pipeline reads `getStats(traceId)` during consolidation and
 *    applies `penalizeUnused` / `updateOnRetrieval` accordingly.
 */
export class RetrievalFeedbackSignal {
  /**
   * @param brain        - The agent's SQLite brain; used to persist and query feedback rows.
   * @param similarityFn - Optional semantic similarity function for higher-fidelity detection.
   *   Receives two strings and returns a promise of a similarity score in [0, 1].
   *   When provided, the score supplements the keyword heuristic, but the
   *   current implementation uses the keyword path only (reserved for future use).
   */
  constructor(
    private readonly brain: SqliteBrain,
    private readonly similarityFn?: (a: string, b: string) => Promise<number>,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Detect which of the injected traces were referenced in `response`, persist
   * the signals to `retrieval_feedback`, and return the full feedback array.
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
   * **Note:** `detect()` is synchronous under the hood (better-sqlite3) but
   * declared `async` to allow future replacement with an LLM-backed detector.
   *
   * @param injectedTraces - Memory traces that were injected into the prompt.
   * @param response       - The LLM's generated response text.
   * @returns Array of `RetrievalFeedback` events, one per injected trace.
   */
  async detect(
    injectedTraces: MemoryTrace[],
    response: string,
  ): Promise<RetrievalFeedback[]> {
    const responseLower = response.toLowerCase();
    const feedbacks: RetrievalFeedback[] = [];
    const now = Date.now();

    const insertStmt = this.brain.db.prepare<[string, string, string | null, number]>(
      `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at)
       VALUES (?, ?, ?, ?)`,
    );

    for (const trace of injectedTraces) {
      const keywords = this._extractKeywords(trace.content);
      let signal: 'used' | 'ignored' = 'ignored';

      if (keywords.length > 0) {
        const matchCount = keywords.filter((kw) => responseLower.includes(kw)).length;
        const matchRatio = matchCount / keywords.length;
        if (matchRatio > 0.3) {
          signal = 'used';
        }
      }

      insertStmt.run(trace.id, signal, null, now);

      feedbacks.push({
        traceId: trace.id,
        signal,
        timestamp: now,
      });
    }

    return feedbacks;
  }

  /**
   * Retrieve the feedback history for a single trace, ordered by most-recent
   * first.
   *
   * @param traceId - The memory trace ID to look up.
   * @param limit   - Maximum number of rows to return.  Defaults to 100.
   * @returns Array of `RetrievalFeedback` events, most-recent first.
   */
  getHistory(traceId: string, limit = 100): RetrievalFeedback[] {
    const rows = this.brain.db
      .prepare<[string, number], FeedbackRow>(
        `SELECT id, trace_id, signal, query, created_at
         FROM retrieval_feedback
         WHERE trace_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(traceId, limit);

    return rows.map((row) => ({
      traceId: row.trace_id,
      signal: row.signal as 'used' | 'ignored',
      context: row.query ?? undefined,
      timestamp: row.created_at,
    }));
  }

  /**
   * Return aggregate counts of `'used'` and `'ignored'` signals for a trace.
   *
   * Useful for the consolidation pipeline to decide whether to apply
   * `penalizeUnused` (many ignores) or `updateOnRetrieval` (many used).
   *
   * @param traceId - The memory trace ID to aggregate.
   * @returns `{ used, ignored }` counts.
   */
  getStats(traceId: string): { used: number; ignored: number } {
    const rows = this.brain.db
      .prepare<[string], { signal: string; count: number }>(
        `SELECT signal, COUNT(*) AS count
         FROM retrieval_feedback
         WHERE trace_id = ?
         GROUP BY signal`,
      )
      .all(traceId);

    let used = 0;
    let ignored = 0;

    for (const row of rows) {
      if (row.signal === 'used') used = row.count;
      else if (row.signal === 'ignored') ignored = row.count;
    }

    return { used, ignored };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
  private _extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length > 4);

    // Return deduplicated list using a Set for uniqueness.
    return [...new Set(words)];
  }
}

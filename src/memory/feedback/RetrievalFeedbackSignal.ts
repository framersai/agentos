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

import type { MemoryTrace } from '../types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';
import { penalizeUnused, updateOnRetrieval } from '../decay/DecayModel.js';
import {
  parseTraceMetadata,
  readPersistedDecayState,
  withPersistedDecayState,
} from '../store/tracePersistence.js';

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

/** Raw row shape returned by SQLite queries on `memory_traces`. */
interface TraceRow {
  id: string;
  type: string;
  scope: string;
  content: string;
  strength: number;
  created_at: number;
  last_accessed: number | null;
  retrieval_count: number;
  tags: string;
  emotions: string;
  metadata: string;
  deleted: number;
}

// ---------------------------------------------------------------------------
// RetrievalFeedbackSignal
// ---------------------------------------------------------------------------

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
   * @returns Array of `RetrievalFeedback` events, one per injected trace.
   */
  async detect(
    injectedTraces: MemoryTrace[],
    response: string,
  ): Promise<RetrievalFeedback[]> {
    const responseLower = response.toLowerCase();
    const feedbacks: RetrievalFeedback[] = [];
    const now = Date.now();

    const insertSql =
      `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at)
       VALUES (?, ?, ?, ?)`;
    const selectTraceSql =
      `SELECT id, type, scope, content, strength, created_at, last_accessed,
              retrieval_count, tags, emotions, metadata, deleted
       FROM memory_traces
       WHERE id = ?
       LIMIT 1`;
    const usedUpdateSql =
      `UPDATE memory_traces
       SET strength = ?, last_accessed = ?, retrieval_count = ?, metadata = ?
       WHERE id = ?`;
    const ignoredUpdateSql =
      `UPDATE memory_traces
       SET strength = ?, last_accessed = ?, metadata = ?
       WHERE id = ?`;

    await this.brain.transaction(async (trx) => {
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

        await trx.run(insertSql, [trace.id, signal, null, now]);

        const row = await trx.get<TraceRow>(selectTraceSql, [trace.id]);
        if (row) {
          const persistedTrace = this._buildTrace(row);
          if (signal === 'used') {
            const update = updateOnRetrieval(persistedTrace, now);
            const metadata = JSON.stringify(
              withPersistedDecayState(parseTraceMetadata(row.metadata), {
                stability: update.stability,
                accessCount: update.accessCount,
                reinforcementInterval: update.reinforcementInterval,
                nextReinforcementAt: update.nextReinforcementAt,
              }),
            );
            await trx.run(usedUpdateSql, [
              update.encodingStrength,
              update.lastAccessedAt,
              update.retrievalCount,
              metadata,
              trace.id,
            ]);
          } else {
            const penalty = penalizeUnused(persistedTrace, now);
            const existingDecay = readPersistedDecayState(
              parseTraceMetadata(row.metadata),
              row.retrieval_count,
            );
            const metadata = JSON.stringify(
              withPersistedDecayState(parseTraceMetadata(row.metadata), {
                stability: penalty.stability,
                accessCount: existingDecay.accessCount,
                reinforcementInterval: existingDecay.reinforcementInterval,
                ...(existingDecay.nextReinforcementAt !== undefined
                  ? { nextReinforcementAt: existingDecay.nextReinforcementAt }
                  : {}),
              }),
            );
            await trx.run(ignoredUpdateSql, [
              penalty.encodingStrength,
              penalty.lastAccessedAt,
              metadata,
              trace.id,
            ]);
          }
        }

        feedbacks.push({
          traceId: trace.id,
          signal,
          timestamp: now,
        });
      }
    });

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
  async getHistory(traceId: string, limit = 100): Promise<RetrievalFeedback[]> {
    const rows = await this.brain.all<FeedbackRow>(
      `SELECT id, trace_id, signal, query, created_at
       FROM retrieval_feedback
       WHERE trace_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [traceId, limit],
    );

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
  async getStats(traceId: string): Promise<{ used: number; ignored: number }> {
    const rows = await this.brain.all<{ signal: string; count: number }>(
      `SELECT signal, COUNT(*) AS count
       FROM retrieval_feedback
       WHERE trace_id = ?
       GROUP BY signal`,
      [traceId],
    );

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

  /**
   * Convert a raw `memory_traces` row into a minimal `MemoryTrace` envelope
   * suitable for reuse by the decay model.
   */
  private _buildTrace(row: TraceRow): MemoryTrace {
    const metadata = parseTraceMetadata(row.metadata);
    let tags: string[] = [];
    let emotions: Record<string, unknown> = {};

    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        tags = parsed.filter((tag): tag is string => typeof tag === 'string');
      }
    } catch {
      tags = [];
    }

    try {
      emotions = JSON.parse(row.emotions) as Record<string, unknown>;
    } catch {
      emotions = {};
    }

    const scopeId = typeof metadata.scopeId === 'string' ? metadata.scopeId : '';
    const entities = Array.isArray(metadata.entities)
      ? metadata.entities.filter((entity): entity is string => typeof entity === 'string')
      : [];
    const decayState = readPersistedDecayState(metadata, row.retrieval_count);

    return {
      id: row.id,
      type: row.type as MemoryTrace['type'],
      scope: row.scope as MemoryTrace['scope'],
      scopeId,
      content: row.content,
      entities,
      tags,
      provenance: {
        sourceType: 'user_statement',
        sourceTimestamp: row.created_at,
        confidence: 1.0,
        verificationCount: 0,
      },
      emotionalContext: {
        valence: 0,
        arousal: 0,
        dominance: 0,
        intensity: 0,
        gmiMood: 'neutral',
        ...emotions,
      },
      encodingStrength: row.strength,
      stability: decayState.stability,
      retrievalCount: row.retrieval_count,
      lastAccessedAt: row.last_accessed ?? row.created_at,
      accessCount: decayState.accessCount,
      reinforcementInterval: decayState.reinforcementInterval,
      ...(decayState.nextReinforcementAt !== undefined
        ? { nextReinforcementAt: decayState.nextReinforcementAt }
        : {}),
      associatedTraceIds: [],
      createdAt: row.created_at,
      updatedAt: row.created_at,
      isActive: row.deleted === 0,
    };
  }
}

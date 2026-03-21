/**
 * @fileoverview TopicDriftTracker — session-level EMA drift detection for topicality guardrails.
 *
 * This module tracks whether a conversation session is gradually drifting away
 * from its allowed topics by maintaining a per-session **running embedding**
 * that is updated with each new message using an Exponential Moving Average
 * (EMA).
 *
 * ### Why EMA?
 * A simple "last-message" check is too noisy: a single off-topic message in an
 * otherwise on-topic conversation should not trigger a hard block.  EMA
 * smooths the signal so that sustained drift is detected while brief tangents
 * are tolerated.
 *
 * The update formula is:
 * ```
 * running[i] = alpha * message[i] + (1 - alpha) * running[i]
 * ```
 * A smaller `alpha` means the running vector changes slowly (long memory);
 * a larger `alpha` means it reacts quickly to each new message.
 *
 * ### Drift decision
 * After each EMA update the tracker checks whether the running embedding is
 * "on-topic" by calling {@link TopicEmbeddingIndex.isOnTopicByVector}.  If the
 * check fails the `driftStreak` counter is incremented; if it passes the
 * streak resets to zero.  When `driftStreak >= driftStreakLimit` the result
 * `driftLimitExceeded` is set to `true`.
 *
 * ### Session management
 * Sessions are stored in an in-memory `Map<sessionId, TopicState>`.  To
 * prevent unbounded memory growth:
 * - Stale sessions (inactive for > `sessionTimeoutMs`) are pruned lazily
 *   whenever `map.size > maxSessions` at the start of an `update()` call.
 * - Callers can force a full clear via {@link clear}.
 *
 * @module topicality/TopicDriftTracker
 */

import type { TopicEmbeddingIndex } from './TopicEmbeddingIndex';
import {
  DEFAULT_DRIFT_CONFIG,
  type DriftConfig,
  type DriftResult,
  type TopicMatch,
  type TopicState,
} from './types';

// ---------------------------------------------------------------------------
// TopicDriftTracker
// ---------------------------------------------------------------------------

/**
 * Tracks per-session topic drift using EMA-blended running embeddings.
 *
 * Instantiate once per agent process (not per conversation) since the tracker
 * manages many concurrent sessions internally.
 *
 * @example
 * ```ts
 * const tracker = new TopicDriftTracker({ alpha: 0.4, driftStreakLimit: 2 });
 *
 * // In your message handler:
 * const embedding = await embed(userMessage);
 * const result = tracker.update('session-abc', embedding, allowedIndex);
 *
 * if (result.driftLimitExceeded) {
 *   // Take configured action: redirect, warn, or block.
 * }
 * ```
 */
export class TopicDriftTracker {
  /** Fully resolved drift configuration (defaults merged with caller overrides). */
  private readonly config: DriftConfig;

  /**
   * In-memory session store.
   * Key: caller-supplied session ID (e.g. conversation UUID).
   * Value: mutable {@link TopicState} for that session.
   */
  private readonly sessions: Map<string, TopicState> = new Map();

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a new `TopicDriftTracker`.
   *
   * @param config - Optional partial override of {@link DEFAULT_DRIFT_CONFIG}.
   *   Any fields not provided fall back to their default values.  Pass an
   *   empty object `{}` or omit entirely to use all defaults.
   *
   * @example
   * ```ts
   * // Use defaults
   * const tracker = new TopicDriftTracker();
   *
   * // Override only alpha and streakLimit
   * const strictTracker = new TopicDriftTracker({ alpha: 0.5, driftStreakLimit: 2 });
   * ```
   */
  constructor(config?: Partial<DriftConfig>) {
    // Merge caller overrides with defaults — undefined fields are taken from
    // DEFAULT_DRIFT_CONFIG, preserving all caller-supplied values exactly.
    this.config = { ...DEFAULT_DRIFT_CONFIG, ...(config ?? {}) };
  }

  // -------------------------------------------------------------------------
  // Public API — update
  // -------------------------------------------------------------------------

  /**
   * Processes a new message embedding for the given session and returns the
   * current drift assessment.
   *
   * ### Steps performed
   * 1. **Retrieve or create** the session state.  On the very first message
   *    the running embedding is initialised to a shallow copy of
   *    `messageEmbedding` (no EMA applied yet).
   * 2. **Apply EMA** (from the second message onwards):
   *    `running[i] = alpha * message[i] + (1 - alpha) * running[i]`
   * 3. **Check topic alignment** using
   *    `allowedIndex.isOnTopicByVector(running, driftThreshold)`.
   * 4. **Update streak** — increment `driftStreak` on off-topic, reset to 0
   *    on on-topic.
   * 5. **Lazy-prune** stale sessions when `map.size > maxSessions` before
   *    creating a new session (never during updates of existing sessions to
   *    avoid deleting the session we are currently updating).
   * 6. **Persist** the updated state and return a {@link DriftResult}.
   *
   * @param sessionId        - Unique identifier for the conversation session.
   *   Typically a UUID or user ID. Must be consistent across messages in the
   *   same conversation.
   * @param messageEmbedding - Pre-computed numeric embedding of the current
   *   message.  Must have the same dimensionality as the topic centroids used
   *   by `allowedIndex`.
   * @param allowedIndex     - Built {@link TopicEmbeddingIndex} containing the
   *   allowed topics to check against.  The tracker calls only
   *   `isOnTopicByVector` (no async operations, no extra embedding calls).
   * @returns A {@link DriftResult} describing whether the session is currently
   *   drifting and by how much.
   */
  update(
    sessionId: string,
    messageEmbedding: number[],
    allowedIndex: TopicEmbeddingIndex,
  ): DriftResult {
    const now = Date.now();
    const isNewSession = !this.sessions.has(sessionId);

    // Lazy prune: only trigger when a NEW session would push us over the limit.
    // We do not prune during updates of existing sessions to avoid accidentally
    // deleting a session that is currently being processed.
    if (isNewSession && this.sessions.size >= this.config.maxSessions) {
      this.pruneStale();
    }

    let state: TopicState;

    if (isNewSession) {
      // First message in this session — initialise running embedding to a copy
      // of the current message embedding.  A copy prevents external mutation
      // of the array from silently corrupting the tracker state.
      state = {
        runningEmbedding: [...messageEmbedding],
        messageCount: 0, // will be incremented below
        lastTopicScore: 0,
        driftStreak: 0,
        lastSeenAt: now,
      };
    } else {
      // Retrieve existing state — guaranteed non-null by the `has()` check above.
      state = this.sessions.get(sessionId)!;

      // Apply the EMA update in-place.
      // running[i] = alpha * message[i] + (1 - alpha) * running[i]
      const alpha = this.config.alpha;
      const oneMinusAlpha = 1 - alpha;

      for (let i = 0; i < state.runningEmbedding.length; i++) {
        state.runningEmbedding[i] =
          alpha * messageEmbedding[i] + oneMinusAlpha * state.runningEmbedding[i];
      }
    }

    // Increment message counter and timestamp.
    state.messageCount += 1;
    state.lastSeenAt = now;

    // -----------------------------------------------------------------------
    // Topic alignment check
    // -----------------------------------------------------------------------

    // Check whether the (now-updated) running embedding is on-topic.
    const onTopic = allowedIndex.isOnTopicByVector(
      state.runningEmbedding,
      this.config.driftThreshold,
    );

    // Retrieve the best-match details from the index for the result payload.
    // matchByVector is synchronous and does not re-embed anything.
    const topMatches = allowedIndex.matchByVector(state.runningEmbedding);
    const nearestTopic: TopicMatch | null = topMatches.length > 0 ? topMatches[0] : null;
    const currentSimilarity = nearestTopic?.similarity ?? 0;

    // Store the latest similarity score for observability.
    state.lastTopicScore = currentSimilarity;

    // -----------------------------------------------------------------------
    // Drift streak management
    // -----------------------------------------------------------------------

    if (onTopic) {
      // Good message — reset the drift counter.
      state.driftStreak = 0;
    } else {
      // Off-topic message — accumulate the streak.
      state.driftStreak += 1;
    }

    const driftLimitExceeded = state.driftStreak >= this.config.driftStreakLimit;

    // -----------------------------------------------------------------------
    // Persist state and return result
    // -----------------------------------------------------------------------

    // Always write back (even for existing sessions, since we mutated in-place
    // for the EMA; for new sessions we need to insert).
    this.sessions.set(sessionId, state);

    return {
      onTopic,
      currentSimilarity,
      nearestTopic,
      driftStreak: state.driftStreak,
      driftLimitExceeded,
    };
  }

  // -------------------------------------------------------------------------
  // Public API — pruneStale
  // -------------------------------------------------------------------------

  /**
   * Removes sessions that have been inactive for longer than `sessionTimeoutMs`.
   *
   * This is called lazily inside {@link update} when the session map exceeds
   * `maxSessions`, but callers may invoke it directly to trigger an immediate
   * cleanup (e.g. in a scheduled maintenance job).
   *
   * Pruning is O(n) in the number of active sessions.
   */
  pruneStale(): void {
    const now = Date.now();
    const timeoutMs = this.config.sessionTimeoutMs;

    for (const [id, state] of this.sessions) {
      if (now - state.lastSeenAt > timeoutMs) {
        this.sessions.delete(id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API — clear
  // -------------------------------------------------------------------------

  /**
   * Removes all sessions from the tracker unconditionally.
   *
   * Useful for graceful shutdown, testing teardown, or resetting the agent
   * context between evaluation runs.
   */
  clear(): void {
    this.sessions.clear();
  }

  // -------------------------------------------------------------------------
  // Internal helpers (exposed for testing via package-private pattern)
  // -------------------------------------------------------------------------

  /**
   * Returns the current number of active sessions in the internal map.
   * Useful for observability and testing.
   *
   * @internal
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Returns a copy of the {@link TopicState} for the given session, or
   * `undefined` if the session does not exist.
   *
   * Exposed for unit-testing state inspection.  The returned object is a
   * shallow copy — mutating it does not affect the tracker's internal state.
   *
   * @internal
   */
  getState(sessionId: string): TopicState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    // Shallow copy to prevent callers from accidentally mutating tracker state.
    return { ...state, runningEmbedding: [...state.runningEmbedding] };
  }
}

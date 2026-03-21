/**
 * @fileoverview Unit tests for TopicDriftTracker.
 *
 * All tests use a lightweight mock {@link TopicEmbeddingIndex} whose
 * `isOnTopicByVector` return value can be controlled per-test.  The mock
 * also exposes call-count tracking so tests can verify that matchByVector
 * is called (or not) at the right times.
 *
 * Coverage:
 *  - First message never triggers drift (initialise, no EMA yet)
 *  - EMA updates modify the running embedding correctly
 *  - Off-topic messages increment driftStreak
 *  - On-topic messages reset driftStreak to 0
 *  - driftLimitExceeded fires when streak >= driftStreakLimit
 *  - Multiple independent sessions do not interfere with each other
 *  - pruneStale removes only timed-out sessions
 *  - clear removes all sessions
 *  - maxSessions triggers pruneStale before inserting a new session
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicDriftTracker } from '../../../../src/extensions/packs/topicality/TopicDriftTracker';
import type { TopicEmbeddingIndex } from '../../../../src/extensions/packs/topicality/TopicEmbeddingIndex';
import type { TopicMatch } from '../../../../src/extensions/packs/topicality/types';

// ---------------------------------------------------------------------------
// Mock TopicEmbeddingIndex factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock of {@link TopicEmbeddingIndex} suitable for
 * TopicDriftTracker tests.
 *
 * @param isOnTopic - Determines the return value of `isOnTopicByVector`.
 *   Pass a boolean for a constant answer, or a function for dynamic control.
 * @param topMatch  - Optional top {@link TopicMatch} to return from `matchByVector`.
 *   Defaults to a single synthetic match.
 */
function makeMockIndex(
  isOnTopic: boolean | ((embedding: number[], threshold: number) => boolean),
  topMatch: TopicMatch = { topicId: 'topic-a', topicName: 'Topic A', similarity: 0.8 },
): TopicEmbeddingIndex {
  const isOnTopicFn =
    typeof isOnTopic === 'boolean'
      ? () => isOnTopic
      : isOnTopic;

  return {
    isBuilt: true,
    isOnTopicByVector: vi.fn(isOnTopicFn),
    matchByVector: vi.fn((_embedding: number[]) => [topMatch]),
    // The following methods are never called by TopicDriftTracker; stubs
    // keep TypeScript satisfied.
    build: vi.fn(),
    match: vi.fn(),
    isOnTopic: vi.fn(),
  } as unknown as TopicEmbeddingIndex;
}

// Convenient fixed vectors for tests.
const V_A = [1, 0, 0]; // "on-topic" direction
const V_B = [0, 1, 0]; // "off-topic" direction

// ---------------------------------------------------------------------------
// First message — no drift
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: first message', () => {
  it('does not trigger drift on the very first message regardless of content', () => {
    // Even if the mock says off-topic, the first message cannot trigger a
    // streak because the streak starts at 0 and becomes 1 after one bad message,
    // which is below the default driftStreakLimit of 3.
    const tracker = new TopicDriftTracker();
    const index = makeMockIndex(false); // always off-topic

    const result = tracker.update('session-1', V_B, index);

    // Not on-topic, but streak is only 1 → limit not exceeded.
    expect(result.onTopic).toBe(false);
    expect(result.driftStreak).toBe(1);
    expect(result.driftLimitExceeded).toBe(false);
  });

  it('sets onTopic true and streak 0 when first message is on-topic', () => {
    const tracker = new TopicDriftTracker();
    const index = makeMockIndex(true); // always on-topic

    const result = tracker.update('session-1', V_A, index);

    expect(result.onTopic).toBe(true);
    expect(result.driftStreak).toBe(0);
    expect(result.driftLimitExceeded).toBe(false);
  });

  it('initialises running embedding to a copy of the first message embedding', () => {
    const tracker = new TopicDriftTracker();
    const index = makeMockIndex(true);
    const embedding = [0.5, 0.5, 0.0];

    tracker.update('sess', embedding, index);
    const state = tracker.getState('sess')!;

    // Running embedding should equal the first message embedding.
    expect(state.runningEmbedding).toEqual(embedding);
  });
});

// ---------------------------------------------------------------------------
// EMA update
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: EMA updates', () => {
  it('blends the new message into the running embedding using alpha', () => {
    const tracker = new TopicDriftTracker({ alpha: 0.5 });
    const index = makeMockIndex(true);

    // Message 1: running = [1, 0, 0]
    tracker.update('sess', [1, 0, 0], index);

    // Message 2: running = 0.5 * [0, 1, 0] + 0.5 * [1, 0, 0] = [0.5, 0.5, 0]
    tracker.update('sess', [0, 1, 0], index);
    const state = tracker.getState('sess')!;

    expect(state.runningEmbedding[0]).toBeCloseTo(0.5);
    expect(state.runningEmbedding[1]).toBeCloseTo(0.5);
    expect(state.runningEmbedding[2]).toBeCloseTo(0.0);
  });

  it('applies EMA across multiple messages', () => {
    const alpha = 0.3;
    const tracker = new TopicDriftTracker({ alpha });
    const index = makeMockIndex(true);

    // Seed with [1, 0, 0].
    tracker.update('sess', [1, 0, 0], index);

    // Apply three messages of [0, 1, 0] and verify the running embedding
    // moves toward [0, 1, 0] over time.
    for (let i = 0; i < 3; i++) {
      tracker.update('sess', [0, 1, 0], index);
    }

    const state = tracker.getState('sess')!;
    // Component 0 should have decreased from 1 toward 0.
    // Component 1 should have increased from 0 toward 1.
    expect(state.runningEmbedding[0]).toBeLessThan(1);
    expect(state.runningEmbedding[1]).toBeGreaterThan(0);
  });

  it('does not apply EMA on the first message (running = copy of message)', () => {
    // alpha = 1.0 would make running = message on every update.
    // For the first message the running should equal the message regardless.
    const tracker = new TopicDriftTracker({ alpha: 1.0 });
    const index = makeMockIndex(true);

    tracker.update('sess', [0.3, 0.7, 0.0], index);
    const state = tracker.getState('sess')!;

    expect(state.runningEmbedding).toEqual([0.3, 0.7, 0.0]);
  });
});

// ---------------------------------------------------------------------------
// Drift streak — increment and reset
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: drift streak', () => {
  it('increments driftStreak for each consecutive off-topic message', () => {
    const tracker = new TopicDriftTracker({ driftStreakLimit: 5 });
    const index = makeMockIndex(false); // always off-topic

    for (let expected = 1; expected <= 3; expected++) {
      const result = tracker.update('sess', V_B, index);
      expect(result.driftStreak).toBe(expected);
    }
  });

  it('resets driftStreak to 0 when an on-topic message is received', () => {
    // Accumulate a streak of 2 off-topic messages, then send an on-topic one.
    let callCount = 0;
    const index = makeMockIndex((embedding) => {
      callCount++;
      // First two calls are off-topic, third is on-topic.
      // Note: first message also triggers isOnTopicByVector.
      return callCount >= 3;
    });

    const tracker = new TopicDriftTracker({ driftStreakLimit: 5 });

    const r1 = tracker.update('sess', V_B, index); // off-topic
    const r2 = tracker.update('sess', V_B, index); // off-topic
    const r3 = tracker.update('sess', V_A, index); // on-topic

    expect(r1.driftStreak).toBe(1);
    expect(r2.driftStreak).toBe(2);
    expect(r3.driftStreak).toBe(0);
    expect(r3.onTopic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// driftLimitExceeded
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: driftLimitExceeded', () => {
  it('sets driftLimitExceeded true when streak reaches driftStreakLimit', () => {
    const LIMIT = 3;
    const tracker = new TopicDriftTracker({ driftStreakLimit: LIMIT });
    const index = makeMockIndex(false); // always off-topic

    let result = tracker.update('sess', V_B, index);
    expect(result.driftLimitExceeded).toBe(false); // streak = 1

    result = tracker.update('sess', V_B, index);
    expect(result.driftLimitExceeded).toBe(false); // streak = 2

    result = tracker.update('sess', V_B, index);
    expect(result.driftLimitExceeded).toBe(true);  // streak = 3 >= LIMIT
  });

  it('resets driftLimitExceeded to false once an on-topic message arrives', () => {
    let offTopic = true;
    const index = makeMockIndex(() => !offTopic);
    const tracker = new TopicDriftTracker({ driftStreakLimit: 2 });

    // Trigger the limit.
    tracker.update('sess', V_B, index);
    const exceeded = tracker.update('sess', V_B, index);
    expect(exceeded.driftLimitExceeded).toBe(true);

    // Send an on-topic message.
    offTopic = false;
    const recovered = tracker.update('sess', V_A, index);
    expect(recovered.driftLimitExceeded).toBe(false);
    expect(recovered.driftStreak).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrent sessions
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: concurrent sessions', () => {
  it('tracks sessions independently without cross-contamination', () => {
    const tracker = new TopicDriftTracker({ driftStreakLimit: 5 });

    // Session A always off-topic.
    const indexA = makeMockIndex(false);
    // Session B always on-topic.
    const indexB = makeMockIndex(true);

    tracker.update('sess-a', V_B, indexA);
    tracker.update('sess-a', V_B, indexA);
    tracker.update('sess-b', V_A, indexB);

    const stateA = tracker.getState('sess-a')!;
    const stateB = tracker.getState('sess-b')!;

    expect(stateA.driftStreak).toBe(2);
    expect(stateB.driftStreak).toBe(0);
  });

  it('sessionCount reflects the correct number of active sessions', () => {
    const tracker = new TopicDriftTracker();
    const index = makeMockIndex(true);

    expect(tracker.sessionCount).toBe(0);
    tracker.update('s1', V_A, index);
    expect(tracker.sessionCount).toBe(1);
    tracker.update('s2', V_A, index);
    expect(tracker.sessionCount).toBe(2);
    // Updating an existing session must not create a duplicate.
    tracker.update('s1', V_A, index);
    expect(tracker.sessionCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// pruneStale
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: pruneStale', () => {
  it('removes sessions whose lastSeenAt is older than sessionTimeoutMs', async () => {
    // Use a very short timeout so we can trigger it without real waiting.
    const tracker = new TopicDriftTracker({ sessionTimeoutMs: 1 }); // 1 ms
    const index = makeMockIndex(true);

    tracker.update('old-session', V_A, index);
    expect(tracker.sessionCount).toBe(1);

    // Wait just long enough for the timeout to elapse.
    await new Promise((resolve) => setTimeout(resolve, 5));

    tracker.pruneStale();
    expect(tracker.sessionCount).toBe(0);
  });

  it('does not remove sessions that are still within the timeout window', () => {
    const tracker = new TopicDriftTracker({ sessionTimeoutMs: 60_000 }); // 1 min
    const index = makeMockIndex(true);

    tracker.update('active', V_A, index);
    tracker.pruneStale();

    // Session is fresh — should not be pruned.
    expect(tracker.sessionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: clear', () => {
  it('removes all sessions unconditionally', () => {
    const tracker = new TopicDriftTracker();
    const index = makeMockIndex(true);

    tracker.update('s1', V_A, index);
    tracker.update('s2', V_A, index);
    tracker.update('s3', V_A, index);
    expect(tracker.sessionCount).toBe(3);

    tracker.clear();
    expect(tracker.sessionCount).toBe(0);
  });

  it('getState returns undefined after clear', () => {
    const tracker = new TopicDriftTracker();
    const index = makeMockIndex(true);

    tracker.update('s1', V_A, index);
    tracker.clear();

    expect(tracker.getState('s1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maxSessions — triggers pruneStale on new session insertion
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: maxSessions', () => {
  it('triggers pruneStale when a new session would exceed maxSessions', async () => {
    // Allow only 2 sessions; use a short timeout so old ones get pruned.
    const tracker = new TopicDriftTracker({
      maxSessions: 2,
      sessionTimeoutMs: 1, // 1 ms — stale very quickly
    });
    const index = makeMockIndex(true);

    // Fill up to capacity.
    tracker.update('s1', V_A, index);
    tracker.update('s2', V_A, index);
    expect(tracker.sessionCount).toBe(2);

    // Wait for both sessions to become stale.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Adding a third session should trigger pruneStale first, clearing the
    // two stale sessions, so the count stays at 1 (just the new one).
    tracker.update('s3', V_A, index);
    expect(tracker.sessionCount).toBe(1);
  });

  it('does not prune when updating an existing session at capacity', async () => {
    // Two sessions at capacity; make them stale.
    const tracker = new TopicDriftTracker({
      maxSessions: 2,
      sessionTimeoutMs: 1,
    });
    const index = makeMockIndex(true);

    tracker.update('s1', V_A, index);
    tracker.update('s2', V_A, index);

    // Wait for stale timeout.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Updating an *existing* session must not trigger pruneStale.
    // Both sessions should remain (they were there before the timeout check).
    tracker.update('s1', V_A, index);

    // s1 and s2 both present — update to s1 did not prune s2.
    expect(tracker.sessionCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// nearestTopic in DriftResult
// ---------------------------------------------------------------------------

describe('TopicDriftTracker: DriftResult.nearestTopic', () => {
  it('includes the top match from matchByVector in the result', () => {
    const topMatch: TopicMatch = { topicId: 'billing', topicName: 'Billing', similarity: 0.75 };
    const index = makeMockIndex(true, topMatch);
    const tracker = new TopicDriftTracker();

    const result = tracker.update('sess', V_A, index);

    expect(result.nearestTopic).toEqual(topMatch);
    expect(result.currentSimilarity).toBe(0.75);
  });

  it('returns null nearestTopic when index returns no matches', () => {
    // Override matchByVector to return empty array.
    const index = {
      isBuilt: true,
      isOnTopicByVector: vi.fn(() => false),
      matchByVector: vi.fn(() => []),
      build: vi.fn(),
      match: vi.fn(),
      isOnTopic: vi.fn(),
    } as unknown as TopicEmbeddingIndex;

    const tracker = new TopicDriftTracker();
    const result = tracker.update('sess', V_B, index);

    expect(result.nearestTopic).toBeNull();
    expect(result.currentSimilarity).toBe(0);
  });
});

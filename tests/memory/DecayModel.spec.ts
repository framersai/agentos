/**
 * @fileoverview Unit tests for the Ebbinghaus decay model.
 * Tests forgetting curve, spaced repetition, interference, and pruning.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCurrentStrength,
  updateOnRetrieval,
  computeInterference,
  findPrunableTraces,
} from '../../src/memory/core/decay/DecayModel';
import type { MemoryTrace } from '../../src/memory/core/types';
import { DEFAULT_DECAY_CONFIG } from '../../src/memory/core/config';

// ---------------------------------------------------------------------------
// Test helper: create a minimal MemoryTrace
// ---------------------------------------------------------------------------

function makeTrace(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  return {
    id: 'test-trace-1',
    type: 'episodic',
    scope: 'user',
    scopeId: 'agent-1',
    content: 'test memory content',
    entities: [],
    tags: [],
    provenance: { sourceType: 'user_statement', sourceTimestamp: Date.now(), confidence: 0.8, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0.5, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.8,
    stability: 3_600_000, // 1 hour
    retrievalCount: 0,
    lastAccessedAt: Date.now(),
    accessCount: 0,
    reinforcementInterval: 3_600_000,
    associatedTraceIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
    ...overrides,
  };
}

describe('DecayModel', () => {
  describe('computeCurrentStrength', () => {
    it('returns full encoding strength when no time has elapsed', () => {
      const now = Date.now();
      const trace = makeTrace({ lastAccessedAt: now, encodingStrength: 0.9 });
      expect(computeCurrentStrength(trace, now)).toBeCloseTo(0.9);
    });

    it('decays over time according to Ebbinghaus curve', () => {
      const base = Date.now();
      const trace = makeTrace({
        lastAccessedAt: base,
        encodingStrength: 1.0,
        stability: 3_600_000,
      });

      const after1Hour = computeCurrentStrength(trace, base + 3_600_000);
      // S(t) = 1.0 * e^(-1) ≈ 0.368
      expect(after1Hour).toBeCloseTo(Math.exp(-1), 2);
    });

    it('decays faster with lower stability', () => {
      const base = Date.now();
      const stableTrace = makeTrace({ lastAccessedAt: base, stability: 7_200_000 });
      const unstableTrace = makeTrace({ lastAccessedAt: base, stability: 1_800_000 });

      const elapsed = 3_600_000; // 1 hour
      expect(computeCurrentStrength(unstableTrace, base + elapsed))
        .toBeLessThan(computeCurrentStrength(stableTrace, base + elapsed));
    });

    it('approaches zero as time → ∞', () => {
      const trace = makeTrace({ lastAccessedAt: 0 });
      const farFuture = Date.now() + 365 * 24 * 3_600_000; // 1 year
      expect(computeCurrentStrength(trace, farFuture)).toBeLessThan(0.001);
    });

    it('handles negative elapsed time gracefully (clamps to 0)', () => {
      const now = Date.now();
      const trace = makeTrace({ lastAccessedAt: now + 1000, encodingStrength: 0.8 });
      expect(computeCurrentStrength(trace, now)).toBeCloseTo(0.8);
    });
  });

  describe('updateOnRetrieval', () => {
    it('increases encoding strength by 0.1', () => {
      const trace = makeTrace({ encodingStrength: 0.5, retrievalCount: 0 });
      const result = updateOnRetrieval(trace, Date.now());
      expect(result.encodingStrength).toBeCloseTo(0.6);
    });

    it('caps encoding strength at 1.0', () => {
      const trace = makeTrace({ encodingStrength: 0.95 });
      const result = updateOnRetrieval(trace, Date.now());
      expect(result.encodingStrength).toBeLessThanOrEqual(1.0);
    });

    it('increases stability (memory becomes more durable)', () => {
      const trace = makeTrace({ stability: 3_600_000 });
      const result = updateOnRetrieval(trace, Date.now());
      expect(result.stability).toBeGreaterThan(trace.stability);
    });

    it('desirable difficulty: weaker traces get larger stability boost', () => {
      const now = Date.now();
      // Strong trace (recently accessed)
      const strongTrace = makeTrace({ lastAccessedAt: now, encodingStrength: 0.9 });
      // Weak trace (accessed long ago → low current strength)
      const weakTrace = makeTrace({ lastAccessedAt: now - 7_200_000, encodingStrength: 0.9 });

      const strongResult = updateOnRetrieval(strongTrace, now);
      const weakResult = updateOnRetrieval(weakTrace, now);

      const strongGrowth = strongResult.stability / strongTrace.stability;
      const weakGrowth = weakResult.stability / weakTrace.stability;
      expect(weakGrowth).toBeGreaterThan(strongGrowth);
    });

    it('doubles reinforcement interval (spaced repetition)', () => {
      const trace = makeTrace({ reinforcementInterval: 3_600_000 });
      const result = updateOnRetrieval(trace, Date.now());
      expect(result.reinforcementInterval).toBe(7_200_000);
    });

    it('sets nextReinforcementAt correctly', () => {
      const now = Date.now();
      const trace = makeTrace({ reinforcementInterval: 3_600_000 });
      const result = updateOnRetrieval(trace, now);
      expect(result.nextReinforcementAt).toBe(now + result.reinforcementInterval);
    });

    it('increments retrieval and access counts', () => {
      const trace = makeTrace({ retrievalCount: 3, accessCount: 5 });
      const result = updateOnRetrieval(trace, Date.now());
      expect(result.retrievalCount).toBe(4);
      expect(result.accessCount).toBe(6);
    });

    it('has diminishing returns on repeated retrievals', () => {
      const now = Date.now();
      const fresh = makeTrace({ retrievalCount: 0 });
      const retrieved = makeTrace({ retrievalCount: 10 });

      const freshGrowth = updateOnRetrieval(fresh, now).stability / fresh.stability;
      const retrievedGrowth = updateOnRetrieval(retrieved, now).stability / retrieved.stability;
      expect(freshGrowth).toBeGreaterThan(retrievedGrowth);
    });
  });

  describe('computeInterference', () => {
    it('returns empty results when no similarities exceed threshold', () => {
      const result = computeInterference([
        { traceId: 't1', similarity: 0.5, currentStrength: 0.8 },
        { traceId: 't2', similarity: 0.3, currentStrength: 0.6 },
      ]);
      expect(result.retroactiveVictims).toHaveLength(0);
      expect(result.proactiveReduction).toBe(0);
    });

    it('creates retroactive victims for high-similarity traces', () => {
      const result = computeInterference([
        { traceId: 't1', similarity: 0.9, currentStrength: 0.8 },
      ]);
      expect(result.retroactiveVictims).toHaveLength(1);
      expect(result.retroactiveVictims[0].traceId).toBe('t1');
      expect(result.retroactiveVictims[0].strengthReduction).toBeGreaterThan(0);
    });

    it('applies proactive interference (reduces new trace strength)', () => {
      const result = computeInterference([
        { traceId: 't1', similarity: 0.85, currentStrength: 0.9 },
      ]);
      expect(result.proactiveReduction).toBeGreaterThan(0);
    });

    it('caps proactive reduction at 0.3', () => {
      const result = computeInterference([
        { traceId: 't1', similarity: 0.99, currentStrength: 1.0 },
        { traceId: 't2', similarity: 0.99, currentStrength: 1.0 },
        { traceId: 't3', similarity: 0.99, currentStrength: 1.0 },
        { traceId: 't4', similarity: 0.99, currentStrength: 1.0 },
      ]);
      expect(result.proactiveReduction).toBeLessThanOrEqual(0.3);
    });

    it('respects custom interference threshold', () => {
      const config = { ...DEFAULT_DECAY_CONFIG, interferenceThreshold: 0.9 };
      const result = computeInterference(
        [{ traceId: 't1', similarity: 0.85, currentStrength: 0.8 }],
        config,
      );
      expect(result.retroactiveVictims).toHaveLength(0);
    });
  });

  describe('findPrunableTraces', () => {
    it('identifies traces below pruning threshold', () => {
      const now = Date.now();
      const weakTrace = makeTrace({
        id: 'weak',
        encodingStrength: 0.01,
        stability: 1000,
        lastAccessedAt: now - 100_000,
        emotionalContext: { valence: 0, arousal: 0.1, dominance: 0, intensity: 0.1, gmiMood: '' },
      });

      const prunable = findPrunableTraces([weakTrace], now);
      expect(prunable).toContain('weak');
    });

    it('preserves strong traces', () => {
      const now = Date.now();
      const strongTrace = makeTrace({
        id: 'strong',
        encodingStrength: 0.9,
        lastAccessedAt: now,
      });

      const prunable = findPrunableTraces([strongTrace], now);
      expect(prunable).not.toContain('strong');
    });

    it('preserves emotionally significant traces even when weak', () => {
      const now = Date.now();
      const emotionalTrace = makeTrace({
        id: 'emotional',
        encodingStrength: 0.01,
        stability: 1000,
        lastAccessedAt: now - 100_000,
        emotionalContext: { valence: 0.9, arousal: 0.8, dominance: 0, intensity: 0.5, gmiMood: '' },
      });

      const prunable = findPrunableTraces([emotionalTrace], now);
      expect(prunable).not.toContain('emotional');
    });

    it('skips already inactive traces', () => {
      const now = Date.now();
      const inactive = makeTrace({ id: 'inactive', isActive: false, encodingStrength: 0.01 });
      const prunable = findPrunableTraces([inactive], now);
      expect(prunable).not.toContain('inactive');
    });
  });
});

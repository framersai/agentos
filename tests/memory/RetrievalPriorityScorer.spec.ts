/**
 * @fileoverview Unit tests for the retrieval priority scorer.
 * Tests composite scoring, recency boost, emotional congruence,
 * and tip-of-the-tongue (partially retrieved) detection.
 */

import { describe, it, expect } from 'vitest';
import {
  computeRecencyBoost,
  computeEmotionalCongruence,
  scoreAndRankTraces,
  detectPartiallyRetrieved,
  DEFAULT_SCORING_WEIGHTS,
} from '../../src/memory/core/decay/RetrievalPriorityScorer';
import type { MemoryTrace } from '../../src/memory/core/types';
import type { PADState } from '../../src/memory/core/config';

function makeTrace(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  return {
    id: 'trace-1',
    type: 'episodic',
    scope: 'user',
    scopeId: 'agent-1',
    content: 'test content',
    entities: [],
    tags: ['tag1'],
    provenance: { sourceType: 'user_statement', sourceTimestamp: Date.now(), confidence: 0.8, verificationCount: 0 },
    emotionalContext: { valence: 0.2, arousal: 0.5, dominance: 0, intensity: 0.1, gmiMood: '' },
    encodingStrength: 0.7,
    stability: 3_600_000,
    retrievalCount: 2,
    lastAccessedAt: Date.now(),
    accessCount: 5,
    reinforcementInterval: 3_600_000,
    associatedTraceIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
    ...overrides,
  };
}

describe('RetrievalPriorityScorer', () => {
  describe('computeRecencyBoost', () => {
    it('gives maximum boost for very recent access', () => {
      const now = Date.now();
      const boost = computeRecencyBoost(now, now);
      // boost = 1 + 0.2 * e^0 = 1.2
      expect(boost).toBeCloseTo(1.2);
    });

    it('decays the boost over time', () => {
      const now = Date.now();
      const recentBoost = computeRecencyBoost(now - 1000, now);
      const oldBoost = computeRecencyBoost(now - 86_400_000, now); // 24h ago
      expect(recentBoost).toBeGreaterThan(oldBoost);
    });

    it('approaches 1.0 for very old memories', () => {
      const now = Date.now();
      const boost = computeRecencyBoost(now - 86_400_000 * 30, now); // 30 days
      expect(boost).toBeCloseTo(1.0, 1);
    });
  });

  describe('computeEmotionalCongruence', () => {
    it('boosts when mood and trace have same positive valence', () => {
      const mood: PADState = { valence: 0.8, arousal: 0, dominance: 0 };
      const congruence = computeEmotionalCongruence(mood, 0.6);
      expect(congruence).toBeGreaterThan(1.0);
    });

    it('boosts when mood and trace are both negative', () => {
      const mood: PADState = { valence: -0.5, arousal: 0, dominance: 0 };
      const congruence = computeEmotionalCongruence(mood, -0.7);
      expect(congruence).toBeGreaterThan(1.0);
    });

    it('no boost when mood and trace are incongruent', () => {
      const mood: PADState = { valence: 0.8, arousal: 0, dominance: 0 };
      const congruence = computeEmotionalCongruence(mood, -0.5);
      expect(congruence).toBeCloseTo(1.0);
    });
  });

  describe('scoreAndRankTraces', () => {
    it('returns scored traces sorted by composite score', () => {
      const now = Date.now();
      const mood: PADState = { valence: 0, arousal: 0, dominance: 0 };

      const candidates = [
        { trace: makeTrace({ id: 'weak', encodingStrength: 0.1 }), vectorSimilarity: 0.3 },
        { trace: makeTrace({ id: 'strong', encodingStrength: 0.9 }), vectorSimilarity: 0.9 },
      ];

      const scored = scoreAndRankTraces(candidates, { currentMood: mood, now });
      expect(scored[0].id).toBe('strong');
      expect(scored[1].id).toBe('weak');
    });

    it('includes scoreBreakdown for each trace', () => {
      const now = Date.now();
      const scored = scoreAndRankTraces(
        [{ trace: makeTrace(), vectorSimilarity: 0.8 }],
        { currentMood: { valence: 0, arousal: 0, dominance: 0 }, now },
      );

      expect(scored[0].scoreBreakdown).toHaveProperty('strengthScore');
      expect(scored[0].scoreBreakdown).toHaveProperty('similarityScore');
      expect(scored[0].scoreBreakdown).toHaveProperty('recencyScore');
      expect(scored[0].scoreBreakdown).toHaveProperty('emotionalCongruenceScore');
      expect(scored[0].scoreBreakdown).toHaveProperty('graphActivationScore');
      expect(scored[0].scoreBreakdown).toHaveProperty('importanceScore');
    });

    it('similarity has the highest weight (0.35) in default config', () => {
      expect(DEFAULT_SCORING_WEIGHTS.similarity).toBe(0.35);
      expect(DEFAULT_SCORING_WEIGHTS.similarity).toBeGreaterThan(DEFAULT_SCORING_WEIGHTS.strength);
    });

    it('clamps composite score to [0, 1]', () => {
      const now = Date.now();
      const scored = scoreAndRankTraces(
        [{ trace: makeTrace({ encodingStrength: 1.0 }), vectorSimilarity: 1.0, graphActivation: 1.0 }],
        { currentMood: { valence: 1, arousal: 0, dominance: 0 }, now },
      );
      expect(scored[0].retrievalScore).toBeLessThanOrEqual(1.0);
      expect(scored[0].retrievalScore).toBeGreaterThanOrEqual(0);
    });

    it('disables emotional congruence when neutralMood is true', () => {
      const now = Date.now();
      const mood: PADState = { valence: 0.9, arousal: 0, dominance: 0 };
      const trace = makeTrace({ emotionalContext: { valence: 0.9, arousal: 0.5, dominance: 0, intensity: 0.45, gmiMood: '' } });

      const withMood = scoreAndRankTraces(
        [{ trace, vectorSimilarity: 0.5 }],
        { currentMood: mood, now },
      );
      const withNeutral = scoreAndRankTraces(
        [{ trace, vectorSimilarity: 0.5 }],
        { currentMood: mood, now, neutralMood: true },
      );

      // With emotional congruence active, emotional score component should differ
      expect(withMood[0].scoreBreakdown.emotionalCongruenceScore)
        .not.toBeCloseTo(withNeutral[0].scoreBreakdown.emotionalCongruenceScore);
    });
  });

  describe('detectPartiallyRetrieved', () => {
    it('detects high-similarity but low-strength traces', () => {
      const now = Date.now();
      const candidates = [
        {
          trace: makeTrace({
            id: 'tip-of-tongue',
            encodingStrength: 0.01,
            stability: 1000,
            lastAccessedAt: now - 100_000,
          }),
          vectorSimilarity: 0.8,
        },
      ];

      const partial = detectPartiallyRetrieved(candidates, now);
      expect(partial).toHaveLength(1);
      expect(partial[0].traceId).toBe('tip-of-tongue');
    });

    it('detects high-similarity but low-confidence traces', () => {
      const now = Date.now();
      const candidates = [
        {
          trace: makeTrace({
            id: 'uncertain',
            provenance: { sourceType: 'agent_inference', sourceTimestamp: now, confidence: 0.2, verificationCount: 0 },
          }),
          vectorSimilarity: 0.75,
        },
      ];

      const partial = detectPartiallyRetrieved(candidates, now);
      expect(partial).toHaveLength(1);
    });

    it('does not flag strong, confident traces', () => {
      const now = Date.now();
      const candidates = [
        { trace: makeTrace({ encodingStrength: 0.9, lastAccessedAt: now }), vectorSimilarity: 0.9 },
      ];

      const partial = detectPartiallyRetrieved(candidates, now);
      expect(partial).toHaveLength(0);
    });

    it('provides suggested cues from tags', () => {
      const now = Date.now();
      const candidates = [
        {
          trace: makeTrace({
            encodingStrength: 0.01,
            stability: 1000,
            lastAccessedAt: now - 100_000,
            tags: ['cooking', 'recipe', 'Italian'],
          }),
          vectorSimilarity: 0.8,
        },
      ];

      const partial = detectPartiallyRetrieved(candidates, now);
      expect(partial[0].suggestedCues).toEqual(['cooking', 'recipe', 'Italian']);
    });
  });
});

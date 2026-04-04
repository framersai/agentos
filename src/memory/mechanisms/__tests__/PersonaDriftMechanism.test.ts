import { describe, it, expect } from 'vitest';
import {
  analyzePersonaDrift,
  DEFAULT_PERSONA_DRIFT_CONFIG,
  type PersonaDriftConfig,
  type RelationshipDriftInput,
} from '../PersonaDriftMechanism';
import type { MemoryTrace } from '../../core/types';
import type { HexacoTraits } from '../../core/config';

/** Factory for a minimal MemoryTrace with emotional context. */
function makeTrace(overrides: {
  valence?: number;
  arousal?: number;
  dominance?: number;
  content?: string;
}): MemoryTrace {
  return {
    id: `trace-${Math.random().toString(36).slice(2, 8)}`,
    type: 'episodic',
    scope: 'user',
    scopeId: 'test-user',
    content: overrides.content ?? 'test trace',
    entities: [],
    tags: [],
    provenance: {
      sourceType: 'observation',
      sourceTimestamp: Date.now(),
      confidence: 0.8,
      verificationCount: 0,
    },
    emotionalContext: {
      valence: overrides.valence ?? 0,
      arousal: overrides.arousal ?? 0.5,
      dominance: overrides.dominance ?? 0,
      intensity: Math.abs(overrides.valence ?? 0) * (overrides.arousal ?? 0.5),
      gmiMood: 'neutral',
    },
    encodingStrength: 0.8,
    stability: 1000,
    retrievalCount: 0,
    lastAccessedAt: Date.now(),
    accessCount: 0,
    reinforcementInterval: 86400000,
    associatedTraceIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
  };
}

const BALANCED_TRAITS: HexacoTraits = {
  honesty: 0.5,
  emotionality: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  conscientiousness: 0.5,
  openness: 0.5,
};

const config: PersonaDriftConfig = {
  ...DEFAULT_PERSONA_DRIFT_CONFIG,
  enabled: true,
  minTracesForAnalysis: 5,
};

describe('analyzePersonaDrift', () => {
  it('returns empty array when fewer traces than minimum', () => {
    const traces = [makeTrace({ valence: -0.5, arousal: 0.6 })];
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, config);
    expect(result).toEqual([]);
  });

  it('returns empty array when config is disabled', () => {
    const traces = Array.from({ length: 10 }, () =>
      makeTrace({ valence: -0.8, arousal: 0.7 })
    );
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, {
      ...config,
      enabled: false,
    });
    expect(result).toEqual([]);
  });

  it('proposes agreeableness decrease for high-conflict traces', () => {
    const traces = Array.from({ length: 15 }, () =>
      makeTrace({ valence: -0.6, arousal: 0.7 })
    );
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, config);
    const agreeableness = result.find((p) => p.trait === 'agreeableness');
    expect(agreeableness).toBeDefined();
    expect(agreeableness!.delta).toBeLessThan(0);
  });

  it('proposes extraversion increase for high-positive-arousal traces', () => {
    const traces = Array.from({ length: 15 }, () =>
      makeTrace({ valence: 0.6, arousal: 0.6 })
    );
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, config);
    const extraversion = result.find((p) => p.trait === 'extraversion');
    expect(extraversion).toBeDefined();
    expect(extraversion!.delta).toBeGreaterThan(0);
  });

  it('respects maxDeltaPerCycle cap', () => {
    const traces = Array.from({ length: 50 }, () =>
      makeTrace({ valence: -0.9, arousal: 0.9 })
    );
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, {
      ...config,
      maxDeltaPerCycle: 0.03,
    });
    for (const proposal of result) {
      expect(Math.abs(proposal.delta)).toBeLessThanOrEqual(0.03);
    }
  });

  it('returns at most 2 proposals per cycle', () => {
    const traces = Array.from({ length: 50 }, () =>
      makeTrace({ valence: -0.5, arousal: 0.8 })
    );
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, config);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('incorporates relationship deltas into proposals', () => {
    const traces = Array.from({ length: 10 }, () =>
      makeTrace({ valence: 0, arousal: 0.3 })
    );
    const relDeltas: RelationshipDriftInput = {
      trustDelta: -30,
      affectionDelta: 0,
      tensionDelta: 20,
      respectDelta: 0,
    };
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, config, relDeltas);
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not drift traits below 0 or above 1', () => {
    const lowTraits: HexacoTraits = {
      honesty: 0.02,
      emotionality: 0.02,
      extraversion: 0.02,
      agreeableness: 0.02,
      conscientiousness: 0.02,
      openness: 0.02,
    };
    const traces = Array.from({ length: 15 }, () =>
      makeTrace({ valence: -0.8, arousal: 0.8 })
    );
    const result = analyzePersonaDrift(traces, lowTraits, config);
    for (const p of result) {
      const newVal = (lowTraits[p.trait] ?? 0.5) + p.delta;
      expect(newVal).toBeGreaterThanOrEqual(0);
      expect(newVal).toBeLessThanOrEqual(1);
    }
  });

  it('includes reasoning string on every proposal', () => {
    const traces = Array.from({ length: 15 }, () =>
      makeTrace({ valence: -0.6, arousal: 0.7 })
    );
    const result = analyzePersonaDrift(traces, BALANCED_TRAITS, config);
    for (const p of result) {
      expect(p.reasoning).toBeTruthy();
      expect(typeof p.reasoning).toBe('string');
    }
  });
});

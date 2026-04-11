/**
 * @fileoverview Tests for retrieval-time cognitive mechanisms.
 * @module memory/mechanisms/__tests__/retrieval.test
 */

import { describe, it, expect } from 'vitest';
import { applyReconsolidation } from '../retrieval/Reconsolidation.js';
import { applyRetrievalInducedForgetting } from '../retrieval/RetrievalInducedForgetting.js';
import { selectInvoluntaryMemory } from '../retrieval/InvoluntaryRecall.js';
import { detectFeelingOfKnowing } from '../retrieval/MetacognitiveFOK.js';
import { DEFAULT_MECHANISMS_CONFIG } from '../defaults.js';
import type { MemoryTrace, ScoredMemoryTrace } from '../../core/types.js';
import type { PADState } from '../../core/config.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTrace(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  return {
    id: `mt_${Math.random().toString(36).slice(2)}`,
    type: 'episodic',
    scope: 'user',
    scopeId: 'u1',
    content: 'test memory content',
    entities: [],
    tags: [],
    provenance: {
      sourceType: 'user_statement',
      confidence: 0.8,
      verificationCount: 0,
      sourceTimestamp: Date.now(),
    },
    emotionalContext: {
      valence: -0.3,
      arousal: 0.5,
      dominance: 0.0,
      intensity: 0.15,
      gmiMood: 'NEUTRAL',
    },
    encodingStrength: 0.6,
    stability: 3_600_000,
    retrievalCount: 2,
    lastAccessedAt: Date.now() - 86_400_000,
    accessCount: 3,
    reinforcementInterval: 3_600_000,
    updatedAt: Date.now(),
    createdAt: Date.now() - 7 * 86_400_000,
    isActive: true,
    ...overrides,
  } as MemoryTrace;
}

const happyMood: PADState = { valence: 0.7, arousal: 0.3, dominance: 0.2 };

// ---------------------------------------------------------------------------
// Reconsolidation
// ---------------------------------------------------------------------------

describe('applyReconsolidation', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.reconsolidation;

  it('drifts emotional valence toward current mood', () => {
    const trace = makeTrace({
      emotionalContext: { valence: -0.5, arousal: 0.4, dominance: 0.0, intensity: 0.2, gmiMood: 'NEUTRAL' },
    });
    const before = trace.emotionalContext.valence;
    applyReconsolidation(trace, happyMood, cfg);
    expect(trace.emotionalContext.valence).toBeGreaterThan(before);
  });

  it('drifts arousal toward current mood', () => {
    const trace = makeTrace({
      emotionalContext: { valence: 0.0, arousal: 0.8, dominance: 0.0, intensity: 0.0, gmiMood: 'NEUTRAL' },
    });
    const before = trace.emotionalContext.arousal;
    applyReconsolidation(trace, happyMood, cfg);
    // happyMood.arousal is 0.3, trace starts at 0.8 — should decrease
    expect(trace.emotionalContext.arousal).toBeLessThan(before);
  });

  it('skips high-importance traces (flashbulb immune)', () => {
    const trace = makeTrace({ encodingStrength: 0.95 });
    const before = trace.emotionalContext.valence;
    applyReconsolidation(trace, happyMood, { ...cfg, immuneAboveImportance: 0.9 });
    expect(trace.emotionalContext.valence).toBe(before);
  });

  it('respects maxDriftPerTrace cap', () => {
    const trace = makeTrace();
    trace.structuredData = { mechanismMetadata: { cumulativeDrift: 0.39 } };
    const before = trace.emotionalContext.valence;
    applyReconsolidation(trace, happyMood, { ...cfg, maxDriftPerTrace: 0.4 });
    const drift = Math.abs(trace.emotionalContext.valence - before);
    expect(drift).toBeLessThan(0.02);
  });

  it('stops when cumulative drift reaches cap', () => {
    const trace = makeTrace();
    trace.structuredData = { mechanismMetadata: { cumulativeDrift: 0.4 } };
    const before = trace.emotionalContext.valence;
    applyReconsolidation(trace, happyMood, { ...cfg, maxDriftPerTrace: 0.4 });
    expect(trace.emotionalContext.valence).toBe(before);
  });

  it('records drift event in metadata', () => {
    const trace = makeTrace();
    trace.structuredData = {};
    applyReconsolidation(trace, happyMood, cfg);
    const meta = trace.structuredData?.mechanismMetadata as any;
    expect(meta.driftHistory).toBeDefined();
    expect(meta.driftHistory.length).toBe(1);
    expect(meta.driftHistory[0].beforePAD).toBeDefined();
    expect(meta.driftHistory[0].afterPAD).toBeDefined();
  });

  it('is no-op when disabled', () => {
    const trace = makeTrace();
    const before = trace.emotionalContext.valence;
    applyReconsolidation(trace, happyMood, { ...cfg, enabled: false });
    expect(trace.emotionalContext.valence).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Reconsolidation — perspectiveEncoded clamping
// ---------------------------------------------------------------------------

describe('applyReconsolidation perspectiveEncoded clamping', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.reconsolidation;

  it('halves driftRate when perspectiveEncoded is true', () => {
    const trace = makeTrace({
      emotionalContext: { valence: 0.5, arousal: 0.5, dominance: 0.5, intensity: 0.25, gmiMood: 'NEUTRAL' },
      structuredData: { mechanismMetadata: { perspectiveEncoded: true } },
    });
    const originalValence = trace.emotionalContext.valence;
    const mood: PADState = { valence: 1.0, arousal: 0.5, dominance: 0.5 };

    applyReconsolidation(trace, mood, cfg);

    const drift = trace.emotionalContext.valence - originalValence;
    // With halved rate (0.025 instead of 0.05), drift should be half as much
    expect(drift).toBeCloseTo(cfg.driftRate * 0.5 * (1.0 - 0.5), 5);
  });

  it('uses full driftRate when perspectiveEncoded is absent', () => {
    const trace = makeTrace({
      emotionalContext: { valence: 0.5, arousal: 0.5, dominance: 0.5, intensity: 0.25, gmiMood: 'NEUTRAL' },
    });
    const originalValence = trace.emotionalContext.valence;
    const mood: PADState = { valence: 1.0, arousal: 0.5, dominance: 0.5 };

    applyReconsolidation(trace, mood, cfg);

    const drift = trace.emotionalContext.valence - originalValence;
    expect(drift).toBeCloseTo(cfg.driftRate * (1.0 - 0.5), 5);
  });

  it('maxDriftPerTrace cap still applies with halved rate', () => {
    const trace = makeTrace({
      emotionalContext: { valence: 0.0, arousal: 0.0, dominance: 0.0, intensity: 0.0, gmiMood: 'NEUTRAL' },
      structuredData: {
        mechanismMetadata: { perspectiveEncoded: true, cumulativeDrift: cfg.maxDriftPerTrace - 0.01 },
      },
    });
    const mood: PADState = { valence: 1.0, arousal: 1.0, dominance: 1.0 };

    applyReconsolidation(trace, mood, cfg);

    const meta = trace.structuredData!.mechanismMetadata as any;
    expect(meta.cumulativeDrift).toBeLessThanOrEqual(cfg.maxDriftPerTrace);
  });
});

// ---------------------------------------------------------------------------
// Retrieval-Induced Forgetting
// ---------------------------------------------------------------------------

describe('applyRetrievalInducedForgetting', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.retrievalInducedForgetting;

  it('reduces stability of competing traces', () => {
    const winner = makeTrace({ id: 'winner' });
    const competitor = makeTrace({ id: 'competitor', stability: 100_000 });
    const result = applyRetrievalInducedForgetting([winner], [competitor], cfg);
    expect(result.suppressedIds).toContain('competitor');
    expect(competitor.stability).toBeLessThan(100_000);
  });

  it('applies correct suppression factor', () => {
    const winner = makeTrace({ id: 'winner' });
    const competitor = makeTrace({ id: 'competitor', stability: 100_000 });
    applyRetrievalInducedForgetting([winner], [competitor], cfg);
    expect(competitor.stability).toBeCloseTo(100_000 * (1 - 0.12));
  });

  it('respects maxSuppressionsPerQuery', () => {
    const winner = makeTrace({ id: 'winner' });
    const competitors = Array.from({ length: 10 }, (_, i) =>
      makeTrace({ id: `comp_${i}`, stability: 100_000 }),
    );
    const result = applyRetrievalInducedForgetting(
      [winner],
      competitors,
      { ...cfg, maxSuppressionsPerQuery: 3 },
    );
    expect(result.suppressedIds.length).toBe(3);
  });

  it('never suppresses high-importance traces', () => {
    const winner = makeTrace({ id: 'winner' });
    const important = makeTrace({ id: 'important', encodingStrength: 0.95, stability: 100_000 });
    const result = applyRetrievalInducedForgetting([winner], [important], cfg);
    expect(result.suppressedIds).not.toContain('important');
    expect(important.stability).toBe(100_000);
  });

  it('skips traces with strength below 0.1', () => {
    const winner = makeTrace({ id: 'winner' });
    const dead = makeTrace({ id: 'dead', encodingStrength: 0.01, stability: 100_000 });
    const result = applyRetrievalInducedForgetting([winner], [dead], cfg);
    expect(result.suppressedIds).not.toContain('dead');
  });

  it('is no-op when disabled', () => {
    const winner = makeTrace({ id: 'winner' });
    const competitor = makeTrace({ id: 'competitor', stability: 100_000 });
    const result = applyRetrievalInducedForgetting(
      [winner],
      [competitor],
      { ...cfg, enabled: false },
    );
    expect(result.suppressedIds.length).toBe(0);
    expect(competitor.stability).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Involuntary Recall
// ---------------------------------------------------------------------------

describe('selectInvoluntaryMemory', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.involuntaryRecall;

  it('returns null when probability is 0', () => {
    const traces = [makeTrace({ createdAt: Date.now() - 30 * 86_400_000, encodingStrength: 0.5 })];
    const result = selectInvoluntaryMemory(traces, new Set(), { ...cfg, probability: 0 });
    expect(result).toBeNull();
  });

  it('returns a trace when probability is 1.0', () => {
    const old = makeTrace({
      createdAt: Date.now() - 30 * 86_400_000,
      encodingStrength: 0.5,
      emotionalContext: { valence: 0.8, arousal: 0.9, dominance: 0.0, intensity: 0.72, gmiMood: 'NEUTRAL' },
    });
    const result = selectInvoluntaryMemory([old], new Set(), { ...cfg, probability: 1.0 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(old.id);
  });

  it('excludes already-retrieved traces', () => {
    const old = makeTrace({ createdAt: Date.now() - 30 * 86_400_000, encodingStrength: 0.5 });
    const result = selectInvoluntaryMemory([old], new Set([old.id]), { ...cfg, probability: 1.0 });
    expect(result).toBeNull();
  });

  it('excludes traces younger than minAgeDays', () => {
    const young = makeTrace({ createdAt: Date.now() - 3 * 86_400_000, encodingStrength: 0.5 });
    const result = selectInvoluntaryMemory([young], new Set(), { ...cfg, probability: 1.0, minAgeDays: 14 });
    expect(result).toBeNull();
  });

  it('excludes traces with strength below minStrength', () => {
    const weak = makeTrace({ createdAt: Date.now() - 30 * 86_400_000, encodingStrength: 0.05 });
    const result = selectInvoluntaryMemory([weak], new Set(), { ...cfg, probability: 1.0, minStrength: 0.15 });
    expect(result).toBeNull();
  });

  it('excludes inactive traces', () => {
    const inactive = makeTrace({
      createdAt: Date.now() - 30 * 86_400_000,
      encodingStrength: 0.5,
      isActive: false,
    });
    const result = selectInvoluntaryMemory([inactive], new Set(), { ...cfg, probability: 1.0 });
    expect(result).toBeNull();
  });

  it('is no-op when disabled', () => {
    const old = makeTrace({ createdAt: Date.now() - 30 * 86_400_000, encodingStrength: 0.5 });
    const result = selectInvoluntaryMemory([old], new Set(), { ...cfg, enabled: false });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Metacognitive FOK
// ---------------------------------------------------------------------------

describe('detectFeelingOfKnowing', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.metacognitiveFOK;

  function makeScoredTrace(overrides: Partial<ScoredMemoryTrace> = {}): ScoredMemoryTrace {
    return {
      ...makeTrace(),
      retrievalScore: 0.35,
      scoreBreakdown: {
        strengthScore: 0.2,
        similarityScore: 0.5,
        recencyScore: 0.1,
        emotionalCongruenceScore: 0.1,
        graphActivationScore: 0.0,
        importanceScore: 0.3,
      },
      ...overrides,
    };
  }

  it('identifies traces in the partial activation zone', () => {
    const partial = makeScoredTrace({ entities: ['deployment', 'friday'] });
    const signals = detectFeelingOfKnowing([partial], 0.5, cfg, ['deployment']);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('tip_of_tongue');
    expect(signals[0].feelingOfKnowing).toBeGreaterThan(0);
  });

  it('returns empty when no traces in partial zone', () => {
    const strong = makeScoredTrace({ retrievalScore: 0.8 });
    const signals = detectFeelingOfKnowing([strong], 0.5, cfg, []);
    expect(signals.length).toBe(0);
  });

  it('returns empty for traces below threshold', () => {
    const weak = makeScoredTrace({ retrievalScore: 0.1 });
    const signals = detectFeelingOfKnowing([weak], 0.5, cfg, []);
    expect(signals.length).toBe(0);
  });

  it('boosts FOK when entities overlap with query', () => {
    const partial = makeScoredTrace({
      entities: ['deployment', 'friday'],
      retrievalScore: 0.35,
    });
    const withEntity = detectFeelingOfKnowing([partial], 0.5, cfg, ['deployment']);
    const withoutEntity = detectFeelingOfKnowing([partial], 0.5, cfg, []);
    expect(withEntity[0].feelingOfKnowing).toBeGreaterThan(withoutEntity[0].feelingOfKnowing);
  });

  it('includes partial info with entities and age', () => {
    const partial = makeScoredTrace({
      entities: ['deployment'],
      createdAt: Date.now() - 10 * 86_400_000,
    });
    const signals = detectFeelingOfKnowing([partial], 0.5, cfg, []);
    expect(signals[0].partialInfo).toContain('deployment');
    expect(signals[0].partialInfo).toContain('days ago');
  });

  it('classifies high FOK as high_confidence', () => {
    const partial = makeScoredTrace({
      entities: ['deployment'],
      retrievalScore: 0.48,
      scoreBreakdown: {
        strengthScore: 0.4, similarityScore: 0.9, recencyScore: 0.3,
        emotionalCongruenceScore: 0.3, graphActivationScore: 0.0, importanceScore: 0.5,
      },
    });
    const signals = detectFeelingOfKnowing([partial], 0.5, cfg, ['deployment']);
    expect(signals[0].type).toBe('high_confidence');
  });

  it('is no-op when disabled', () => {
    const partial = makeScoredTrace();
    const signals = detectFeelingOfKnowing([partial], 0.5, { ...cfg, enabled: false }, []);
    expect(signals.length).toBe(0);
  });
});

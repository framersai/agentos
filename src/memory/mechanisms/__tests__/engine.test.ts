/**
 * @fileoverview Tests for CognitiveMechanismsEngine lifecycle hooks.
 * @module memory/mechanisms/__tests__/engine.test
 */

import { describe, it, expect } from 'vitest';
import { CognitiveMechanismsEngine } from '../CognitiveMechanismsEngine.js';
import type { MemoryTrace, ScoredMemoryTrace } from '../../types.js';
import type { PADState } from '../../config.js';
import type { CandidateTrace } from '../../decay/RetrievalPriorityScorer.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function makeTrace(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  return {
    id: `mt_${Math.random().toString(36).slice(2)}`,
    type: 'episodic',
    scope: 'user',
    scopeId: 'u1',
    content: 'test memory content for engine testing',
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
    encodingStrength: 0.5,
    stability: 3_600_000,
    retrievalCount: 2,
    lastAccessedAt: Date.now() - DAY_MS,
    accessCount: 3,
    reinforcementInterval: 3_600_000,
    updatedAt: Date.now(),
    createdAt: Date.now() - 7 * DAY_MS,
    isActive: true,
    ...overrides,
  } as MemoryTrace;
}

function makeScoredTrace(overrides: Partial<ScoredMemoryTrace> = {}): ScoredMemoryTrace {
  return {
    ...makeTrace(),
    retrievalScore: 0.7,
    scoreBreakdown: {
      strengthScore: 0.5,
      similarityScore: 0.8,
      recencyScore: 0.3,
      emotionalCongruenceScore: 0.3,
      graphActivationScore: 0.0,
      importanceScore: 0.5,
    },
    ...overrides,
  };
}

const happyMood: PADState = { valence: 0.7, arousal: 0.3, dominance: 0.2 };

// ---------------------------------------------------------------------------
// Engine construction
// ---------------------------------------------------------------------------

describe('CognitiveMechanismsEngine', () => {
  it('constructs with empty config (all defaults)', () => {
    const engine = new CognitiveMechanismsEngine({});
    const cfg = engine.getConfig();
    expect(cfg.reconsolidation.enabled).toBe(true);
    expect(cfg.retrievalInducedForgetting.enabled).toBe(true);
    expect(cfg.emotionRegulation.reappraisalRate).toBe(0.15);
  });

  it('respects config overrides', () => {
    const engine = new CognitiveMechanismsEngine({
      reconsolidation: { enabled: false },
      involuntaryRecall: { probability: 0.5 },
    });
    const cfg = engine.getConfig();
    expect(cfg.reconsolidation.enabled).toBe(false);
    expect(cfg.involuntaryRecall.probability).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// HEXACO personality modulation
// ---------------------------------------------------------------------------

describe('HEXACO personality modulation', () => {
  it('high emotionality increases reconsolidation drift rate', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highE = new CognitiveMechanismsEngine({}, { emotionality: 1.0 }).getConfig();
    expect(highE.reconsolidation.driftRate).toBeGreaterThan(baseline.reconsolidation.driftRate);
  });

  it('low emotionality decreases reconsolidation drift rate', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const lowE = new CognitiveMechanismsEngine({}, { emotionality: 0.0 }).getConfig();
    expect(lowE.reconsolidation.driftRate).toBeLessThan(baseline.reconsolidation.driftRate);
  });

  it('high conscientiousness increases RIF suppression factor', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highC = new CognitiveMechanismsEngine({}, { conscientiousness: 1.0 }).getConfig();
    expect(highC.retrievalInducedForgetting.suppressionFactor).toBeGreaterThan(
      baseline.retrievalInducedForgetting.suppressionFactor,
    );
  });

  it('high openness increases involuntary recall probability', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highO = new CognitiveMechanismsEngine({}, { openness: 1.0 }).getConfig();
    expect(highO.involuntaryRecall.probability).toBeGreaterThan(baseline.involuntaryRecall.probability);
  });

  it('high openness increases schema novelty boost', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highO = new CognitiveMechanismsEngine({}, { openness: 1.0 }).getConfig();
    expect(highO.schemaEncoding.noveltyBoost).toBeGreaterThan(baseline.schemaEncoding.noveltyBoost);
  });

  it('high honesty increases source skepticism (lowers reflection multiplier)', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highH = new CognitiveMechanismsEngine({}, { honesty: 1.0 }).getConfig();
    expect(highH.sourceConfidenceDecay.decayMultipliers.reflection).toBeLessThan(
      baseline.sourceConfidenceDecay.decayMultipliers.reflection,
    );
  });

  it('high agreeableness increases emotion regulation reappraisal rate', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highA = new CognitiveMechanismsEngine({}, { agreeableness: 1.0 }).getConfig();
    expect(highA.emotionRegulation.reappraisalRate).toBeGreaterThan(
      baseline.emotionRegulation.reappraisalRate,
    );
  });

  it('high extraversion lowers FOK threshold (more signals surfaced)', () => {
    const baseline = new CognitiveMechanismsEngine({}).getConfig();
    const highX = new CognitiveMechanismsEngine({}, { extraversion: 1.0 }).getConfig();
    expect(highX.metacognitiveFOK.partialActivationThreshold).toBeLessThan(
      baseline.metacognitiveFOK.partialActivationThreshold,
    );
  });

  it('no traits = no modulation (same as default)', () => {
    const noTraits = new CognitiveMechanismsEngine({}).getConfig();
    const withUndefined = new CognitiveMechanismsEngine({}, undefined).getConfig();
    expect(noTraits.reconsolidation.driftRate).toBe(withUndefined.reconsolidation.driftRate);
  });
});

// ---------------------------------------------------------------------------
// onAccess
// ---------------------------------------------------------------------------

describe('engine.onAccess', () => {
  it('applies reconsolidation drift', () => {
    const engine = new CognitiveMechanismsEngine({});
    const trace = makeTrace({
      emotionalContext: { valence: -0.5, arousal: 0.4, dominance: 0.0, intensity: 0.2, gmiMood: 'NEUTRAL' },
    });
    const before = trace.emotionalContext.valence;
    engine.onAccess(trace, happyMood);
    expect(trace.emotionalContext.valence).toBeGreaterThan(before);
  });

  it('is no-op when reconsolidation disabled', () => {
    const engine = new CognitiveMechanismsEngine({ reconsolidation: { enabled: false } });
    const trace = makeTrace();
    const before = trace.emotionalContext.valence;
    engine.onAccess(trace, happyMood);
    expect(trace.emotionalContext.valence).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// onRetrieval
// ---------------------------------------------------------------------------

describe('engine.onRetrieval', () => {
  it('returns suppressed IDs from RIF', () => {
    const engine = new CognitiveMechanismsEngine({});
    const result1 = makeScoredTrace({ id: 'r1' });
    const competitor: CandidateTrace = {
      trace: makeTrace({ id: 'c1', stability: 100_000 }),
      vectorSimilarity: 0.6,
    };
    const { suppressedIds } = engine.onRetrieval(
      [result1],
      [{ trace: result1, vectorSimilarity: 0.8 }, competitor],
      0.5,
      [],
    );
    expect(suppressedIds).toContain('c1');
  });

  it('returns metacognitive signals from FOK', () => {
    const engine = new CognitiveMechanismsEngine({});
    const result1 = makeScoredTrace({ id: 'r1', retrievalScore: 0.7 });
    const partial: CandidateTrace = {
      trace: makeTrace({ id: 'p1', entities: ['deployment'] }),
      vectorSimilarity: 0.5, // 0.5 * 0.35 = 0.175 — above 0.3? No, need higher similarity
    };
    // With vectorSimilarity 0.9, approximate score = 0.9 * 0.35 = 0.315 — in partial zone
    const partial2: CandidateTrace = {
      trace: makeTrace({ id: 'p2', entities: ['deployment'] }),
      vectorSimilarity: 0.9,
    };
    const { metacognitiveSignals } = engine.onRetrieval(
      [result1],
      [{ trace: result1, vectorSimilarity: 0.8 }, partial2],
      0.5,
      ['deployment'],
    );
    expect(metacognitiveSignals.length).toBeGreaterThanOrEqual(1);
    expect(metacognitiveSignals[0].traceId).toBe('p2');
  });

  it('returns empty when both disabled', () => {
    const engine = new CognitiveMechanismsEngine({
      retrievalInducedForgetting: { enabled: false },
      metacognitiveFOK: { enabled: false },
    });
    const result1 = makeScoredTrace({ id: 'r1' });
    const competitor: CandidateTrace = {
      trace: makeTrace({ id: 'c1', stability: 100_000 }),
      vectorSimilarity: 0.6,
    };
    const { suppressedIds, metacognitiveSignals } = engine.onRetrieval(
      [result1],
      [{ trace: result1, vectorSimilarity: 0.8 }, competitor],
      0.5,
      [],
    );
    expect(suppressedIds.length).toBe(0);
    expect(metacognitiveSignals.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// onEncoding
// ---------------------------------------------------------------------------

describe('engine.onEncoding', () => {
  it('applies schema encoding when centroids are set', () => {
    const engine = new CognitiveMechanismsEngine({});
    engine.setClusterCentroids(new Map([['c1', [1, 0, 0, 0]]]));

    const trace = makeTrace({ encodingStrength: 0.6 });
    engine.onEncoding(trace, [0.95, 0.1, 0.0, 0.0]); // congruent
    expect(trace.encodingStrength).toBeCloseTo(0.6 * 0.85);
  });

  it('is no-op when no centroids set', () => {
    const engine = new CognitiveMechanismsEngine({});
    const trace = makeTrace({ encodingStrength: 0.6 });
    engine.onEncoding(trace, [1, 0, 0, 0]);
    expect(trace.encodingStrength).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// onConsolidation
// ---------------------------------------------------------------------------

describe('engine.onConsolidation', () => {
  it('runs all consolidation mechanisms and returns counts', async () => {
    const engine = new CognitiveMechanismsEngine({});

    const oldTrace = makeTrace({
      createdAt: Date.now() - 90 * DAY_MS,
      retrievalCount: 0,
      encodingStrength: 0.5,
    });

    const reflectionTrace = makeTrace({
      provenance: { sourceType: 'reflection', confidence: 0.5, verificationCount: 0, sourceTimestamp: Date.now() },
      stability: 100_000,
    });

    const intenseTrace = makeTrace({
      emotionalContext: { valence: -0.9, arousal: 0.85, dominance: 0.0, intensity: 0.765, gmiMood: 'FRUSTRATED' },
      encodingStrength: 0.5,
    });

    const result = await engine.onConsolidation([oldTrace, reflectionTrace, intenseTrace]);
    expect(result.gistedCount).toBeGreaterThanOrEqual(1);
    expect(result.sourceDecayedCount).toBeGreaterThanOrEqual(1);
    expect(result.regulatedCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// onPromptAssembly
// ---------------------------------------------------------------------------

describe('engine.onPromptAssembly', () => {
  it('returns null when probability is 0', () => {
    const engine = new CognitiveMechanismsEngine({ involuntaryRecall: { probability: 0 } });
    const old = makeTrace({ createdAt: Date.now() - 30 * DAY_MS, encodingStrength: 0.5 });
    const { involuntaryMemory } = engine.onPromptAssembly([old], new Set());
    expect(involuntaryMemory).toBeNull();
  });

  it('returns a memory when probability is 1.0', () => {
    const engine = new CognitiveMechanismsEngine({ involuntaryRecall: { probability: 1.0 } });
    const old = makeTrace({
      createdAt: Date.now() - 30 * DAY_MS,
      encodingStrength: 0.5,
      emotionalContext: { valence: 0.8, arousal: 0.9, dominance: 0.0, intensity: 0.72, gmiMood: 'NEUTRAL' },
    });
    const { involuntaryMemory } = engine.onPromptAssembly([old], new Set());
    expect(involuntaryMemory).not.toBeNull();
  });
});

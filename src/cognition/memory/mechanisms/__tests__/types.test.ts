/**
 * @fileoverview Type compilation and shape tests for cognitive mechanisms config.
 * @module memory/mechanisms/__tests__/types.test
 */

import { describe, it, expect } from 'vitest';
import type {
  CognitiveMechanismsConfig,
  MetacognitiveSignal,
  MechanismMetadata,
  DriftEvent,
} from '../types.js';
import { DEFAULT_MECHANISMS_CONFIG, resolveConfig } from '../defaults.js';

// ---------------------------------------------------------------------------
// CognitiveMechanismsConfig shape
// ---------------------------------------------------------------------------

describe('CognitiveMechanismsConfig', () => {
  it('accepts an empty config (all mechanisms default to enabled)', () => {
    const cfg: CognitiveMechanismsConfig = {};
    expect(cfg).toBeDefined();
  });

  it('accepts a fully populated config', () => {
    const cfg: CognitiveMechanismsConfig = {
      reconsolidation: { enabled: true, driftRate: 0.05, maxDriftPerTrace: 0.4, immuneAboveImportance: 9 },
      retrievalInducedForgetting: { enabled: true, similarityThreshold: 0.7, suppressionFactor: 0.12, maxSuppressionsPerQuery: 5 },
      involuntaryRecall: { enabled: true, probability: 0.08, minAgeDays: 14, minStrength: 0.15 },
      metacognitiveFOK: { enabled: true, partialActivationThreshold: 0.3, surfaceTipOfTongue: true },
      temporalGist: { enabled: true, ageThresholdDays: 60, minRetrievalCount: 2, preserveEntities: true, preserveEmotionalContext: true },
      schemaEncoding: { enabled: true, clusterSimilarityThreshold: 0.75, noveltyBoost: 1.3, congruencyDiscount: 0.85 },
      sourceConfidenceDecay: { enabled: true, decayMultipliers: { user_statement: 1.0, reflection: 0.75 } },
      emotionRegulation: { enabled: true, reappraisalRate: 0.15, suppressionThreshold: 0.8, maxRegulationPerCycle: 10 },
    };
    expect(cfg.reconsolidation?.enabled).toBe(true);
  });

  it('allows disabling individual mechanisms', () => {
    const cfg: CognitiveMechanismsConfig = {
      reconsolidation: { enabled: false },
      retrievalInducedForgetting: { enabled: false },
    };
    expect(cfg.reconsolidation?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MECHANISMS_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_MECHANISMS_CONFIG', () => {
  it('has all mechanisms enabled by default', () => {
    const d = DEFAULT_MECHANISMS_CONFIG;
    expect(d.reconsolidation.enabled).toBe(true);
    expect(d.retrievalInducedForgetting.enabled).toBe(true);
    expect(d.involuntaryRecall.enabled).toBe(true);
    expect(d.metacognitiveFOK.enabled).toBe(true);
    expect(d.temporalGist.enabled).toBe(true);
    expect(d.schemaEncoding.enabled).toBe(true);
    expect(d.sourceConfidenceDecay.enabled).toBe(true);
    expect(d.emotionRegulation.enabled).toBe(true);
  });

  it('has sensible numeric defaults', () => {
    const d = DEFAULT_MECHANISMS_CONFIG;
    expect(d.reconsolidation.driftRate).toBe(0.05);
    expect(d.retrievalInducedForgetting.suppressionFactor).toBe(0.12);
    expect(d.involuntaryRecall.probability).toBe(0.08);
    expect(d.temporalGist.ageThresholdDays).toBe(60);
    expect(d.sourceConfidenceDecay.decayMultipliers.reflection).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------

describe('resolveConfig', () => {
  it('merges partial user config with defaults', () => {
    const resolved = resolveConfig({ reconsolidation: { driftRate: 0.10 } });
    expect(resolved.reconsolidation.driftRate).toBe(0.10);
    expect(resolved.reconsolidation.enabled).toBe(true);
    expect(resolved.involuntaryRecall.probability).toBe(0.08);
  });

  it('respects enabled: false overrides', () => {
    const resolved = resolveConfig({ reconsolidation: { enabled: false } });
    expect(resolved.reconsolidation.enabled).toBe(false);
  });

  it('deep-merges sourceConfidenceDecay.decayMultipliers', () => {
    const resolved = resolveConfig({
      sourceConfidenceDecay: { decayMultipliers: { reflection: 0.50 } },
    });
    expect(resolved.sourceConfidenceDecay.decayMultipliers.reflection).toBe(0.50);
    expect(resolved.sourceConfidenceDecay.decayMultipliers.user_statement).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Output types shape
// ---------------------------------------------------------------------------

describe('MetacognitiveSignal', () => {
  it('has expected shape', () => {
    const signal: MetacognitiveSignal = {
      type: 'tip_of_tongue',
      traceId: 'mt_123',
      feelingOfKnowing: 0.6,
      partialInfo: 'something about deployment',
    };
    expect(signal.type).toBe('tip_of_tongue');
    expect(signal.feelingOfKnowing).toBeGreaterThanOrEqual(0);
    expect(signal.feelingOfKnowing).toBeLessThanOrEqual(1);
  });
});

describe('DriftEvent', () => {
  it('tracks before/after PAD', () => {
    const event: DriftEvent = {
      timestamp: Date.now(),
      beforePAD: { valence: -0.3, arousal: 0.5, dominance: 0.0 },
      afterPAD: { valence: -0.25, arousal: 0.48, dominance: 0.01 },
    };
    expect(event.beforePAD.valence).not.toBe(event.afterPAD.valence);
  });
});

describe('MechanismMetadata', () => {
  it('accepts all optional fields', () => {
    const meta: MechanismMetadata = {
      cumulativeDrift: 0.12,
      driftHistory: [],
      gisted: false,
      originalContentHash: 'abc123',
      schemaCongruent: true,
      schemaViolating: false,
      schemaClusterId: 'cluster_1',
      lastSourceDecayAt: Date.now(),
      reappraisalHistory: [],
    };
    expect(meta.cumulativeDrift).toBe(0.12);
  });

  it('accepts an empty object', () => {
    const meta: MechanismMetadata = {};
    expect(meta).toBeDefined();
  });
});

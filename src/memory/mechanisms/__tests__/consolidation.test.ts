/**
 * @fileoverview Tests for consolidation-time cognitive mechanisms.
 * @module memory/mechanisms/__tests__/consolidation.test
 */

import { describe, it, expect, vi } from 'vitest';
import { applyTemporalGist } from '../consolidation/TemporalGist.js';
import { applySchemaEncoding } from '../consolidation/SchemaEncoding.js';
import { applySourceConfidenceDecay } from '../consolidation/SourceConfidenceDecay.js';
import { applyEmotionRegulation } from '../consolidation/EmotionRegulation.js';
import { DEFAULT_MECHANISMS_CONFIG } from '../defaults.js';
import type { MemoryTrace } from '../../core/types.js';

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
    content: 'This is a test memory with enough words to demonstrate gist extraction and truncation behavior across multiple words in a sentence',
    entities: ['deployment', 'server'],
    tags: ['test'],
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
    retrievalCount: 0,
    lastAccessedAt: Date.now() - DAY_MS,
    accessCount: 1,
    reinforcementInterval: 3_600_000,
    updatedAt: Date.now(),
    createdAt: Date.now() - 90 * DAY_MS, // 90 days old
    isActive: true,
    ...overrides,
  } as MemoryTrace;
}

// ---------------------------------------------------------------------------
// Temporal Gist Extraction
// ---------------------------------------------------------------------------

describe('applyTemporalGist', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.temporalGist;

  it('gists old low-retrieval episodic traces', async () => {
    const trace = makeTrace({ retrievalCount: 0 });
    const originalContent = trace.content;
    const count = await applyTemporalGist([trace], cfg);
    expect(count).toBe(1);
    expect(trace.content).not.toBe(originalContent);
    expect(trace.content).toContain('[NEUTRAL]'); // emotion label appended
  });

  it('reduces encoding strength by 20%', async () => {
    const trace = makeTrace({ encodingStrength: 0.5, retrievalCount: 0 });
    await applyTemporalGist([trace], cfg);
    expect(trace.encodingStrength).toBeCloseTo(0.4);
  });

  it('sets gisted flag and originalContentHash', async () => {
    const trace = makeTrace({ retrievalCount: 0 });
    await applyTemporalGist([trace], cfg);
    const meta = trace.structuredData?.mechanismMetadata as any;
    expect(meta.gisted).toBe(true);
    expect(meta.originalContentHash).toBeDefined();
    expect(typeof meta.originalContentHash).toBe('string');
  });

  it('skips traces younger than ageThresholdDays', async () => {
    const young = makeTrace({ createdAt: Date.now() - 10 * DAY_MS, retrievalCount: 0 });
    const count = await applyTemporalGist([young], cfg);
    expect(count).toBe(0);
  });

  it('skips frequently-retrieved traces', async () => {
    const retrieved = makeTrace({ retrievalCount: 5 });
    const count = await applyTemporalGist([retrieved], cfg);
    expect(count).toBe(0);
  });

  it('skips flashbulb-grade traces', async () => {
    const flashbulb = makeTrace({ encodingStrength: 0.95, retrievalCount: 0 });
    const count = await applyTemporalGist([flashbulb], cfg);
    expect(count).toBe(0);
  });

  it('skips procedural and prospective types', async () => {
    const procedural = makeTrace({ type: 'procedural', retrievalCount: 0 });
    const prospective = makeTrace({ type: 'prospective', retrievalCount: 0 });
    const count = await applyTemporalGist([procedural, prospective], cfg);
    expect(count).toBe(0);
  });

  it('skips already-gisted traces', async () => {
    const trace = makeTrace({ retrievalCount: 0 });
    trace.structuredData = { mechanismMetadata: { gisted: true } };
    const count = await applyTemporalGist([trace], cfg);
    expect(count).toBe(0);
  });

  it('uses LLM when provided', async () => {
    const trace = makeTrace({ retrievalCount: 0 });
    const llmFn = vi.fn().mockResolvedValue('Core assertion about deployment.');
    const count = await applyTemporalGist([trace], cfg, llmFn);
    expect(count).toBe(1);
    expect(llmFn).toHaveBeenCalledOnce();
    expect(trace.content).toBe('Core assertion about deployment.');
  });

  it('falls back to truncation on LLM failure', async () => {
    const trace = makeTrace({ retrievalCount: 0 });
    const llmFn = vi.fn().mockRejectedValue(new Error('LLM down'));
    const count = await applyTemporalGist([trace], cfg, llmFn);
    expect(count).toBe(1);
    expect(trace.content).toContain('[NEUTRAL]');
  });

  it('is no-op when disabled', async () => {
    const trace = makeTrace({ retrievalCount: 0 });
    const count = await applyTemporalGist([trace], { ...cfg, enabled: false });
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Schema Encoding
// ---------------------------------------------------------------------------

describe('applySchemaEncoding', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.schemaEncoding;

  const centroid1 = [1, 0, 0, 0]; // unit vector in dim 0
  const centroid2 = [0, 1, 0, 0]; // unit vector in dim 1
  const centroids = new Map([
    ['cluster_a', centroid1],
    ['cluster_b', centroid2],
  ]);

  it('discounts strength for schema-congruent traces', () => {
    const trace = makeTrace({ encodingStrength: 0.6 });
    const embedding = [0.95, 0.1, 0.0, 0.0]; // close to centroid1
    const result = applySchemaEncoding(trace, embedding, centroids, cfg);
    expect(result.isCongruent).toBe(true);
    expect(result.clusterId).toBe('cluster_a');
    expect(trace.encodingStrength).toBeCloseTo(0.6 * 0.85);
  });

  it('boosts strength for schema-violating traces', () => {
    const trace = makeTrace({ encodingStrength: 0.5 });
    const embedding = [0.3, 0.3, 0.6, 0.3]; // not close to any centroid
    const result = applySchemaEncoding(trace, embedding, centroids, cfg);
    expect(result.isCongruent).toBe(false);
    expect(trace.encodingStrength).toBeCloseTo(0.5 * 1.3);
  });

  it('caps encoding strength at 1.0', () => {
    const trace = makeTrace({ encodingStrength: 0.9 });
    const embedding = [0.3, 0.3, 0.6, 0.3]; // novel
    applySchemaEncoding(trace, embedding, centroids, cfg);
    expect(trace.encodingStrength).toBeLessThanOrEqual(1.0);
  });

  it('tags metadata for congruent traces', () => {
    const trace = makeTrace();
    const embedding = [0.95, 0.1, 0.0, 0.0];
    applySchemaEncoding(trace, embedding, centroids, cfg);
    const meta = trace.structuredData?.mechanismMetadata as any;
    expect(meta.schemaCongruent).toBe(true);
    expect(meta.schemaViolating).toBe(false);
    expect(meta.schemaClusterId).toBe('cluster_a');
  });

  it('tags metadata for violating traces', () => {
    const trace = makeTrace();
    const embedding = [0.3, 0.3, 0.6, 0.3];
    applySchemaEncoding(trace, embedding, centroids, cfg);
    const meta = trace.structuredData?.mechanismMetadata as any;
    expect(meta.schemaCongruent).toBe(false);
    expect(meta.schemaViolating).toBe(true);
  });

  it('is no-op with empty centroids', () => {
    const trace = makeTrace({ encodingStrength: 0.5 });
    const result = applySchemaEncoding(trace, [1, 0, 0, 0], new Map(), cfg);
    expect(result.isCongruent).toBe(false);
    expect(trace.encodingStrength).toBe(0.5);
  });

  it('is no-op when disabled', () => {
    const trace = makeTrace({ encodingStrength: 0.5 });
    const result = applySchemaEncoding(trace, [0.95, 0.1, 0, 0], centroids, { ...cfg, enabled: false });
    expect(trace.encodingStrength).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Source Confidence Decay
// ---------------------------------------------------------------------------

describe('applySourceConfidenceDecay', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.sourceConfidenceDecay;

  it('applies decay multiplier based on source type', () => {
    const reflection = makeTrace({
      provenance: { sourceType: 'reflection', confidence: 0.5, verificationCount: 0, sourceTimestamp: Date.now() },
      stability: 100_000,
    });
    const count = applySourceConfidenceDecay([reflection], cfg);
    expect(count).toBe(1);
    expect(reflection.stability).toBeCloseTo(100_000 * 0.75);
  });

  it('does not decay user_statement (multiplier 1.0)', () => {
    const statement = makeTrace({ stability: 100_000 });
    const count = applySourceConfidenceDecay([statement], cfg);
    expect(count).toBe(0);
    expect(statement.stability).toBe(100_000);
  });

  it('applies importance floor for high-importance traces', () => {
    const important = makeTrace({
      provenance: { sourceType: 'reflection', confidence: 0.9, verificationCount: 0, sourceTimestamp: Date.now() },
      encodingStrength: 0.85,
      stability: 100_000,
    });
    applySourceConfidenceDecay([important], cfg);
    // reflection multiplier is 0.75, but importance floor is 0.90
    expect(important.stability).toBeCloseTo(100_000 * 0.90);
  });

  it('skips inactive traces', () => {
    const inactive = makeTrace({
      provenance: { sourceType: 'reflection', confidence: 0.5, verificationCount: 0, sourceTimestamp: Date.now() },
      isActive: false,
      stability: 100_000,
    });
    const count = applySourceConfidenceDecay([inactive], cfg);
    expect(count).toBe(0);
    expect(inactive.stability).toBe(100_000);
  });

  it('skips if already decayed within the hour', () => {
    const trace = makeTrace({
      provenance: { sourceType: 'reflection', confidence: 0.5, verificationCount: 0, sourceTimestamp: Date.now() },
      stability: 100_000,
    });
    trace.structuredData = { mechanismMetadata: { lastSourceDecayAt: Date.now() - 1000 } };
    const count = applySourceConfidenceDecay([trace], cfg);
    expect(count).toBe(0);
  });

  it('is no-op when disabled', () => {
    const trace = makeTrace({
      provenance: { sourceType: 'reflection', confidence: 0.5, verificationCount: 0, sourceTimestamp: Date.now() },
      stability: 100_000,
    });
    const count = applySourceConfidenceDecay([trace], { ...cfg, enabled: false });
    expect(count).toBe(0);
    expect(trace.stability).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Emotion Regulation
// ---------------------------------------------------------------------------

describe('applyEmotionRegulation', () => {
  const cfg = DEFAULT_MECHANISMS_CONFIG.emotionRegulation;

  it('reappraises high-valence high-arousal traces', () => {
    const intense = makeTrace({
      emotionalContext: { valence: -0.9, arousal: 0.85, dominance: 0.0, intensity: 0.765, gmiMood: 'FRUSTRATED' },
      encodingStrength: 0.5,
    });
    const count = applyEmotionRegulation([intense], cfg);
    expect(count).toBe(1);
    expect(Math.abs(intense.emotionalContext.valence)).toBeLessThan(0.9);
    expect(intense.emotionalContext.arousal).toBeLessThan(0.85);
  });

  it('records reappraisal event in metadata', () => {
    const intense = makeTrace({
      emotionalContext: { valence: -0.9, arousal: 0.85, dominance: 0.0, intensity: 0.765, gmiMood: 'FRUSTRATED' },
      encodingStrength: 0.5,
    });
    applyEmotionRegulation([intense], cfg);
    const meta = intense.structuredData?.mechanismMetadata as any;
    expect(meta.reappraisalHistory).toBeDefined();
    expect(meta.reappraisalHistory.length).toBe(1);
    expect(meta.reappraisalHistory[0].previousValence).toBe(-0.9);
  });

  it('respects maxRegulationPerCycle', () => {
    const traces = Array.from({ length: 20 }, () =>
      makeTrace({
        emotionalContext: { valence: -0.9, arousal: 0.9, dominance: 0.0, intensity: 0.81, gmiMood: 'FRUSTRATED' },
        encodingStrength: 0.5,
      }),
    );
    const count = applyEmotionRegulation(traces, { ...cfg, maxRegulationPerCycle: 5 });
    expect(count).toBe(5);
  });

  it('never regulates flashbulb-grade traces', () => {
    const flashbulb = makeTrace({
      emotionalContext: { valence: -0.95, arousal: 0.9, dominance: 0.0, intensity: 0.855, gmiMood: 'FRUSTRATED' },
      encodingStrength: 0.95,
    });
    const count = applyEmotionRegulation([flashbulb], cfg);
    expect(count).toBe(0);
    expect(flashbulb.emotionalContext.valence).toBe(-0.95);
  });

  it('skips traces below suppression threshold', () => {
    const mild = makeTrace({
      emotionalContext: { valence: 0.3, arousal: 0.5, dominance: 0.0, intensity: 0.15, gmiMood: 'NEUTRAL' },
    });
    const count = applyEmotionRegulation([mild], cfg);
    expect(count).toBe(0);
  });

  it('is no-op when disabled', () => {
    const intense = makeTrace({
      emotionalContext: { valence: -0.9, arousal: 0.85, dominance: 0.0, intensity: 0.765, gmiMood: 'FRUSTRATED' },
    });
    const count = applyEmotionRegulation([intense], { ...cfg, enabled: false });
    expect(count).toBe(0);
  });
});

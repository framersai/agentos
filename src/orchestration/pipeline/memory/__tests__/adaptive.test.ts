/**
 * @file adaptive.test.ts
 * @description Contract tests for AdaptiveMemoryRouter — self-calibrating
 * router that derives routing tables from a workload-specific calibration
 * dataset instead of relying on the LongMemEval-S Phase B presets.
 *
 * Tests cover:
 *   - aggregateCalibration: rolls up per-(category, backend) sample
 *     points into mean cost + mean accuracy + sample count.
 *   - selectByPreset: picks a backend per category given aggregated
 *     calibration data + a preset selection rule.
 *   - buildAdaptiveRoutingTable: returns a complete RoutingTable from
 *     calibration data + preset.
 *   - AdaptiveMemoryRouter: high-level class that combines the above
 *     with the existing MemoryRouter machinery.
 *   - Edge cases: missing categories (use the preset's static fallback);
 *     missing backends (table picks among available backends only); zero
 *     samples per cell (skip and fall back to preset default).
 *
 * @module memory-router/__tests__/adaptive.test
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateCalibration,
  selectByPreset,
  buildAdaptiveRoutingTable,
  AdaptiveMemoryRouter,
  type CalibrationSample,
  type AggregatedCalibration,
} from '../adaptive.js';
import {
  MINIMIZE_COST_TABLE,
} from '../routing-tables.js';

const sampleSet1: CalibrationSample[] = [
  // multi-session: canonical cheap but lower accuracy
  { category: 'multi-session', backend: 'canonical-hybrid', costUsd: 0.02, correct: 1 },
  { category: 'multi-session', backend: 'canonical-hybrid', costUsd: 0.02, correct: 0 },
  { category: 'multi-session', backend: 'canonical-hybrid', costUsd: 0.02, correct: 0 },
  // multi-session: v11 expensive but higher accuracy
  { category: 'multi-session', backend: 'observational-memory-v11', costUsd: 0.04, correct: 1 },
  { category: 'multi-session', backend: 'observational-memory-v11', costUsd: 0.04, correct: 1 },
  { category: 'multi-session', backend: 'observational-memory-v11', costUsd: 0.04, correct: 1 },
  // single-session-user: canonical wins clearly
  { category: 'single-session-user', backend: 'canonical-hybrid', costUsd: 0.02, correct: 1 },
  { category: 'single-session-user', backend: 'canonical-hybrid', costUsd: 0.02, correct: 1 },
  { category: 'single-session-user', backend: 'observational-memory-v11', costUsd: 0.04, correct: 0 },
];

describe('aggregateCalibration: rolls up samples', () => {
  it('computes mean cost + mean accuracy per (category, backend) cell', () => {
    const agg = aggregateCalibration(sampleSet1);

    const msCanonical = agg['multi-session']?.['canonical-hybrid'];
    expect(msCanonical?.n).toBe(3);
    expect(msCanonical?.meanCost).toBeCloseTo(0.02, 4);
    expect(msCanonical?.meanAccuracy).toBeCloseTo(1 / 3, 3);

    const msV11 = agg['multi-session']?.['observational-memory-v11'];
    expect(msV11?.n).toBe(3);
    expect(msV11?.meanAccuracy).toBeCloseTo(1, 3);
  });

  it('handles empty input', () => {
    const agg = aggregateCalibration([]);
    expect(Object.keys(agg)).toHaveLength(0);
  });
});

describe('selectByPreset: minimize-cost', () => {
  it('picks cheapest backend within 2pp of best accuracy on this category', () => {
    const agg: AggregatedCalibration = {
      'multi-session': {
        'canonical-hybrid': { n: 3, meanCost: 0.02, meanAccuracy: 0.55 },
        'observational-memory-v11': { n: 3, meanCost: 0.04, meanAccuracy: 0.62 },
      },
    };
    // -7pp gap exceeds the 2pp tolerance → minimize-cost picks v11 (best accuracy)
    expect(
      selectByPreset({
        category: 'multi-session',
        agg,
        preset: 'minimize-cost',
      }),
    ).toBe('observational-memory-v11');
  });

  it('picks the cheaper backend when accuracy is within tolerance', () => {
    const agg: AggregatedCalibration = {
      'single-session-user': {
        'canonical-hybrid': { n: 10, meanCost: 0.02, meanAccuracy: 0.97 },
        'observational-memory-v11': { n: 10, meanCost: 0.04, meanAccuracy: 0.98 },
      },
    };
    // 1pp gap is within 2pp tolerance → pick cheaper (canonical-hybrid)
    expect(
      selectByPreset({
        category: 'single-session-user',
        agg,
        preset: 'minimize-cost',
      }),
    ).toBe('canonical-hybrid');
  });
});

describe('selectByPreset: maximize-accuracy', () => {
  it('picks highest-accuracy backend regardless of cost', () => {
    const agg: AggregatedCalibration = {
      'multi-session': {
        'canonical-hybrid': { n: 3, meanCost: 0.02, meanAccuracy: 0.55 },
        'observational-memory-v11': { n: 3, meanCost: 0.04, meanAccuracy: 0.62 },
      },
    };
    expect(
      selectByPreset({
        category: 'multi-session',
        agg,
        preset: 'maximize-accuracy',
      }),
    ).toBe('observational-memory-v11');
  });

  it('breaks ties by cost (cheaper wins)', () => {
    const agg: AggregatedCalibration = {
      'temporal-reasoning': {
        'canonical-hybrid': { n: 5, meanCost: 0.02, meanAccuracy: 0.70 },
        'observational-memory-v10': { n: 5, meanCost: 0.03, meanAccuracy: 0.70 },
      },
    };
    expect(
      selectByPreset({
        category: 'temporal-reasoning',
        agg,
        preset: 'maximize-accuracy',
      }),
    ).toBe('canonical-hybrid');
  });
});

describe('selectByPreset: balanced', () => {
  it('picks best $/correct ratio', () => {
    const agg: AggregatedCalibration = {
      'multi-session': {
        'canonical-hybrid': { n: 3, meanCost: 0.02, meanAccuracy: 0.55 }, // $/correct = 0.0364
        'observational-memory-v11': { n: 3, meanCost: 0.04, meanAccuracy: 0.62 }, // $/correct = 0.0645
      },
    };
    // canonical-hybrid has better $/correct
    expect(
      selectByPreset({
        category: 'multi-session',
        agg,
        preset: 'balanced',
      }),
    ).toBe('canonical-hybrid');
  });
});

describe('selectByPreset: insufficient data fallback', () => {
  it('falls back to preset table when category has no calibration data', () => {
    const agg: AggregatedCalibration = {};
    const result = selectByPreset({
      category: 'multi-session',
      agg,
      preset: 'minimize-cost',
    });
    // Falls back to MINIMIZE_COST_TABLE['multi-session']
    expect(result).toBe(MINIMIZE_COST_TABLE.defaultMapping['multi-session']);
  });

  it('falls back to preset when minSamplesPerCell is not met', () => {
    const agg: AggregatedCalibration = {
      'multi-session': {
        'canonical-hybrid': { n: 1, meanCost: 0.02, meanAccuracy: 1.0 },
      },
    };
    const result = selectByPreset({
      category: 'multi-session',
      agg,
      preset: 'minimize-cost',
      minSamplesPerCell: 3,
    });
    // Insufficient samples → preset fallback
    expect(result).toBe(MINIMIZE_COST_TABLE.defaultMapping['multi-session']);
  });
});

describe('buildAdaptiveRoutingTable: builds a complete table', () => {
  it('returns a frozen table with every category mapped', () => {
    const table = buildAdaptiveRoutingTable({
      samples: sampleSet1,
      preset: 'maximize-accuracy',
    });
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.defaultMapping)).toBe(true);
    expect(table.preset).toBe('maximize-accuracy');
    // Every category present (calibrated or fallback)
    expect(table.defaultMapping['multi-session']).toBeDefined();
    expect(table.defaultMapping['single-session-user']).toBeDefined();
    expect(table.defaultMapping['single-session-assistant']).toBeDefined();
    expect(table.defaultMapping['single-session-preference']).toBeDefined();
    expect(table.defaultMapping['knowledge-update']).toBeDefined();
    expect(table.defaultMapping['temporal-reasoning']).toBeDefined();
  });

  it('uses calibrated picks where data is available; preset fallback elsewhere', () => {
    const table = buildAdaptiveRoutingTable({
      samples: sampleSet1, // covers multi-session + single-session-user only
      preset: 'maximize-accuracy',
    });
    // multi-session: calibration shows v11 wins
    expect(table.defaultMapping['multi-session']).toBe('observational-memory-v11');
    // single-session-user: calibration shows canonical wins
    expect(table.defaultMapping['single-session-user']).toBe('canonical-hybrid');
    // single-session-assistant: no calibration → preset fallback
    // (MAXIMIZE_ACCURACY_TABLE.defaultMapping['single-session-assistant'] = 'canonical-hybrid')
    expect(table.defaultMapping['single-session-assistant']).toBe('canonical-hybrid');
  });
});

describe('AdaptiveMemoryRouter: full integration', () => {
  it('uses an adaptive routing table built from calibration samples', async () => {
    const stubClassifier = {
      classify: async () => ({
        category: 'multi-session' as const,
        tokensIn: 10,
        tokensOut: 2,
        model: 'stub',
      }),
    };
    const router = new AdaptiveMemoryRouter({
      classifier: stubClassifier,
      calibrationSamples: sampleSet1,
      preset: 'maximize-accuracy',
    });
    const decision = await router.decide('q?');
    expect(decision.routing.chosenBackend).toBe('observational-memory-v11');
    expect(decision.routing.preset).toBe('maximize-accuracy');
  });

  it('exposes the derived table for inspection', () => {
    const stubClassifier = {
      classify: async () => ({
        category: 'multi-session' as const,
        tokensIn: 10,
        tokensOut: 2,
        model: 'stub',
      }),
    };
    const router = new AdaptiveMemoryRouter({
      classifier: stubClassifier,
      calibrationSamples: sampleSet1,
      preset: 'maximize-accuracy',
    });
    const table = router.getRoutingTable();
    expect(table.preset).toBe('maximize-accuracy');
    expect(table.defaultMapping['multi-session']).toBe('observational-memory-v11');
  });
});

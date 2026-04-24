/**
 * @file select-backend.test.ts
 * @description Contract tests for {@link selectBackend} — the pure function
 * that turns a classifier-predicted category + a routing config into a
 * {@link MemoryRoutingDecision}. Covers:
 *   - Basic table lookup (no budget): the mapped backend is returned with
 *     cost from the backend cost-points data.
 *   - Hard budget mode: throws when the picked backend exceeds the
 *     per-query USD ceiling.
 *   - Soft budget mode: exceeds the ceiling only when the picked backend
 *     has better $/correct than the cheapest backend that fits.
 *   - Cheapest-fallback mode: downgrades to the cheapest fitting backend.
 *   - Globally-no-fit edge case: when no backend fits the budget at all,
 *     picks the absolute cheapest and flags `budgetExceeded: true`.
 *   - Unknown category: throws a typed error so misuse fails loudly.
 *
 * The function is pure (deterministic, no I/O) — tests use the shipping
 * cost-point data directly.
 *
 * @module memory-router/__tests__/select-backend.test
 */

import { describe, it, expect } from 'vitest';
import {
  selectBackend,
  MemoryRouterUnknownCategoryError,
  MemoryRouterBudgetExceededError,
} from '../select-backend.js';
import {
  MINIMIZE_COST_TABLE,
  MAXIMIZE_ACCURACY_TABLE,
} from '../routing-tables.js';
import {
  DEFAULT_MEMORY_BACKEND_COSTS,
  TIER_1_CANONICAL_COSTS,
} from '../backend-costs.js';

describe('selectBackend: routing-table lookup with no budget', () => {
  it('returns the backend mapped by the table for the predicted category', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: {
        table: MINIMIZE_COST_TABLE,
        budgetPerQuery: null,
        budgetMode: 'hard',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.chosenBackend).toBe('observational-memory-v11');
    expect(decision.predictedCategory).toBe('multi-session');
    expect(decision.budgetExceeded).toBe(false);
    expect(decision.preset).toBe('minimize-cost');
  });

  it('records the per-category cost from the cost-points data', () => {
    const decision = selectBackend({
      predictedCategory: 'temporal-reasoning',
      groundTruthCategory: null,
      config: {
        table: MINIMIZE_COST_TABLE,
        budgetPerQuery: null,
        budgetMode: 'hard',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.chosenBackend).toBe('canonical-hybrid');
    // canonical-hybrid TR cost from Phase B: $0.0202
    expect(decision.estimatedCostUsd).toBeCloseTo(
      TIER_1_CANONICAL_COSTS.perCategoryCostPerQuery['temporal-reasoning'],
      4,
    );
  });
});

describe('selectBackend: hard budget mode', () => {
  it('throws MemoryRouterBudgetExceededError when picked backend cost > budget', () => {
    expect(() =>
      selectBackend({
        predictedCategory: 'multi-session',
        groundTruthCategory: null,
        config: {
          table: MAXIMIZE_ACCURACY_TABLE, // routes MS to v11 ($0.0336)
          budgetPerQuery: 0.01, // very tight
          budgetMode: 'hard',
          backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
        },
      }),
    ).toThrow(MemoryRouterBudgetExceededError);
  });

  it('returns picked backend without throwing when cost <= budget', () => {
    const decision = selectBackend({
      predictedCategory: 'temporal-reasoning',
      groundTruthCategory: null,
      config: {
        table: MINIMIZE_COST_TABLE,
        budgetPerQuery: 0.05,
        budgetMode: 'hard',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.chosenBackend).toBe('canonical-hybrid');
    expect(decision.budgetExceeded).toBe(false);
  });
});

describe('selectBackend: cheapest-fallback budget mode', () => {
  it('downgrades to the cheapest backend that fits the budget', () => {
    // MAXIMIZE_ACCURACY routes single-session-user to v11 ($0.0212).
    // With budget $0.02, v11 doesn't fit but canonical-hybrid ($0.0191) does.
    const decision = selectBackend({
      predictedCategory: 'single-session-user',
      groundTruthCategory: null,
      config: {
        table: MAXIMIZE_ACCURACY_TABLE,
        budgetPerQuery: 0.02,
        budgetMode: 'cheapest-fallback',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.chosenBackend).toBe('canonical-hybrid');
    expect(decision.budgetExceeded).toBe(false);
    expect(decision.chosenBackendReason).toContain('cheapest-fallback');
  });

  it('falls back to globally cheapest when no backend fits at all (and flags budgetExceeded)', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: {
        table: MAXIMIZE_ACCURACY_TABLE,
        budgetPerQuery: 0.001, // impossibly tight
        budgetMode: 'cheapest-fallback',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    // Cheapest MS cost across all backends is canonical-hybrid at $0.0196.
    expect(decision.chosenBackend).toBe('canonical-hybrid');
    expect(decision.budgetExceeded).toBe(true);
    expect(decision.chosenBackendReason).toContain('absolute cheapest');
  });
});

describe('selectBackend: soft budget mode', () => {
  it('exceeds the ceiling when picked backend has better $/correct than cheapest fits', () => {
    // The shipping Phase B cost data has canonical-hybrid almost always
    // cheaper-and-better-$/correct than the OM tiers, which means this
    // branch is hard to exercise with shipping data. Use synthetic
    // cost-points where v11 has better $/correct than canonical despite
    // higher absolute cost (e.g., a rare-but-valuable accuracy lift on
    // some category in a custom workload).
    const syntheticCosts = {
      'canonical-hybrid': {
        ...DEFAULT_MEMORY_BACKEND_COSTS['canonical-hybrid'],
        perCategoryCostPerQuery: {
          ...DEFAULT_MEMORY_BACKEND_COSTS['canonical-hybrid']
            .perCategoryCostPerQuery,
          'multi-session': 0.020,
        },
        perCategoryAccuracy: {
          ...DEFAULT_MEMORY_BACKEND_COSTS['canonical-hybrid']
            .perCategoryAccuracy,
          'multi-session': 0.300, // $/correct = $0.0667
        },
      },
      'observational-memory-v10':
        DEFAULT_MEMORY_BACKEND_COSTS['observational-memory-v10'],
      'observational-memory-v11': {
        ...DEFAULT_MEMORY_BACKEND_COSTS['observational-memory-v11'],
        perCategoryCostPerQuery: {
          ...DEFAULT_MEMORY_BACKEND_COSTS['observational-memory-v11']
            .perCategoryCostPerQuery,
          'multi-session': 0.030,
        },
        perCategoryAccuracy: {
          ...DEFAULT_MEMORY_BACKEND_COSTS['observational-memory-v11']
            .perCategoryAccuracy,
          'multi-session': 0.900, // $/correct = $0.0333 (much better than canonical's $0.0667)
        },
      },
    };
    // budget $0.025: v11 ($0.030) doesn't fit; canonical ($0.020) fits.
    // canonical $/correct $0.0667 vs v11 $/correct $0.0333. v11 wins on
    // $/correct → soft mode keeps v11 with budgetExceeded=true.
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: {
        table: MAXIMIZE_ACCURACY_TABLE, // routes MS to v11
        budgetPerQuery: 0.025,
        budgetMode: 'soft',
        backendCosts: syntheticCosts,
      },
    });
    expect(decision.chosenBackend).toBe('observational-memory-v11');
    expect(decision.budgetExceeded).toBe(true);
    expect(decision.chosenBackendReason).toContain('better $/correct');
  });

  it('downgrades when picked backend has worse $/correct than cheapest fits', () => {
    // For multi-session, MAXIMIZE_ACCURACY picks v11 at $0.0336/0.617 = $0.0544/correct.
    // canonical-hybrid is $0.0196/0.549 = $0.0357/correct. canonical is better $/correct.
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: {
        table: MAXIMIZE_ACCURACY_TABLE,
        budgetPerQuery: 0.025, // canonical fits, v11 doesn't
        budgetMode: 'soft',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.chosenBackend).toBe('canonical-hybrid');
    expect(decision.budgetExceeded).toBe(false);
    expect(decision.chosenBackendReason).toContain('cheaper $/correct');
  });
});

describe('selectBackend: error cases', () => {
  it('throws MemoryRouterUnknownCategoryError for an unknown category', () => {
    expect(() =>
      selectBackend({
        // @ts-expect-error -- testing runtime guard for misuse
        predictedCategory: 'made-up-category',
        groundTruthCategory: null,
        config: {
          table: MINIMIZE_COST_TABLE,
          budgetPerQuery: null,
          budgetMode: 'hard',
          backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
        },
      }),
    ).toThrow(MemoryRouterUnknownCategoryError);
  });
});

describe('selectBackend: ground-truth category passthrough', () => {
  it('records groundTruthCategory in the decision when supplied', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: 'temporal-reasoning',
      config: {
        table: MINIMIZE_COST_TABLE,
        budgetPerQuery: null,
        budgetMode: 'hard',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.groundTruthCategory).toBe('temporal-reasoning');
  });

  it('records null when groundTruthCategory is not supplied (production case)', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: {
        table: MINIMIZE_COST_TABLE,
        budgetPerQuery: null,
        budgetMode: 'hard',
        backendCosts: DEFAULT_MEMORY_BACKEND_COSTS,
      },
    });
    expect(decision.groundTruthCategory).toBeNull();
  });
});

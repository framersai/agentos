/**
 * @file augmented-routing.test.ts
 * @description Contract tests for the augmented routing primitives that
 * extend the MemoryRouter dispatch contract with a per-category
 * retrieval-config axis.
 *
 * Phase 1 of the RetrievalConfigRouter productionization plan
 * (`packages/agentos-bench/docs/specs/2026-04-26-retrieval-config-router-productionization-plan.md`)
 * adds three tightly-scoped primitives to agentos core:
 *
 *   1. {@link MemoryDispatchKey}, a composite key (backend × retrieval-config)
 *      that augments the legacy single-axis {@link MemoryBackendId} dispatch.
 *   2. {@link MINIMIZE_COST_AUGMENTED_TABLE}, the v2 calibration that
 *      merges the LongMemEval-S Phase B backend choices with the
 *      LongMemEval-M Phase A retrieval-config choices.
 *   3. {@link selectAugmentedDispatch}, the pure selector consumers (and
 *      the bench, in Phase 3) call to resolve a category to its
 *      composite dispatch key.
 *
 * These tests pin:
 *   - structural completeness (every category covered, every value valid),
 *   - per-category calibration choices (the load-bearing routing decisions
 *     that justify the table's claimed lift),
 *   - selector behavior (calibrated picks for known categories;
 *     SAFE_FALLBACK_DISPATCH_KEY for unknown categories),
 *   - module-level immutability (frozen tables, frozen entries).
 *
 * @module memory-router/__tests__/augmented-routing.test
 */

import { describe, it, expect } from 'vitest';
import {
  MEMORY_QUERY_CATEGORIES,
  MINIMIZE_COST_AUGMENTED_TABLE,
  S_BEST_CAT_HYDE_MS_2026_04_28_TABLE,
  S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE,
  AUGMENTED_PRESET_TABLES,
  SAFE_FALLBACK_BACKEND,
  SAFE_FALLBACK_DISPATCH_KEY,
  selectAugmentedDispatch,
  type MemoryQueryCategory,
  type MemoryBackendId,
} from '../routing-tables.js';
import {
  RETRIEVAL_CONFIG_IDS,
  type RetrievalConfigId,
} from '../retrieval-config.js';

const VALID_BACKENDS: readonly MemoryBackendId[] = [
  'canonical-hybrid',
  'observational-memory-v10',
  'observational-memory-v11',
] as const;

describe('augmented routing: SAFE_FALLBACK constants', () => {
  it('SAFE_FALLBACK_BACKEND is canonical-hybrid (cheapest, always-registered)', () => {
    expect(SAFE_FALLBACK_BACKEND).toBe('canonical-hybrid');
  });

  it('SAFE_FALLBACK_DISPATCH_KEY uses the safe-fallback backend with canonical retrieval config', () => {
    expect(SAFE_FALLBACK_DISPATCH_KEY.backend).toBe(SAFE_FALLBACK_BACKEND);
    expect(SAFE_FALLBACK_DISPATCH_KEY.retrievalConfig).toBe('canonical');
  });

  it('SAFE_FALLBACK_DISPATCH_KEY is frozen at module load', () => {
    expect(Object.isFrozen(SAFE_FALLBACK_DISPATCH_KEY)).toBe(true);
  });
});

describe('MINIMIZE_COST_AUGMENTED_TABLE: structural completeness', () => {
  it('carries the minimize-cost-augmented preset name', () => {
    expect(MINIMIZE_COST_AUGMENTED_TABLE.preset).toBe('minimize-cost-augmented');
  });

  it('covers every MemoryQueryCategory in defaultMapping', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      expect(MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping[category]).toBeDefined();
    }
  });

  it('every dispatch key carries a valid MemoryBackendId', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping[category];
      expect(VALID_BACKENDS).toContain(key.backend);
    }
  });

  it('every dispatch key carries a valid RetrievalConfigId', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping[category];
      expect(RETRIEVAL_CONFIG_IDS as readonly RetrievalConfigId[]).toContain(
        key.retrievalConfig,
      );
    }
  });

  it('table object and defaultMapping are frozen at module load', () => {
    expect(Object.isFrozen(MINIMIZE_COST_AUGMENTED_TABLE)).toBe(true);
    expect(Object.isFrozen(MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping)).toBe(true);
  });

  it('every individual dispatch-key entry is frozen', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping[category];
      expect(Object.isFrozen(key)).toBe(true);
    }
  });
});

describe('MINIMIZE_COST_AUGMENTED_TABLE: load-bearing calibration choices (2026-04-26 v2)', () => {
  // Backend axis from LongMemEval-S Phase B N=500 calibration:
  //   SSP + MS pay the OM-v11 premium (architectural lift earns it);
  //   every other category routes to canonical-hybrid (cheapest Pareto-dominant).

  it('routes single-session-preference to OM-v11 backend (S Phase B architectural lift)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['single-session-preference'].backend,
    ).toBe('observational-memory-v11');
  });

  it('routes multi-session to OM-v11 backend (S Phase B architectural lift)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['multi-session'].backend,
    ).toBe('observational-memory-v11');
  });

  it.each([
    'single-session-assistant',
    'single-session-user',
    'temporal-reasoning',
    'knowledge-update',
  ] as const)(
    'routes %s to canonical-hybrid backend (S Phase B Pareto-dominant cheap path)',
    (category) => {
      expect(
        MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping[category].backend,
      ).toBe('canonical-hybrid');
    },
  );

  // Retrieval-config axis from LongMemEval-M Phase A N=54 ablation matrix
  // (per-category-oracle picks, ties broken by lower $/correct).

  it('routes single-session-assistant to hyde-topk50-mult5 (M Phase A 100% on this category)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['single-session-assistant']
        .retrievalConfig,
    ).toBe('hyde-topk50-mult5');
  });

  it('routes single-session-user to hyde-topk50-mult5 (M Phase A 77.8%)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['single-session-user']
        .retrievalConfig,
    ).toBe('hyde-topk50-mult5');
  });

  it('routes multi-session to hyde-topk50-mult5 (M Phase A 66.7%, the only config that lifts MS)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['multi-session']
        .retrievalConfig,
    ).toBe('hyde-topk50-mult5');
  });

  it('routes knowledge-update to topk50 (M Phase A 77.8%, top-K alone is sufficient)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['knowledge-update']
        .retrievalConfig,
    ).toBe('topk50');
  });

  it('routes temporal-reasoning to hyde alone (M Phase A 66.7%; wider rerank pool actively hurts TR)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['temporal-reasoning']
        .retrievalConfig,
    ).toBe('hyde');
  });

  it('routes single-session-preference to hyde alone (M Phase A 22.2%, cheapest tiebreaker on a hard category)', () => {
    expect(
      MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping['single-session-preference']
        .retrievalConfig,
    ).toBe('hyde');
  });
});

describe('AUGMENTED_PRESET_TABLES registry', () => {
  it('exposes minimize-cost-augmented keyed by preset name', () => {
    expect(AUGMENTED_PRESET_TABLES['minimize-cost-augmented']).toBe(
      MINIMIZE_COST_AUGMENTED_TABLE,
    );
  });

  it('does not yet expose balanced-augmented or maximize-accuracy-augmented (v3 work)', () => {
    expect(AUGMENTED_PRESET_TABLES['balanced-augmented']).toBeUndefined();
    expect(AUGMENTED_PRESET_TABLES['maximize-accuracy-augmented']).toBeUndefined();
  });

  it('is frozen at module load', () => {
    expect(Object.isFrozen(AUGMENTED_PRESET_TABLES)).toBe(true);
  });
});

describe('S_BEST_CAT_HYDE_MS_2026_04_28_TABLE: structural completeness', () => {
  it('preset name matches the calibration date', () => {
    expect(S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.preset).toBe('s-best-cat-hyde-ms-2026-04-28');
  });

  it('has a dispatch key for every known MemoryQueryCategory', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      expect(S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping[category]).toBeDefined();
    }
  });

  it('every backend is canonical-hybrid (S Phase B 85.6% headline runs canonical end-to-end)', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping[category];
      expect(key.backend).toBe('canonical-hybrid');
    }
  });

  it('every retrievalConfig is a valid RetrievalConfigId', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping[category];
      expect(RETRIEVAL_CONFIG_IDS).toContain<RetrievalConfigId>(
        key.retrievalConfig as RetrievalConfigId,
      );
    }
  });

  it('frozen at module load (table + mapping + entries)', () => {
    expect(Object.isFrozen(S_BEST_CAT_HYDE_MS_2026_04_28_TABLE)).toBe(true);
    expect(Object.isFrozen(S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping)).toBe(true);
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping[category];
      expect(Object.isFrozen(key)).toBe(true);
    }
  });
});

describe('S_BEST_CAT_HYDE_MS_2026_04_28_TABLE: load-bearing calibration choices', () => {
  // The 85.6% canonical+RR Phase B headline (2026-04-28) shows MS at
  // 76.9% [69.2%, 84.6%] — the lowest per-category accuracy in the run
  // and the only category where the canonical retrieval config leaves
  // double-digit headroom. The S-tuned router hypothesis: switch MS
  // alone to HyDE while keeping every other category on canonical, on
  // the bet that paraphrase-rich multi-hop bridge queries benefit from
  // the wider hypothetical-document expansion. Phase A probe will
  // validate or refute.

  it('MS routes to retrievalConfig=hyde (the only weak category at S scale)', () => {
    expect(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping['multi-session'].retrievalConfig,
    ).toBe('hyde');
  });

  it('SSA routes to retrievalConfig=canonical (already 98.2% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping['single-session-assistant']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('SSU routes to retrievalConfig=canonical (already 94.3% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping['single-session-user'].retrievalConfig,
    ).toBe('canonical');
  });

  it('SSP routes to retrievalConfig=canonical (already 93.3% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping['single-session-preference']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('KU routes to retrievalConfig=canonical (already 92.3% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping['knowledge-update'].retrievalConfig,
    ).toBe('canonical');
  });

  it('TR routes to retrievalConfig=canonical (already 85.0% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping['temporal-reasoning'].retrievalConfig,
    ).toBe('canonical');
  });

  it('exactly one category deviates from canonical (the surgical-MS-only design)', () => {
    const deviations = MEMORY_QUERY_CATEGORIES.filter(
      (cat) =>
        S_BEST_CAT_HYDE_MS_2026_04_28_TABLE.defaultMapping[cat].retrievalConfig !== 'canonical',
    );
    expect(deviations).toEqual(['multi-session']);
  });
});

describe('AUGMENTED_PRESET_TABLES: S-tuned preset registration', () => {
  it('exposes s-best-cat-hyde-ms-2026-04-28 keyed by preset name', () => {
    expect(AUGMENTED_PRESET_TABLES['s-best-cat-hyde-ms-2026-04-28']).toBe(
      S_BEST_CAT_HYDE_MS_2026_04_28_TABLE,
    );
  });
});

describe('selectAugmentedDispatch: S-tuned table behavior', () => {
  it('returns hyde-canonical for MS through the S-tuned table', () => {
    const key = selectAugmentedDispatch('multi-session', S_BEST_CAT_HYDE_MS_2026_04_28_TABLE);
    expect(key.backend).toBe('canonical-hybrid');
    expect(key.retrievalConfig).toBe('hyde');
  });

  it('returns canonical for every non-MS category through the S-tuned table', () => {
    const nonMs = MEMORY_QUERY_CATEGORIES.filter((c) => c !== 'multi-session');
    for (const category of nonMs) {
      const key = selectAugmentedDispatch(category, S_BEST_CAT_HYDE_MS_2026_04_28_TABLE);
      expect(key.backend).toBe('canonical-hybrid');
      expect(key.retrievalConfig).toBe('canonical');
    }
  });
});

describe('S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE: structural completeness', () => {
  it('preset name matches the calibration date', () => {
    expect(S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.preset).toBe(
      's-best-cat-topk50-mult5-ms-2026-04-29',
    );
  });

  it('has a dispatch key for every known MemoryQueryCategory', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      expect(
        S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping[category],
      ).toBeDefined();
    }
  });

  it('every backend is canonical-hybrid (S Phase B 85.6% headline runs canonical end-to-end)', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping[category];
      expect(key.backend).toBe('canonical-hybrid');
    }
  });

  it('every retrievalConfig is a valid RetrievalConfigId', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping[category];
      expect(RETRIEVAL_CONFIG_IDS).toContain<RetrievalConfigId>(
        key.retrievalConfig as RetrievalConfigId,
      );
    }
  });

  it('frozen at module load (table + mapping + entries)', () => {
    expect(Object.isFrozen(S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE)).toBe(true);
    expect(Object.isFrozen(S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping)).toBe(true);
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping[category];
      expect(Object.isFrozen(key)).toBe(true);
    }
  });
});

describe('S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE: load-bearing calibration choices', () => {
  // Follows on from the refuted s-best-cat-hyde-ms-2026-04-28 HyDE
  // hypothesis (Phase A regressed MS to 22.2%). The new hypothesis:
  // S-scale MS bridge queries are pool-size-bound, not paraphrase-
  // bound. Anchored on the M Phase A ablation matrix: topk50-mult5
  // lifts M's MS canonical 18.0% → 44.4% without the hallucinated-
  // document noise that HyDE introduces.

  it('MS routes to retrievalConfig=topk50-mult5 (the wider rerank pool)', () => {
    expect(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping['multi-session'].retrievalConfig,
    ).toBe('topk50-mult5');
  });

  it('SSA routes to retrievalConfig=canonical (already 98.2% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping['single-session-assistant']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('SSU routes to retrievalConfig=canonical (already 94.3% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping['single-session-user']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('SSP routes to retrievalConfig=canonical (already 86.7% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping['single-session-preference']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('KU routes to retrievalConfig=canonical (already 91.0% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping['knowledge-update']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('TR routes to retrievalConfig=canonical (already 84.2% at canonical+RR)', () => {
    expect(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping['temporal-reasoning']
        .retrievalConfig,
    ).toBe('canonical');
  });

  it('exactly one category deviates from canonical (the surgical-MS-only design)', () => {
    const deviations = MEMORY_QUERY_CATEGORIES.filter(
      (cat) =>
        S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE.defaultMapping[cat].retrievalConfig !==
        'canonical',
    );
    expect(deviations).toEqual(['multi-session']);
  });
});

describe('AUGMENTED_PRESET_TABLES: topk50-mult5 S-tuned preset registration', () => {
  it('exposes s-best-cat-topk50-mult5-ms-2026-04-29 keyed by preset name', () => {
    expect(AUGMENTED_PRESET_TABLES['s-best-cat-topk50-mult5-ms-2026-04-29']).toBe(
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE,
    );
  });
});

describe('selectAugmentedDispatch: topk50-mult5 S-tuned table behavior', () => {
  it('returns topk50-mult5 retrieval config for MS through the topk50-mult5 S-tuned table', () => {
    const key = selectAugmentedDispatch(
      'multi-session',
      S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE,
    );
    expect(key.backend).toBe('canonical-hybrid');
    expect(key.retrievalConfig).toBe('topk50-mult5');
  });

  it('returns canonical for every non-MS category through the topk50-mult5 S-tuned table', () => {
    const nonMs = MEMORY_QUERY_CATEGORIES.filter((c) => c !== 'multi-session');
    for (const category of nonMs) {
      const key = selectAugmentedDispatch(category, S_BEST_CAT_TOPK50_MULT5_MS_2026_04_29_TABLE);
      expect(key.backend).toBe('canonical-hybrid');
      expect(key.retrievalConfig).toBe('canonical');
    }
  });
});

describe('selectAugmentedDispatch: pure selector contract', () => {
  it('returns the calibrated dispatch key for every known category', () => {
    for (const category of MEMORY_QUERY_CATEGORIES) {
      const key = selectAugmentedDispatch(category, MINIMIZE_COST_AUGMENTED_TABLE);
      expect(key).toBe(MINIMIZE_COST_AUGMENTED_TABLE.defaultMapping[category]);
    }
  });

  it('falls back to SAFE_FALLBACK_DISPATCH_KEY for an unknown category (defensive guard)', () => {
    const malformedTable = {
      preset: 'minimize-cost-augmented' as const,
      defaultMapping: {} as Record<MemoryQueryCategory, never>,
    };
    const key = selectAugmentedDispatch(
      'multi-session' as MemoryQueryCategory,
      malformedTable as unknown as typeof MINIMIZE_COST_AUGMENTED_TABLE,
    );
    expect(key).toBe(SAFE_FALLBACK_DISPATCH_KEY);
  });

  it('is deterministic across repeated calls (no hidden state)', () => {
    const a = selectAugmentedDispatch('multi-session', MINIMIZE_COST_AUGMENTED_TABLE);
    const b = selectAugmentedDispatch('multi-session', MINIMIZE_COST_AUGMENTED_TABLE);
    expect(a).toBe(b);
  });

  it('returns a frozen dispatch key (no mutation surface for callers)', () => {
    const key = selectAugmentedDispatch('multi-session', MINIMIZE_COST_AUGMENTED_TABLE);
    expect(Object.isFrozen(key)).toBe(true);
  });
});

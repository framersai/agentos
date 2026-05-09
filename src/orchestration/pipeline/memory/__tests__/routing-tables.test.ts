/**
 * @file routing-tables.test.ts
 * @description Contract tests for the three preset routing tables that
 * agentos's MemoryRouter ships with. The tables are calibrated from
 * Phase B N=500 LongMemEval-S measurements (per-tier per-category accuracy
 * + cost) and represent three distinct points on the cost-accuracy
 * Pareto frontier:
 *
 *   - minimize-cost: routes everything to the cheapest backend that
 *     Pareto-dominates the more expensive ones, only paying the OM
 *     premium where the architectural lift earns it (MS, SSP).
 *   - balanced: trades 1.6x cost for 10x latency reductions on KU/TR
 *     (where Tier 2a is tied accuracy at much lower latency).
 *   - maximize-accuracy: picks the highest-accuracy backend per category,
 *     ties broken by cost. v2 (post-Phase-B) routes TR back to canonical
 *     after Phase B revealed the v1 routing's accuracy gain was within CI.
 *
 * The tables MUST cover every {@link MemoryQueryCategory} (six categories;
 * a missing entry would cause selectBackend to throw at runtime). The
 * structures MUST be frozen so consumers cannot mutate the routing
 * surface from outside the module.
 *
 * @module memory-router/__tests__/routing-tables.test
 */

import { describe, it, expect } from 'vitest';
import {
  MINIMIZE_COST_TABLE,
  BALANCED_TABLE,
  MAXIMIZE_ACCURACY_TABLE,
  PRESET_TABLES,
  MEMORY_QUERY_CATEGORIES,
  type MemoryQueryCategory,
  type MemoryBackendId,
} from '../routing-tables.js';

const ALL_PRESETS = [
  ['minimize-cost', MINIMIZE_COST_TABLE],
  ['balanced', BALANCED_TABLE],
  ['maximize-accuracy', MAXIMIZE_ACCURACY_TABLE],
] as const;

describe('memory-router preset routing tables: each preset is well-formed', () => {
  it.each(ALL_PRESETS)(
    'preset %s carries its own preset name in the table object',
    (name, table) => {
      expect(table.preset).toBe(name);
    },
  );

  it.each(ALL_PRESETS)(
    'preset %s covers every MemoryQueryCategory in defaultMapping',
    (_name, table) => {
      for (const category of MEMORY_QUERY_CATEGORIES) {
        expect(table.defaultMapping[category as MemoryQueryCategory]).toBeDefined();
      }
    },
  );

  it.each(ALL_PRESETS)(
    'preset %s maps every category to a known MemoryBackendId',
    (_name, table) => {
      const validBackends: MemoryBackendId[] = [
        'canonical-hybrid',
        'observational-memory-v10',
        'observational-memory-v11',
      ];
      for (const category of MEMORY_QUERY_CATEGORIES) {
        const backend = table.defaultMapping[category as MemoryQueryCategory];
        expect(validBackends).toContain(backend);
      }
    },
  );

  it.each(ALL_PRESETS)(
    'preset %s defaultMapping is frozen',
    (_name, table) => {
      expect(Object.isFrozen(table)).toBe(true);
      expect(Object.isFrozen(table.defaultMapping)).toBe(true);
    },
  );
});

describe('memory-router PRESET_TABLES registry', () => {
  it('exposes all three presets keyed by name', () => {
    expect(PRESET_TABLES['minimize-cost']).toBe(MINIMIZE_COST_TABLE);
    expect(PRESET_TABLES['balanced']).toBe(BALANCED_TABLE);
    expect(PRESET_TABLES['maximize-accuracy']).toBe(MAXIMIZE_ACCURACY_TABLE);
  });
});

describe('memory-router minimize-cost table: load-bearing routing decisions', () => {
  it('routes multi-session to observational-memory-v11 (the +6.8pp architectural lift)', () => {
    expect(MINIMIZE_COST_TABLE.defaultMapping['multi-session']).toBe(
      'observational-memory-v11',
    );
  });

  it('routes single-session-preference to observational-memory-v11', () => {
    expect(MINIMIZE_COST_TABLE.defaultMapping['single-session-preference']).toBe(
      'observational-memory-v11',
    );
  });

  it.each([
    'single-session-assistant',
    'single-session-user',
    'temporal-reasoning',
    'knowledge-update',
  ] as MemoryQueryCategory[])(
    'routes %s to canonical-hybrid (cheapest Pareto-dominant)',
    (category) => {
      expect(MINIMIZE_COST_TABLE.defaultMapping[category]).toBe('canonical-hybrid');
    },
  );
});

describe('memory-router maximize-accuracy table: v2 update lessons', () => {
  it('routes temporal-reasoning to canonical-hybrid (v2 fix; v1 routed to v10 but Phase B showed within-CI accuracy at OM cost)', () => {
    expect(MAXIMIZE_ACCURACY_TABLE.defaultMapping['temporal-reasoning']).toBe(
      'canonical-hybrid',
    );
  });

  it('routes single-session-assistant to canonical-hybrid (Phase B Tier 1 wins on this category)', () => {
    expect(MAXIMIZE_ACCURACY_TABLE.defaultMapping['single-session-assistant']).toBe(
      'canonical-hybrid',
    );
  });

  it.each([
    'single-session-user',
    'single-session-preference',
    'multi-session',
    'knowledge-update',
  ] as MemoryQueryCategory[])(
    'routes %s to observational-memory-v11 (Phase B Tier 2b wins)',
    (category) => {
      expect(MAXIMIZE_ACCURACY_TABLE.defaultMapping[category]).toBe(
        'observational-memory-v11',
      );
    },
  );
});

describe('memory-router balanced table: trades cost for latency', () => {
  it('routes knowledge-update to observational-memory-v10 (lower latency at tied accuracy vs canonical)', () => {
    expect(BALANCED_TABLE.defaultMapping['knowledge-update']).toBe(
      'observational-memory-v10',
    );
  });

  it('routes temporal-reasoning to observational-memory-v10 (latency win over canonical)', () => {
    expect(BALANCED_TABLE.defaultMapping['temporal-reasoning']).toBe(
      'observational-memory-v10',
    );
  });

  it('routes multi-session to observational-memory-v11 (architectural lift on MS)', () => {
    expect(BALANCED_TABLE.defaultMapping['multi-session']).toBe(
      'observational-memory-v11',
    );
  });
});

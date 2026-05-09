/**
 * @file reader-router.test.ts
 * @description Contract tests for the ReaderRouter primitive — pinned
 * type contract, calibration data shape, selector behavior, and
 * registry invariants.
 *
 * Source data: 2026-04-28 LongMemEval-S Phase B N=500 per-category
 * accuracy split between gpt-4o and gpt-5-mini at the canonical-hybrid
 * retrieval stack (file header in `reader-router.ts` for the table).
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_COST_BEST_CAT_2026_04_28_TABLE,
  MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE,
  READER_ROUTER_PRESET_TABLES,
  ReaderRouterUnknownCategoryError,
  ReaderRouterUnknownPresetError,
  selectReader,
  type ReaderRouterPreset,
  type ReaderTier,
} from '../reader-router.js';
import {
  MEMORY_QUERY_CATEGORIES,
  type MemoryQueryCategory,
} from '../routing-tables.js';

const VALID_TIERS: readonly ReaderTier[] = ['gpt-4o', 'gpt-5', 'gpt-5-mini'] as const;

describe('selectReader: min-cost-best-cat-2026-04-28 calibration', () => {
  const PRESET: ReaderRouterPreset = 'min-cost-best-cat-2026-04-28';

  it('routes temporal-reasoning to gpt-4o (clear +11.8 pp accuracy lift)', () => {
    expect(selectReader('temporal-reasoning', PRESET)).toBe('gpt-4o');
  });

  it('routes single-session-user to gpt-4o (+4.3 pp accuracy lift)', () => {
    expect(selectReader('single-session-user', PRESET)).toBe('gpt-4o');
  });

  it('routes single-session-preference to gpt-5-mini (+23.4 pp lift, biggest single-category swing)', () => {
    expect(selectReader('single-session-preference', PRESET)).toBe('gpt-5-mini');
  });

  it('routes single-session-assistant to gpt-5-mini (tied accuracy, cheaper reader)', () => {
    expect(selectReader('single-session-assistant', PRESET)).toBe('gpt-5-mini');
  });

  it('routes knowledge-update to gpt-5-mini (tied accuracy, cheaper reader)', () => {
    expect(selectReader('knowledge-update', PRESET)).toBe('gpt-5-mini');
  });

  it('routes multi-session to gpt-5-mini (+3.5 pp accuracy lift, also cheaper)', () => {
    expect(selectReader('multi-session', PRESET)).toBe('gpt-5-mini');
  });
});

describe('selectReader: min-cost-best-cat-gpt5-tr-2026-04-29 calibration', () => {
  const PRESET: ReaderRouterPreset = 'min-cost-best-cat-gpt5-tr-2026-04-29';

  it('routes temporal-reasoning to gpt-5 (Phase A small-sample +4.2 pp PE vs gpt-4o)', () => {
    expect(selectReader('temporal-reasoning', PRESET)).toBe('gpt-5');
  });

  it('routes single-session-user to gpt-5 (Phase A small-sample lift over gpt-4o)', () => {
    expect(selectReader('single-session-user', PRESET)).toBe('gpt-5');
  });

  it('keeps single-session-preference on gpt-5-mini (gpt-5-mini was the +23.4 pp winner)', () => {
    expect(selectReader('single-session-preference', PRESET)).toBe('gpt-5-mini');
  });

  it('keeps single-session-assistant on gpt-5-mini (gpt-5-mini ties; cheaper)', () => {
    expect(selectReader('single-session-assistant', PRESET)).toBe('gpt-5-mini');
  });

  it('keeps knowledge-update on gpt-5-mini (gpt-5-mini ties; cheaper)', () => {
    expect(selectReader('knowledge-update', PRESET)).toBe('gpt-5-mini');
  });

  it('keeps multi-session on gpt-5-mini (gpt-5-mini was the +3.5 pp winner)', () => {
    expect(selectReader('multi-session', PRESET)).toBe('gpt-5-mini');
  });
});

describe('selectReader: error paths', () => {
  it('throws ReaderRouterUnknownPresetError on unknown preset', () => {
    expect(() =>
      selectReader('multi-session', 'not-a-preset' as ReaderRouterPreset),
    ).toThrow(ReaderRouterUnknownPresetError);
  });

  it('throws ReaderRouterUnknownCategoryError when a category is missing from the table', () => {
    // Cannot call selectReader with a bogus category through the type
    // system, but the runtime guard MUST fire if a future table
    // addition forgets a category. Simulate via a structural cast.
    expect(() =>
      selectReader(
        'not-a-category' as MemoryQueryCategory,
        'min-cost-best-cat-2026-04-28',
      ),
    ).toThrow(ReaderRouterUnknownCategoryError);
  });
});

describe('MIN_COST_BEST_CAT_2026_04_28_TABLE: completeness invariant', () => {
  it('covers all six MemoryQueryCategory values', () => {
    for (const cat of MEMORY_QUERY_CATEGORIES) {
      expect(MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping[cat]).toBeDefined();
    }
  });

  it('only references valid OpenAI reader tiers (gpt-4o or gpt-5-mini)', () => {
    for (const cat of MEMORY_QUERY_CATEGORIES) {
      const reader = MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping[cat];
      expect(['gpt-4o', 'gpt-5-mini']).toContain(reader);
    }
  });

  it('has the expected preset id', () => {
    expect(MIN_COST_BEST_CAT_2026_04_28_TABLE.preset).toBe(
      'min-cost-best-cat-2026-04-28',
    );
  });

  it('frozen at module load (table + mapping)', () => {
    expect(Object.isFrozen(MIN_COST_BEST_CAT_2026_04_28_TABLE)).toBe(true);
    expect(Object.isFrozen(MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping)).toBe(true);
  });
});

describe('MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE: completeness invariant', () => {
  it('covers all six MemoryQueryCategory values', () => {
    for (const cat of MEMORY_QUERY_CATEGORIES) {
      expect(MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE.mapping[cat]).toBeDefined();
    }
  });

  it('only references gpt-5 and gpt-5-mini reader tiers', () => {
    for (const cat of MEMORY_QUERY_CATEGORIES) {
      const reader = MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE.mapping[cat];
      expect(['gpt-5', 'gpt-5-mini']).toContain(reader);
    }
  });

  it('has the expected preset id', () => {
    expect(MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE.preset).toBe(
      'min-cost-best-cat-gpt5-tr-2026-04-29',
    );
  });

  it('replaces every gpt-4o pick from MIN_COST_BEST_CAT_2026_04_28 with gpt-5', () => {
    for (const cat of MEMORY_QUERY_CATEGORIES) {
      if (MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping[cat] === 'gpt-4o') {
        expect(MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE.mapping[cat]).toBe('gpt-5');
      } else {
        expect(MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE.mapping[cat]).toBe(
          MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping[cat],
        );
      }
    }
  });

  it('frozen at module load (table + mapping)', () => {
    expect(Object.isFrozen(MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE)).toBe(true);
    expect(Object.isFrozen(MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE.mapping)).toBe(true);
  });
});

describe('READER_ROUTER_PRESET_TABLES: registry', () => {
  it('exposes min-cost-best-cat-2026-04-28 keyed by preset name', () => {
    expect(READER_ROUTER_PRESET_TABLES['min-cost-best-cat-2026-04-28']).toBe(
      MIN_COST_BEST_CAT_2026_04_28_TABLE,
    );
  });

  it('exposes min-cost-best-cat-gpt5-tr-2026-04-29 keyed by preset name', () => {
    expect(READER_ROUTER_PRESET_TABLES['min-cost-best-cat-gpt5-tr-2026-04-29']).toBe(
      MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE,
    );
  });

  it('frozen at module load', () => {
    expect(Object.isFrozen(READER_ROUTER_PRESET_TABLES)).toBe(true);
  });

  it('every registered table only references valid reader tiers', () => {
    for (const preset of Object.keys(
      READER_ROUTER_PRESET_TABLES,
    ) as ReaderRouterPreset[]) {
      const table = READER_ROUTER_PRESET_TABLES[preset];
      for (const cat of MEMORY_QUERY_CATEGORIES) {
        expect(VALID_TIERS).toContain<ReaderTier>(table.mapping[cat]);
      }
    }
  });
});

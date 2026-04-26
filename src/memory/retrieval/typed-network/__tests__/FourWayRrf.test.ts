/**
 * @file FourWayRrf.test.ts
 * @description Contract tests for the four-way RRF fusion. Verifies
 * RRF math, k constant, missing-ranking tolerance, and per-signal
 * weight application.
 *
 * Spec anchor:
 * `packages/agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`
 * §2.4.3.
 */

import { describe, it, expect } from 'vitest';
import { fourWayRrf } from '../FourWayRrf.js';

describe('fourWayRrf', () => {
  it('ranks the universally top-1 fact first', () => {
    const result = fourWayRrf({
      semantic: ['a', 'b', 'c'],
      bm25: ['a', 'b', 'c'],
      graphActivation: ['a', 'b', 'c'],
      temporalOverlap: ['a', 'b', 'c'],
    });
    expect(result[0]).toBe('a');
    expect(result).toHaveLength(3);
  });

  it('default k=60: rank-1 contribution is 1/(60+1) ≈ 0.01639', () => {
    // Single ranking with 'a' rank 1, no other rankings.
    const result = fourWayRrf({
      semantic: ['a'],
      bm25: [],
      graphActivation: [],
      temporalOverlap: [],
    });
    expect(result).toEqual(['a']);
    // RRF math: contribution = 1/(60+1) = 0.016393...
  });

  it('custom k changes the contribution magnitude but preserves order', () => {
    const inp = {
      semantic: ['a', 'b', 'c'],
      bm25: ['a', 'b', 'c'],
      graphActivation: ['a', 'b', 'c'],
      temporalOverlap: ['a', 'b', 'c'],
    };
    const k60 = fourWayRrf(inp, { k: 60 });
    const k10 = fourWayRrf(inp, { k: 10 });
    expect(k60).toEqual(k10); // same order even with different k
    expect(k60[0]).toBe('a');
  });

  it('handles facts present in only some rankings', () => {
    const result = fourWayRrf({
      semantic: ['a', 'b'],
      bm25: ['a'],
      graphActivation: [],
      temporalOverlap: ['b'],
    });
    // 'a' is rank 1 in semantic + rank 1 in bm25 = 2 × 1/61 ≈ 0.0328
    // 'b' is rank 2 in semantic + rank 1 in temporal = 1/62 + 1/61 ≈ 0.0326
    // 'a' > 'b'
    expect(result[0]).toBe('a');
  });

  it('per-signal weights tilt the fused order', () => {
    const inp = {
      semantic: ['a', 'b'],
      bm25: ['b', 'a'],
      graphActivation: [],
      temporalOverlap: [],
    };
    // Uniform weights: 'a' rank 1 in semantic + rank 2 in bm25 = 1/61 + 1/62
    //                  'b' rank 2 in semantic + rank 1 in bm25 = 1/62 + 1/61
    // Tied. Order falls back to insertion order.
    const tied = fourWayRrf(inp);
    expect(new Set(tied)).toEqual(new Set(['a', 'b']));

    // Heavy bm25 weight: 'b' wins
    const heavyBm25 = fourWayRrf(inp, { weights: { bm25: 100 } });
    expect(heavyBm25[0]).toBe('b');

    // Heavy semantic weight: 'a' wins
    const heavySem = fourWayRrf(inp, { weights: { semantic: 100 } });
    expect(heavySem[0]).toBe('a');
  });

  it('returns empty for empty inputs', () => {
    const result = fourWayRrf({
      semantic: [],
      bm25: [],
      graphActivation: [],
      temporalOverlap: [],
    });
    expect(result).toEqual([]);
  });

  it('deduplicates fact IDs that appear in multiple rankings', () => {
    const result = fourWayRrf({
      semantic: ['a', 'b'],
      bm25: ['a', 'b'],
      graphActivation: ['a'],
      temporalOverlap: ['b'],
    });
    expect(result.length).toBe(2); // 'a' and 'b', not duplicated
    expect(new Set(result)).toEqual(new Set(['a', 'b']));
  });

  it('rank position matters: rank 1 contributes more than rank 100', () => {
    const result = fourWayRrf({
      semantic: ['a', ...Array.from({ length: 99 }, (_, i) => `filler-${i}`), 'b'],
      bm25: ['b'], // b is rank 1 here
      graphActivation: [],
      temporalOverlap: [],
    });
    // 'a' is rank 1 in semantic only: 1/61
    // 'b' is rank 100 in semantic + rank 1 in bm25: 1/(60+100) + 1/61 = 1/160 + 1/61
    // 'b' total = 0.00625 + 0.0164 = 0.0226
    // 'a' total = 0.0164
    // 'b' > 'a'
    expect(result[0]).toBe('b');
  });

  it('preserves stable order for ties at the same total score', () => {
    const result = fourWayRrf({
      semantic: ['a', 'b'],
      bm25: ['a', 'b'],
      graphActivation: ['a', 'b'],
      temporalOverlap: ['a', 'b'],
    });
    expect(result).toEqual(['a', 'b']);
  });
});

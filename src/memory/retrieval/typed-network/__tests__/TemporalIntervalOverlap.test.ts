/**
 * @file TemporalIntervalOverlap.test.ts
 * @description Contract tests for {@link rankByTemporalOverlap}.
 * Asserts the 1/(1+days) scoring form, the in-interval vs out-of-
 * interval branching, and the mention-timestamp fallback.
 *
 * Spec anchor:
 * `packages/agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`
 * §2.4.1 (temporal edge weight).
 */

import { describe, it, expect } from 'vitest';
import { rankByTemporalOverlap } from '../TemporalIntervalOverlap.js';
import type { TypedFact } from '../types.js';

function makeFact(id: string, start: string, end: string, mention?: string): TypedFact {
  return {
    id,
    bank: 'WORLD',
    text: id,
    embedding: [],
    temporal: { start, end, mention: mention ?? start },
    participants: [],
    reasoningMarkers: [],
    entities: [],
    confidence: 1.0,
  };
}

function makeMentionOnlyFact(id: string, mention: string): TypedFact {
  return {
    id,
    bank: 'WORLD',
    text: id,
    embedding: [],
    temporal: { mention },
    participants: [],
    reasoningMarkers: [],
    entities: [],
    confidence: 1.0,
  };
}

describe('rankByTemporalOverlap', () => {
  it('ranks facts containing the query timestamp higher than facts that do not', () => {
    const facts: TypedFact[] = [
      makeFact('a', '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z'),
      makeFact('b', '2026-04-01T00:00:00Z', '2026-04-30T00:00:00Z'),
      makeFact('c', '2026-03-01T00:00:00Z', '2026-05-31T00:00:00Z'),
    ];
    const ranked = rankByTemporalOverlap(facts, '2026-04-15T00:00:00Z');
    expect(ranked[0].id).toBe('b'); // tightest interval that contains the query
    expect(ranked[1].id).toBe('c'); // wider interval that contains the query
    expect(ranked[2].id).toBe('a'); // does not contain the query
  });

  it('within-interval facts: tighter interval scores higher', () => {
    const facts: TypedFact[] = [
      makeFact('wide', '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'),
      makeFact('narrow', '2026-04-14T00:00:00Z', '2026-04-16T00:00:00Z'),
    ];
    const ranked = rankByTemporalOverlap(facts, '2026-04-15T00:00:00Z');
    expect(ranked[0].id).toBe('narrow');
  });

  it('out-of-interval facts: closer endpoint scores higher', () => {
    const facts: TypedFact[] = [
      makeFact('far', '2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z'),
      makeFact('near', '2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z'),
    ];
    const ranked = rankByTemporalOverlap(facts, '2026-04-15T00:00:00Z');
    expect(ranked[0].id).toBe('near');
    expect(ranked[1].id).toBe('far');
  });

  it('handles facts with mention timestamp only (no interval)', () => {
    const facts: TypedFact[] = [
      makeMentionOnlyFact('a', '2026-01-01T00:00:00Z'),
      makeMentionOnlyFact('b', '2026-04-15T00:00:00Z'),
      makeMentionOnlyFact('c', '2026-04-14T00:00:00Z'),
    ];
    const ranked = rankByTemporalOverlap(facts, '2026-04-15T00:00:00Z');
    expect(ranked[0].id).toBe('b'); // exact match
    expect(ranked[1].id).toBe('c'); // 1 day off
    expect(ranked[2].id).toBe('a'); // months off
  });

  it('returns input array order on invalid query timestamp', () => {
    const facts: TypedFact[] = [
      makeMentionOnlyFact('a', '2026-04-15T00:00:00Z'),
      makeMentionOnlyFact('b', '2026-04-16T00:00:00Z'),
    ];
    const ranked = rankByTemporalOverlap(facts, 'not-a-date');
    expect(ranked.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const original: TypedFact[] = [
      makeMentionOnlyFact('a', '2026-01-01T00:00:00Z'),
      makeMentionOnlyFact('b', '2026-04-15T00:00:00Z'),
    ];
    const inputIds = original.map((f) => f.id);
    rankByTemporalOverlap(original, '2026-04-15T00:00:00Z');
    expect(original.map((f) => f.id)).toEqual(inputIds);
  });

  it('empty input returns empty array', () => {
    expect(rankByTemporalOverlap([], '2026-04-15T00:00:00Z')).toEqual([]);
  });
});

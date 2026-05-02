import { describe, it, expect } from 'vitest';
import {
  createEmptyUsageAggregate,
  accumulateUsage,
  mergeAggregates,
} from '../usageAccumulator.js';

describe('createEmptyUsageAggregate', () => {
  it('returns an all-zero aggregate', () => {
    const a = createEmptyUsageAggregate();
    expect(a).toEqual({
      sessionId: undefined,
      personaId: undefined,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUSD: 0,
      calls: 0,
    });
  });

  it('seeds the sessionId when provided', () => {
    expect(createEmptyUsageAggregate('s-42').sessionId).toBe('s-42');
  });
});

describe('accumulateUsage', () => {
  it('is a no-op when usage is undefined', () => {
    const target = createEmptyUsageAggregate();
    accumulateUsage(target, undefined);
    expect(target).toEqual(createEmptyUsageAggregate());
  });

  it('adds prompt + completion + total tokens and increments calls', () => {
    const target = createEmptyUsageAggregate();
    accumulateUsage(target, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    expect(target.promptTokens).toBe(100);
    expect(target.completionTokens).toBe(50);
    expect(target.totalTokens).toBe(150);
    expect(target.calls).toBe(1);
  });

  it('synthesises totalTokens from prompt + completion when source omits it', () => {
    const target = createEmptyUsageAggregate();
    accumulateUsage(target, { promptTokens: 80, completionTokens: 20 });
    expect(target.totalTokens).toBe(100);
  });

  it('accumulates cost when present and ignores it when absent', () => {
    const target = createEmptyUsageAggregate();
    accumulateUsage(target, { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUSD: 0.0012 });
    accumulateUsage(target, { promptTokens: 10, completionTokens: 5, totalTokens: 15 }); // no costUSD
    expect(target.costUSD).toBeCloseTo(0.0012);
    expect(target.calls).toBe(2);
  });

  it('folds many calls without losing precision', () => {
    const target = createEmptyUsageAggregate();
    for (let i = 0; i < 100; i++) {
      accumulateUsage(target, { promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    }
    expect(target.totalTokens).toBe(1000);
    expect(target.calls).toBe(100);
  });
});

describe('mergeAggregates', () => {
  it('sums all numeric fields', () => {
    const a = { sessionId: undefined, personaId: undefined, promptTokens: 10, completionTokens: 5, totalTokens: 15, costUSD: 0.01, calls: 1 };
    const b = { sessionId: undefined, personaId: undefined, promptTokens: 20, completionTokens: 8, totalTokens: 28, costUSD: 0.02, calls: 2 };
    expect(mergeAggregates(a, b)).toEqual({
      sessionId: undefined,
      personaId: undefined,
      promptTokens: 30,
      completionTokens: 13,
      totalTokens: 43,
      costUSD: 0.03,
      calls: 3,
    });
  });

  it('prefers a.sessionId / a.personaId over b when set', () => {
    const a = createEmptyUsageAggregate('a-session');
    const b = createEmptyUsageAggregate('b-session');
    expect(mergeAggregates(a, b).sessionId).toBe('a-session');
  });

  it('falls back to b.sessionId when a has none', () => {
    const a = createEmptyUsageAggregate();
    const b = createEmptyUsageAggregate('b-session');
    expect(mergeAggregates(a, b).sessionId).toBe('b-session');
  });

  it('does not mutate either input', () => {
    const a = createEmptyUsageAggregate('a');
    const b = createEmptyUsageAggregate('b');
    const aSnap = JSON.stringify(a);
    const bSnap = JSON.stringify(b);
    mergeAggregates(a, b);
    expect(JSON.stringify(a)).toBe(aSnap);
    expect(JSON.stringify(b)).toBe(bSnap);
  });
});

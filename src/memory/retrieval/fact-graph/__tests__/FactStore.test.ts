import { describe, it, expect } from 'vitest';
import { FactStore } from '../FactStore.js';
import type { Fact } from '../types.js';

function f(subject: string, predicate: string, object: string, ts: number): Fact {
  return {
    subject,
    predicate,
    object,
    timestamp: ts,
    sourceTraceIds: [`trace-${ts}`],
    sourceSpan: `${subject} ${predicate} ${object}`,
  };
}

describe('FactStore', () => {
  it('upserts and returns the latest fact per (subject, predicate)', () => {
    const store = new FactStore();
    store.upsert('user', 'bench', [f('user', 'livesIn', 'NYC', 1)]);
    store.upsert('user', 'bench', [f('user', 'livesIn', 'Berlin', 2)]);
    expect(store.getLatest('user', 'bench', 'user', 'livesIn')?.object).toBe('Berlin');
  });

  it('returns time-sorted ascending list for getAllTimeOrdered', () => {
    const store = new FactStore();
    store.upsert('user', 'bench', [f('user', 'livesIn', 'NYC', 2)]);
    store.upsert('user', 'bench', [f('user', 'livesIn', 'Berlin', 3)]);
    store.upsert('user', 'bench', [f('user', 'livesIn', 'Boston', 1)]);
    const all = store.getAllTimeOrdered('user', 'bench', 'user');
    expect(all.map((x) => x.object)).toEqual(['Boston', 'NYC', 'Berlin']);
  });

  it('isolates facts across (scope, scopeId) pairs', () => {
    const store = new FactStore();
    store.upsert('user', 'u1', [f('user', 'prefers', 'tea', 1)]);
    store.upsert('user', 'u2', [f('user', 'prefers', 'coffee', 1)]);
    expect(store.getLatest('user', 'u1', 'user', 'prefers')?.object).toBe('tea');
    expect(store.getLatest('user', 'u2', 'user', 'prefers')?.object).toBe('coffee');
  });

  it('canonicalizes subjects on upsert (I → user)', () => {
    const store = new FactStore();
    store.upsert('user', 'bench', [f('I', 'prefers', 'tea', 1)]);
    expect(store.getLatest('user', 'bench', 'user', 'prefers')?.object).toBe('tea');
    expect(store.getLatest('user', 'bench', 'I', 'prefers')?.object).toBe('tea');
  });

  it('drops facts with predicates outside the closed schema', () => {
    const store = new FactStore();
    store.upsert('user', 'bench', [f('user', 'mentioned', 'something', 1)]);
    expect(store.getAllTimeOrdered('user', 'bench', 'user')).toEqual([]);
  });

  it('getLatest returns null for predicates outside the schema', () => {
    const store = new FactStore();
    store.upsert('user', 'bench', [f('user', 'prefers', 'tea', 1)]);
    expect(store.getLatest('user', 'bench', 'user', 'mentioned')).toBeNull();
  });

  it('getLatest returns null for missing (subject, predicate)', () => {
    const store = new FactStore();
    expect(store.getLatest('user', 'bench', 'user', 'livesIn')).toBeNull();
  });
});

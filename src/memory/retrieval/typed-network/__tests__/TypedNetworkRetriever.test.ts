/**
 * @file TypedNetworkRetriever.test.ts
 * @description Contract tests for the TypedNetworkRetriever adapter.
 * Pin: query-entity extraction (regex), seed-set construction (entity
 * intersection), spreading-activation order, and ScoredMemoryTrace
 * shape coming out of typedFactToScoredTrace.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TypedNetworkRetriever,
  extractQueryEntities,
  typedFactToScoredTrace,
} from '../TypedNetworkRetriever.js';
import { TypedNetworkStore } from '../TypedNetworkStore.js';
import { TypedSpreadingActivation } from '../TypedSpreadingActivation.js';
import type { TypedFact, BankId } from '../types.js';

function makeFact(
  id: string,
  text: string,
  entities: string[],
  bank: BankId = 'WORLD',
  mention = '2026-04-26T10:00:00Z',
): TypedFact {
  return {
    id,
    bank,
    text,
    embedding: [],
    temporal: { mention },
    participants: [],
    reasoningMarkers: [],
    entities,
    confidence: 1.0,
  };
}

describe('extractQueryEntities', () => {
  it('extracts capitalized proper nouns ≥ 3 chars', () => {
    expect(extractQueryEntities('Where does Alice live?')).toEqual(['Where', 'Alice']);
    expect(extractQueryEntities('I deployed Docker yesterday')).toEqual(['Docker']);
  });

  it('extracts double-quoted strings', () => {
    const out = extractQueryEntities('Find the "deployment server" config');
    expect(out).toContain('deployment server');
  });

  it('extracts single-quoted strings', () => {
    const out = extractQueryEntities("She said 'hello world' to me");
    expect(out).toContain('hello world');
  });

  it('deduplicates entities', () => {
    const out = extractQueryEntities('Berlin Berlin Berlin');
    expect(out).toEqual(['Berlin']);
  });

  it('returns empty for queries with no proper nouns or quotes', () => {
    expect(extractQueryEntities('what time is it')).toEqual([]);
    expect(extractQueryEntities('a b c')).toEqual([]);
  });
});

describe('typedFactToScoredTrace', () => {
  it('produces a valid ScoredMemoryTrace shape', () => {
    const fact = makeFact('f1', 'Berlin is in Germany', ['Berlin', 'Germany']);
    const trace = typedFactToScoredTrace(fact, 0.75, { scope: 'user', scopeId: 'bench' });
    expect(trace.id).toBe('typed-network:f1');
    expect(trace.type).toBe('semantic');
    expect(trace.scope).toBe('user');
    expect(trace.scopeId).toBe('bench');
    expect(trace.content).toBe('[WORLD] Berlin is in Germany');
    expect(trace.retrievalScore).toBe(0.75);
    expect(trace.provenance.sourceType).toBe('typed_network');
    expect(trace.tags).toContain('typed-network');
    expect(trace.tags).toContain('bank:WORLD');
    expect(trace.entities).toEqual(['Berlin', 'Germany']);
    expect(trace.scoreBreakdown.graphActivationScore).toBe(0.75);
  });

  it('includes bank label in content for reader disambiguation', () => {
    const fact = makeFact('f2', 'I prefer TypeScript', ['TypeScript'], 'OPINION');
    const trace = typedFactToScoredTrace(fact, 0.5, { scope: 'user', scopeId: 'b' });
    expect(trace.content.startsWith('[OPINION]')).toBe(true);
  });

  it('uses fact mention timestamp for lifecycle fields', () => {
    const fact = makeFact('f3', 'X', [], 'WORLD', '2026-01-01T00:00:00Z');
    const trace = typedFactToScoredTrace(fact, 1.0, { scope: 'user', scopeId: 'b' });
    expect(trace.lastAccessedAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(trace.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('falls back to current time on invalid mention timestamp', () => {
    const fact = makeFact('f4', 'X', [], 'WORLD', 'not-a-date');
    const before = Date.now();
    const trace = typedFactToScoredTrace(fact, 1.0, { scope: 'user', scopeId: 'b' });
    const after = Date.now();
    expect(trace.lastAccessedAt).toBeGreaterThanOrEqual(before);
    expect(trace.lastAccessedAt).toBeLessThanOrEqual(after);
  });
});

describe('TypedNetworkRetriever.retrieve', () => {
  let store: TypedNetworkStore;
  let spreading: TypedSpreadingActivation;
  let retriever: TypedNetworkRetriever;

  beforeEach(() => {
    store = new TypedNetworkStore();
    spreading = new TypedSpreadingActivation({ decay: 0.5 });
    retriever = new TypedNetworkRetriever({ store, spreading });
  });

  it('returns empty array when query has no entities', async () => {
    store.addFact(makeFact('f1', 'X', ['Berlin']));
    const out = await retriever.retrieve('what time is it', {
      topK: 5,
      scope: { scope: 'user', scopeId: 'b' },
    });
    expect(out).toEqual([]);
  });

  it('returns empty array when no facts match query entities', async () => {
    store.addFact(makeFact('f1', 'X', ['Berlin']));
    const out = await retriever.retrieve('Where is Tokyo?', {
      topK: 5,
      scope: { scope: 'user', scopeId: 'b' },
    });
    expect(out).toEqual([]);
  });

  it('returns matching facts ordered by spreading-activation level', async () => {
    store.addFact(makeFact('f1', 'A', ['Berlin']));
    store.addFact(makeFact('f2', 'B', ['Germany']));
    store.addFact(makeFact('f3', 'C', ['Other']));
    // f1 is the seed (entity match); f2 connected via entity edge.
    store.addEdge({ fromFactId: 'f1', toFactId: 'f2', kind: 'entity', weight: 1.0 });
    const out = await retriever.retrieve('Where is Berlin?', {
      topK: 5,
      scope: { scope: 'user', scopeId: 'b' },
    });
    // f1 is seed (activation 1.0); f2 is 1-hop entity (activation 0.5).
    // f3 has no edges, so no activation.
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('typed-network:f1');
    expect(out[0].retrievalScore).toBe(1.0);
    expect(out[1].id).toBe('typed-network:f2');
    expect(out[1].retrievalScore).toBe(0.5);
  });

  it('case-insensitive entity matching', async () => {
    store.addFact(makeFact('f1', 'X', ['BERLIN'])); // uppercase in fact
    const out = await retriever.retrieve('where is berlin', {
      // lowercase in query — should still match
      topK: 5,
      scope: { scope: 'user', scopeId: 'b' },
      queryEntities: ['berlin'],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('typed-network:f1');
  });

  it('respects topK cutoff', async () => {
    for (let i = 0; i < 10; i++) {
      store.addFact(makeFact(`f${i}`, `X${i}`, ['Berlin']));
    }
    const out = await retriever.retrieve('Where is Berlin?', {
      topK: 3,
      scope: { scope: 'user', scopeId: 'b' },
    });
    expect(out).toHaveLength(3);
  });

  it('accepts explicit queryEntities to skip regex extraction', async () => {
    store.addFact(makeFact('f1', 'X', ['custom-entity-name']));
    const out = await retriever.retrieve('any text', {
      topK: 5,
      scope: { scope: 'user', scopeId: 'b' },
      queryEntities: ['custom-entity-name'],
    });
    expect(out).toHaveLength(1);
  });
});

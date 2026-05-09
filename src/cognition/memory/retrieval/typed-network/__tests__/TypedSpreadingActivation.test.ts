/**
 * @file TypedSpreadingActivation.test.ts
 * @description Contract tests pinning Eq. 12 numerics and traversal
 * semantics. Tests typed-edge multipliers, max-aggregation across
 * paths, depth cutoffs, and threshold pruning.
 *
 * Spec anchor:
 * `packages/agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`
 * §2.4.1 (Equation 12).
 */

import { describe, it, expect } from 'vitest';
import {
  TypedSpreadingActivation,
  DEFAULT_EDGE_MULTIPLIERS,
} from '../TypedSpreadingActivation.js';
import { TypedNetworkStore } from '../TypedNetworkStore.js';
import type { TypedFact, BankId } from '../types.js';

function makeFact(id: string, bank: BankId = 'WORLD'): TypedFact {
  return {
    id,
    bank,
    text: id,
    embedding: [],
    temporal: { mention: '2026-04-26T10:00:00Z' },
    participants: [],
    reasoningMarkers: [],
    entities: [],
    confidence: 1.0,
  };
}

describe('TypedSpreadingActivation Eq. 12', () => {
  it('seeds activate at 1.0', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    expect(result.get('a')).toBe(1.0);
  });

  it('multiple seeds all activate at 1.0', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a', 'b'], { maxDepth: 3 });
    expect(result.get('a')).toBe(1.0);
    expect(result.get('b')).toBe(1.0);
  });

  it('entity edge: μ=1.0, decay=0.5 → 1-hop activation = 0.5', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'entity', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    // a=1.0 (seed), b = 1.0 × 1.0 × 0.5 × 1.0 = 0.5
    expect(result.get('b')).toBe(0.5);
  });

  it('temporal edge: weight 0.8, decay 0.5, μ=0.7 → activation 0.28', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'temporal', weight: 0.8 });
    const act = new TypedSpreadingActivation({
      decay: 0.5,
      edgeMultipliers: { temporal: 0.7, semantic: 0.6, entity: 1.0, causal: 1.0 },
    });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    // b = 1.0 × 0.8 × 0.5 × 0.7 = 0.28
    expect(result.get('b')).toBeCloseTo(0.28, 5);
  });

  it('semantic edge uses default μ=0.6', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'semantic', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    // 1.0 × 1.0 × 0.5 × 0.6 = 0.30
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    expect(result.get('b')).toBeCloseTo(0.30, 5);
  });

  it('causal edge uses default μ=1.0 (full strength)', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'causal', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    // 1.0 × 1.0 × 0.5 × 1.0 = 0.50
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    expect(result.get('b')).toBeCloseTo(0.50, 5);
  });

  it('respects maxDepth cutoff: depth=1 reaches only 1 hop', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addFact(makeFact('c'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'entity', weight: 1.0 });
    store.addEdge({ fromFactId: 'b', toFactId: 'c', kind: 'entity', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 1 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false); // 2 hops away, cutoff at 1
  });

  it('depth=3 reaches 3 hops away', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addFact(makeFact('c'));
    store.addFact(makeFact('d'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'entity', weight: 1.0 });
    store.addEdge({ fromFactId: 'b', toFactId: 'c', kind: 'entity', weight: 1.0 });
    store.addEdge({ fromFactId: 'c', toFactId: 'd', kind: 'entity', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 3, activationThreshold: 0.0001 });
    expect(result.has('d')).toBe(true);
    // 3 hops × 0.5 decay × 1.0 μ entity × 1.0 weight = 0.125
    expect(result.get('d')).toBeCloseTo(0.125, 5);
  });

  it('activation threshold prunes weak paths', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'semantic', weight: 0.1 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    // 1.0 × 0.1 × 0.5 × 0.6 = 0.03 < default threshold 0.05
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    expect(result.has('b')).toBe(false);
  });

  it('max-aggregate keeps the strongest of multiple paths into the same node', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addFact(makeFact('c'));
    // Path 1: a → c via semantic (μ=0.6, weight 1.0): 0.30
    store.addEdge({ fromFactId: 'a', toFactId: 'c', kind: 'semantic', weight: 1.0 });
    // Path 2: a → b → c via entity twice: hop1=0.5, hop2=0.25
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'entity', weight: 1.0 });
    store.addEdge({ fromFactId: 'b', toFactId: 'c', kind: 'entity', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5, edgeMultipliers: DEFAULT_EDGE_MULTIPLIERS });
    const result = act.spread(store, ['a'], { maxDepth: 3, activationThreshold: 0.01 });
    // Direct semantic path is 0.30; via b path is 0.25. Max = 0.30.
    expect(result.get('c')).toBeCloseTo(0.30, 5);
  });

  it('returns just the seeds when graph has no edges', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    expect(result.size).toBe(1);
    expect(result.get('a')).toBe(1.0);
  });

  it('DEFAULT_EDGE_MULTIPLIERS exposes the per-kind defaults', () => {
    expect(DEFAULT_EDGE_MULTIPLIERS.entity).toBe(1.0);
    expect(DEFAULT_EDGE_MULTIPLIERS.causal).toBe(1.0);
    expect(DEFAULT_EDGE_MULTIPLIERS.temporal).toBe(0.7);
    expect(DEFAULT_EDGE_MULTIPLIERS.semantic).toBe(0.6);
  });
});

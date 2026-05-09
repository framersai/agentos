/**
 * @file types.test.ts
 * @description Contract tests for the Hindsight 4-network type module.
 * Pin BankId tuple shape, isBankId narrowing semantics, and TypedFact
 * required-field invariants. These are compile-time-leaning checks; the
 * runtime assertions enforce the invariants the rest of the module
 * relies on.
 *
 * Spec anchor:
 * `packages/agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`
 * §2.1-§2.2.
 */

import { describe, it, expect } from 'vitest';
import {
  BANK_IDS,
  EDGE_KINDS,
  type BankId,
  type EdgeKind,
  type TypedFact,
  type TypedEdge,
  isBankId,
} from '../types.js';

describe('typed-network types', () => {
  it('BANK_IDS contains exactly the 4 typed banks per Hindsight §2.2', () => {
    expect(BANK_IDS).toEqual(['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION']);
    expect(BANK_IDS).toHaveLength(4);
  });

  it('EDGE_KINDS contains the 4 link types per Hindsight §2.4.1', () => {
    expect(EDGE_KINDS).toEqual(['temporal', 'semantic', 'entity', 'causal']);
    expect(EDGE_KINDS).toHaveLength(4);
  });

  it('isBankId narrows correctly for valid banks', () => {
    expect(isBankId('WORLD')).toBe(true);
    expect(isBankId('EXPERIENCE')).toBe(true);
    expect(isBankId('OPINION')).toBe(true);
    expect(isBankId('OBSERVATION')).toBe(true);
  });

  it('isBankId rejects unknown bank labels', () => {
    expect(isBankId('NONSENSE')).toBe(false);
    expect(isBankId('world')).toBe(false); // case-sensitive
    expect(isBankId('')).toBe(false);
    expect(isBankId('WORLDS')).toBe(false);
  });

  it('TypedFact carries every Equation 1 field', () => {
    const fact: TypedFact = {
      id: 'session-1-fact-0',
      bank: 'WORLD',
      text: 'Berlin is in Germany',
      embedding: [0.1, 0.2, 0.3],
      temporal: {
        start: '2026-04-26T00:00:00Z',
        end: '2026-04-26T00:00:00Z',
        mention: '2026-04-26T10:30:00Z',
      },
      participants: [],
      reasoningMarkers: [],
      entities: ['Berlin', 'Germany'],
      confidence: 1.0,
    };
    expect(fact.bank).toBe('WORLD');
    expect(fact.entities).toContain('Berlin');
    expect(fact.confidence).toBe(1.0);
  });

  it('TypedFact accepts optional metadata for source provenance', () => {
    const fact: TypedFact = {
      id: 's2-fact-0',
      bank: 'EXPERIENCE',
      text: 'I helped the user debug a Docker issue',
      embedding: [],
      temporal: { mention: '2026-04-26T10:30:00Z' },
      participants: [{ name: 'user', role: 'subject' }],
      reasoningMarkers: [],
      entities: ['Docker'],
      confidence: 1.0,
      metadata: { sourceTurn: 12, sessionId: 's2' },
    };
    expect(fact.metadata?.sourceTurn).toBe(12);
  });

  it('TypedEdge has source, target, kind, and weight', () => {
    const edge: TypedEdge = {
      fromFactId: 'f1',
      toFactId: 'f2',
      kind: 'entity',
      weight: 1.0,
    };
    expect(edge.kind).toBe('entity');
    expect(edge.weight).toBe(1.0);
  });

  it('all EdgeKind values pass type-narrowing', () => {
    const kinds: EdgeKind[] = ['temporal', 'semantic', 'entity', 'causal'];
    for (const k of kinds) {
      // Compile-time: this assignment must type-check
      const edge: TypedEdge = { fromFactId: 'a', toFactId: 'b', kind: k, weight: 1.0 };
      expect(edge.kind).toBe(k);
    }
  });

  it('all BankId values are routable', () => {
    const banks: BankId[] = ['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION'];
    for (const b of banks) {
      expect(isBankId(b)).toBe(true);
    }
  });
});

/**
 * @file EntityRetrievalRanker.test.ts
 * @description Tests for the recall-stage re-ranker that boosts
 * candidates with overlapping entities to the query (Stage I,
 * Mem0-v3-style).
 */

import { describe, it, expect } from 'vitest';
import { EntityRetrievalRanker } from '../EntityRetrievalRanker.js';

describe('EntityRetrievalRanker', () => {
  it('boosts candidates with overlapping entities at the default weight', () => {
    const ranker = new EntityRetrievalRanker({ entityWeight: 0.5 });
    const ranked = ranker.rank('Tell me about Anthropic', [
      { id: 'c1', text: 'Anthropic released Claude.', semanticScore: 0.5, entities: ['Anthropic', 'Claude'] },
      { id: 'c2', text: 'OpenAI released GPT.', semanticScore: 0.6, entities: ['OpenAI', 'GPT'] },
    ]);
    expect(ranked[0].id).toBe('c1');
    expect(ranked[0].entityOverlap).toBe(1);
    expect(ranked[1].entityOverlap).toBe(0);
  });

  it('falls back to semanticScore when no entity overlap on either candidate', () => {
    const ranker = new EntityRetrievalRanker({ entityWeight: 0.5 });
    const ranked = ranker.rank('How does it work?', [
      { id: 'c1', text: 'X', semanticScore: 0.3, entities: [] },
      { id: 'c2', text: 'Y', semanticScore: 0.7, entities: [] },
    ]);
    expect(ranked[0].id).toBe('c2');
  });

  it('preserves all candidate fields plus combinedScore + entityOverlap', () => {
    const ranker = new EntityRetrievalRanker({ entityWeight: 0.5 });
    const ranked = ranker.rank('about Apple', [
      { id: 'c1', text: 'Apple released iPhone.', semanticScore: 0.5, entities: ['Apple', 'iPhone'] },
    ]);
    expect(ranked[0].id).toBe('c1');
    expect(ranked[0].text).toBe('Apple released iPhone.');
    expect(ranked[0].semanticScore).toBe(0.5);
    expect(ranked[0].entities).toEqual(['Apple', 'iPhone']);
    expect(ranked[0].combinedScore).toBeGreaterThan(0);
    expect(ranked[0].entityOverlap).toBe(1);
  });

  it('handles entityWeight=0 (pure semantic) correctly', () => {
    const ranker = new EntityRetrievalRanker({ entityWeight: 0 });
    const ranked = ranker.rank('Anthropic Claude', [
      { id: 'c1', text: 'low semantic', semanticScore: 0.2, entities: ['Anthropic', 'Claude'] },
      { id: 'c2', text: 'high semantic', semanticScore: 0.9, entities: [] },
    ]);
    // entityWeight=0 means semantic dominates
    expect(ranked[0].id).toBe('c2');
  });

  it('handles entityWeight=1 (pure entity overlap) correctly', () => {
    const ranker = new EntityRetrievalRanker({ entityWeight: 1 });
    const ranked = ranker.rank('Anthropic', [
      { id: 'c1', text: 'high semantic but no entity', semanticScore: 0.9, entities: [] },
      { id: 'c2', text: 'low semantic but matches entity', semanticScore: 0.1, entities: ['Anthropic'] },
    ]);
    expect(ranked[0].id).toBe('c2');
  });

  it('returns empty array on empty candidate list', () => {
    const ranker = new EntityRetrievalRanker({ entityWeight: 0.5 });
    const ranked = ranker.rank('any query', []);
    expect(ranked).toEqual([]);
  });
});

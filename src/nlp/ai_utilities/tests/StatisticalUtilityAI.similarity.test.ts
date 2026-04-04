/**
 * @fileoverview Tests for StatisticalUtilityAI text similarity methods.
 * Validates jaccard, cosine_tfidf, and levenshtein similarity calculations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StatisticalUtilityAI } from '../StatisticalUtilityAI';

let util: StatisticalUtilityAI;

beforeEach(async () => {
  util = new StatisticalUtilityAI('test-stat');
  await util.initialize({ utilityId: 'test-stat', defaultLanguage: 'en' });
});

describe('calculateSimilarity — jaccard', () => {
  const method = 'jaccard' as const;

  it('returns ~1.0 for identical texts', async () => {
    const score = await util.calculateSimilarity(
      'the quick brown fox',
      'the quick brown fox',
      { method },
    );
    expect(score).toBeGreaterThanOrEqual(0.99);
  });

  it('returns ~0.0 for completely different texts', async () => {
    const score = await util.calculateSimilarity(
      'astronomy telescope galaxy nebula',
      'cooking recipe kitchen spatula',
      { method, removeStopWords: true },
    );
    expect(score).toBeLessThanOrEqual(0.1);
  });

  it('returns intermediate score for partially overlapping texts', async () => {
    const score = await util.calculateSimilarity(
      'the brave knight drew his sword',
      'the knight sharpened his blade',
      { method },
    );
    expect(score).toBeGreaterThan(0.0);
    expect(score).toBeLessThan(1.0);
  });
});

describe('calculateSimilarity — cosine_tfidf', () => {
  const method = 'cosine_tfidf' as const;

  it('returns ~1.0 for identical texts', async () => {
    const score = await util.calculateSimilarity(
      'machine learning algorithms process data',
      'machine learning algorithms process data',
      { method },
    );
    expect(score).toBeGreaterThanOrEqual(0.99);
  });

  it('returns ~0.0 for completely different texts', async () => {
    const score = await util.calculateSimilarity(
      'astronomy telescope galaxy nebula',
      'cooking recipe kitchen spatula',
      { method, removeStopWords: true },
    );
    expect(score).toBeLessThanOrEqual(0.15);
  });

  it('returns intermediate score for partially overlapping texts', async () => {
    const score = await util.calculateSimilarity(
      'natural language processing is fascinating',
      'natural language understanding remains challenging',
      { method },
    );
    expect(score).toBeGreaterThan(0.0);
    expect(score).toBeLessThan(1.0);
  });
});

describe('calculateSimilarity — levenshtein', () => {
  const method = 'levenshtein' as const;

  it('returns 1.0 for identical texts', async () => {
    const score = await util.calculateSimilarity(
      'hello world',
      'hello world',
      { method },
    );
    expect(score).toBe(1.0);
  });

  it('returns low score for completely different texts', async () => {
    const score = await util.calculateSimilarity(
      'abcdefghij',
      'zyxwvutsrq',
      { method },
    );
    expect(score).toBeLessThan(0.3);
  });

  it('returns intermediate score for texts with partial edits', async () => {
    const score = await util.calculateSimilarity(
      'kitten',
      'sitting',
      { method },
    );
    // Classic edit distance example — similarity should be moderate
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.9);
  });

  it('similarity decreases as edit distance grows', async () => {
    const close = await util.calculateSimilarity('cat', 'bat', { method });
    const far = await util.calculateSimilarity('cat', 'dog', { method });
    // cat->bat is 1 edit, cat->dog is 3 edits
    expect(close).toBeGreaterThan(far);
  });
});

describe('calculateSimilarity — cross-method sanity', () => {
  it('all three methods agree that identical texts are highly similar', async () => {
    const text = 'the dragon breathes fire across the battlefield';
    const jaccard = await util.calculateSimilarity(text, text, { method: 'jaccard' });
    const cosine = await util.calculateSimilarity(text, text, { method: 'cosine_tfidf' });
    const lev = await util.calculateSimilarity(text, text, { method: 'levenshtein' });
    expect(jaccard).toBeGreaterThanOrEqual(0.99);
    expect(cosine).toBeGreaterThanOrEqual(0.99);
    expect(lev).toBe(1.0);
  });
});

/**
 * @file HeuristicEntityExtractor.spec.ts
 * @description Unit tests for Step 13 heuristic entity extraction. Pins
 * the five regex pattern families (proper nouns, ISO dates, named dates,
 * currency, numeric+units), sentence-start filter, dedup, normalization,
 * and max-entity cap.
 */

import { describe, it, expect } from 'vitest';
import {
  extractEntities,
  slugifyEntityId,
} from '../HeuristicEntityExtractor.js';

describe('extractEntities — proper nouns', () => {
  it('extracts single-word proper nouns', () => {
    expect(extractEntities('Alice moved yesterday')).toEqual(['Alice']);
  });

  it('extracts multi-word proper-noun phrases', () => {
    const out = extractEntities('Wells Fargo approved the loan');
    expect(out).toContain('Wells Fargo');
  });

  it('drops single-word sentence-start stopwords', () => {
    expect(extractEntities('The user asked a question.')).toEqual([]);
    expect(extractEntities('I saw it yesterday.')).toEqual([]);
    expect(extractEntities('We went to work.')).toEqual([]);
  });
});

describe('extractEntities — dates', () => {
  it('extracts ISO dates', () => {
    const out = extractEntities('on 2024-03-15 the meeting happened');
    expect(out).toContain('2024-03-15');
  });

  it('extracts named dates with year', () => {
    const out = extractEntities('on March 15, 2024 we met');
    expect(out.some((e) => e.includes('March 15'))).toBe(true);
  });

  it('extracts named dates without year', () => {
    const out = extractEntities('on Mar 15 the meeting started');
    expect(out).toContain('Mar 15');
  });
});

describe('extractEntities — currency', () => {
  it('extracts dollar amounts', () => {
    const out = extractEntities('paid $350,000 for the house');
    expect(out).toContain('$350,000');
  });

  it('extracts euro amounts and currency codes', () => {
    const out = extractEntities('sent €500 and USD 1.2M yesterday');
    expect(out.some((e) => e.includes('€500'))).toBe(true);
    expect(out.some((e) => e.includes('USD 1.2M'))).toBe(true);
  });
});

describe('extractEntities — numeric with units', () => {
  it('extracts weights and distances', () => {
    const out = extractEntities('ordered 5kg of rice and ran 100m');
    expect(out).toContain('5kg');
    expect(out).toContain('100m');
  });

  it('extracts durations', () => {
    const out = extractEntities('over 3 days and 2 weeks');
    expect(out).toContain('3 days');
    expect(out).toContain('2 weeks');
  });
});

describe('extractEntities — normalization + dedup', () => {
  it('preserves case and deduplicates exact matches', () => {
    const out = extractEntities('Alice saw Alice but ALICE was elsewhere');
    const alice = out.filter((e) => e === 'Alice');
    expect(alice).toHaveLength(1);
  });

  it('returns empty for empty / whitespace input', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractEntities('   ')).toEqual([]);
  });

  it('caps at 50 entities', () => {
    const caps = Array.from({ length: 100 }, (_, i) => `Entity${i}`).join(' ');
    expect(extractEntities(caps).length).toBeLessThanOrEqual(50);
  });
});

describe('slugifyEntityId', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugifyEntityId('Wells Fargo')).toBe('wells-fargo');
  });

  it('strips punctuation and symbols', () => {
    expect(slugifyEntityId('$350,000')).toBe('350000');
    expect(slugifyEntityId('March 15, 2024')).toBe('march-15-2024');
  });

  it('is idempotent', () => {
    const first = slugifyEntityId('iPhone 15 Pro');
    expect(slugifyEntityId(first)).toBe(first);
  });

  it('handles empty string', () => {
    expect(slugifyEntityId('')).toBe('');
  });
});

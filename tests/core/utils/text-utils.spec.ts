/**
 * @fileoverview Unit tests for `src/core/utils/text-utils.ts`.
 *
 * Tests cover every exported function:
 *  - clamp
 *  - parseJsonResponse
 *  - tokenize
 *  - normalizeText
 *  - estimateTokens
 */

import { describe, it, expect } from 'vitest';
import {
  clamp,
  parseJsonResponse,
  tokenize,
  normalizeText,
  estimateTokens,
} from '../../../src/core/utils/text-utils';

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

describe('clamp', () => {
  it('returns min when value is below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, -50, 50)).toBe(-50);
  });

  it('returns max when value is above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(200, -50, 50)).toBe(50);
  });

  it('returns the value unchanged when it is within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);   // exactly at min
    expect(clamp(10, 0, 10)).toBe(10); // exactly at max
  });

  it('handles equal min and max (degenerate range)', () => {
    // When min === max the only valid value is that boundary.
    expect(clamp(0, 5, 5)).toBe(5);
    expect(clamp(5, 5, 5)).toBe(5);
    expect(clamp(9, 5, 5)).toBe(5);
  });

  it('handles negative ranges correctly', () => {
    expect(clamp(-3, -10, -1)).toBe(-3);
    expect(clamp(0, -10, -1)).toBe(-1);
    expect(clamp(-20, -10, -1)).toBe(-10);
  });

  it('handles floating-point values', () => {
    expect(clamp(0.5, 0.0, 1.0)).toBeCloseTo(0.5);
    expect(clamp(1.5, 0.0, 1.0)).toBeCloseTo(1.0);
    expect(clamp(-0.1, 0.0, 1.0)).toBeCloseTo(0.0);
  });
});

// ---------------------------------------------------------------------------
// parseJsonResponse
// ---------------------------------------------------------------------------

describe('parseJsonResponse', () => {
  it('parses valid JSON strings', () => {
    expect(parseJsonResponse<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonResponse<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseJsonResponse<string>('"hello"')).toBe('hello');
  });

  it('returns null for invalid JSON', () => {
    expect(parseJsonResponse('not json')).toBeNull();
    expect(parseJsonResponse('{broken:')).toBeNull();
    expect(parseJsonResponse('undefined')).toBeNull();
  });

  it('returns null for empty or falsy input', () => {
    expect(parseJsonResponse('')).toBeNull();
    // @ts-expect-error — testing runtime safety with wrong type
    expect(parseJsonResponse(null)).toBeNull();
    // @ts-expect-error — testing runtime safety with wrong type
    expect(parseJsonResponse(undefined)).toBeNull();
  });

  it('strips ```json … ``` markdown code fences', () => {
    const fenced = '```json\n{"key":"value"}\n```';
    expect(parseJsonResponse<{ key: string }>(fenced)).toEqual({ key: 'value' });
  });

  it('strips plain ``` … ``` code fences without language specifier', () => {
    const fenced = '```\n{"key":"value"}\n```';
    expect(parseJsonResponse<{ key: string }>(fenced)).toEqual({ key: 'value' });
  });

  it('strips ```typescript … ``` and ```ts … ``` fences', () => {
    const tsBlock = '```typescript\n{"x":1}\n```';
    expect(parseJsonResponse<{ x: number }>(tsBlock)).toEqual({ x: 1 });

    const tsShortBlock = '```ts\n{"x":2}\n```';
    expect(parseJsonResponse<{ x: number }>(tsShortBlock)).toEqual({ x: 2 });
  });

  it('handles fenced JSON with extra surrounding whitespace', () => {
    const fenced = '  ```json\n  {"a":1}  \n```  ';
    // The outer trim should expose the fences for stripping.
    expect(parseJsonResponse<{ a: number }>(fenced)).toEqual({ a: 1 });
  });

  it('parses nested objects and arrays', () => {
    const json = JSON.stringify({ arr: [1, 2], nested: { x: true } });
    expect(parseJsonResponse(json)).toEqual({ arr: [1, 2], nested: { x: true } });
  });
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('splits text into lowercase word tokens', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips punctuation from tokens', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
    expect(tokenize("it's a test.")).toEqual(['it', 's', 'a', 'test']);
  });

  it('handles multiple whitespace separators', () => {
    expect(tokenize('foo  bar\tbaz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns an empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(tokenize('   ')).toEqual([]);
  });

  it('returns an empty array for falsy input', () => {
    // @ts-expect-error — testing runtime safety
    expect(tokenize(null)).toEqual([]);
    // @ts-expect-error — testing runtime safety
    expect(tokenize(undefined)).toEqual([]);
  });

  it('preserves digits as part of tokens', () => {
    expect(tokenize('GPT4 model v2')).toEqual(['gpt4', 'model', 'v2']);
  });
});

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

describe('normalizeText', () => {
  it('lowercases text and strips punctuation', () => {
    expect(normalizeText('Hello, World!')).toBe('hello world');
  });

  it('collapses multiple whitespace to a single space', () => {
    expect(normalizeText('  foo   bar  ')).toBe('foo bar');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('handles apostrophes and special characters', () => {
    // Apostrophe is non-alphanumeric → replaced with space, then collapsed.
    expect(normalizeText("it's great!")).toBe('it s great');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeText('')).toBe('');
  });

  it('returns empty string for falsy input', () => {
    // @ts-expect-error — testing runtime safety
    expect(normalizeText(null)).toBe('');
    // @ts-expect-error — testing runtime safety
    expect(normalizeText(undefined)).toBe('');
  });

  it('preserves digits within text', () => {
    expect(normalizeText('Version 2.0 released!')).toBe('version 2 0 released');
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for falsy input', () => {
    // @ts-expect-error — testing runtime safety
    expect(estimateTokens(null)).toBe(0);
    // @ts-expect-error — testing runtime safety
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('estimates ~1 token per 4 characters (ceil)', () => {
    // 4 chars → exactly 1 token
    expect(estimateTokens('abcd')).toBe(1);
    // 5 chars → ceil(5/4) = 2
    expect(estimateTokens('abcde')).toBe(2);
    // 8 chars → exactly 2 tokens
    expect(estimateTokens('abcdefgh')).toBe(2);
    // 9 chars → ceil(9/4) = 3
    expect(estimateTokens('abcdefghi')).toBe(3);
  });

  it('handles single character input', () => {
    // ceil(1/4) = 1
    expect(estimateTokens('a')).toBe(1);
  });

  it('returns a non-negative integer for longer text', () => {
    const result = estimateTokens('The quick brown fox jumps over the lazy dog.');
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('grows roughly linearly with text length', () => {
    // Use a string that is an exact multiple of 4 chars so ceil doesn't
    // introduce a rounding artefact when multiplied.
    // 'abcd' = 4 chars → estimateTokens = 1
    // 'abcd'.repeat(10) = 40 chars → estimateTokens = 10
    const short = estimateTokens('abcd');        // exactly 1 token
    const long = estimateTokens('abcd'.repeat(10)); // exactly 10 tokens
    expect(long).toBe(short * 10);
  });
});

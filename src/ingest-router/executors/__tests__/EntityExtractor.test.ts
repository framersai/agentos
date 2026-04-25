/**
 * @file EntityExtractor.test.ts
 * @description Tests for the Mem0-v3-style entity extractor.
 * Validates proper noun, quoted text, and compound noun phrase
 * detection with character offsets.
 */

import { describe, it, expect } from 'vitest';
import { EntityExtractor } from '../EntityExtractor.js';

describe('EntityExtractor (Mem0 v3 style)', () => {
  const ex = new EntityExtractor();

  it('extracts proper nouns', () => {
    const result = ex.extract('John works at Anthropic in San Francisco.');
    const proper = result.entities.filter((e) => e.kind === 'proper-noun').map((e) => e.text);
    expect(proper).toEqual(expect.arrayContaining(['John', 'Anthropic']));
    // San Francisco is detected as a compound noun phrase, not two proper nouns
  });

  it('extracts quoted text (double quotes)', () => {
    const result = ex.extract('She said "deploy at midnight" before leaving.');
    const quoted = result.entities.filter((e) => e.kind === 'quoted-text');
    expect(quoted).toHaveLength(1);
    expect(quoted[0].text).toBe('deploy at midnight');
  });

  it('extracts quoted text (single quotes)', () => {
    const result = ex.extract("Use 'rerank-v3.5' for now.");
    const quoted = result.entities.filter((e) => e.kind === 'quoted-text');
    expect(quoted).toHaveLength(1);
    expect(quoted[0].text).toBe('rerank-v3.5');
  });

  it('extracts compound noun phrases (consecutive capitalized tokens)', () => {
    const result = ex.extract('San Francisco is north of Los Angeles.');
    const cnp = result.entities.filter((e) => e.kind === 'compound-noun-phrase').map((e) => e.text);
    expect(cnp).toEqual(expect.arrayContaining(['San Francisco', 'Los Angeles']));
  });

  it('does not double-count tokens already inside compound noun phrases', () => {
    const result = ex.extract('Apple announced something in San Francisco.');
    const proper = result.entities.filter((e) => e.kind === 'proper-noun').map((e) => e.text);
    // "San" and "Francisco" are inside the compound, so they should NOT
    // also appear as standalone proper nouns
    expect(proper).not.toContain('San');
    expect(proper).not.toContain('Francisco');
    expect(proper).toContain('Apple');
  });

  it('returns position offsets for each entity', () => {
    const result = ex.extract('Anthropic released Claude.');
    const anthropic = result.entities.find((e) => e.text === 'Anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.positions[0]).toBe(0);
  });

  it('returns empty entities for text with no proper nouns', () => {
    const result = ex.extract('the quick brown fox jumps over the lazy dog');
    expect(result.entities).toHaveLength(0);
  });

  it('respects properNounMinLength option', () => {
    const ex2 = new EntityExtractor({ properNounMinLength: 3 });
    const result = ex2.extract('At noon, Bob called Al.');
    const proper = result.entities.filter((e) => e.kind === 'proper-noun').map((e) => e.text);
    // 'Al' is length 2 with min 3 — should be filtered out
    expect(proper).not.toContain('Al');
    expect(proper).toContain('Bob');
  });

  it('preserves raw text on the result', () => {
    const text = 'OpenAI built GPT-4.';
    const result = ex.extract(text);
    expect(result.rawText).toBe(text);
  });
});

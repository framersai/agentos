import { describe, expect, it } from 'vitest';
import { NoOpStemmer } from '../stemmers/NoOpStemmer';
import { NoOpLemmatizer } from '../lemmatizers/NoOpLemmatizer';
import { StopWordFilter, ENGLISH_STOP_WORDS, CODE_STOP_WORDS } from '../filters/StopWordFilter';
import { LowercaseNormalizer } from '../normalizers/LowercaseNormalizer';
import { AccentStripper } from '../normalizers/AccentStripper';
import type { Token } from '../types';

function makeTokens(words: string[]): Token[] {
  let pos = 0;
  return words.map(w => {
    const t: Token = { text: w, original: w, position: pos };
    pos += w.length + 1;
    return t;
  });
}

describe('NoOpStemmer', () => {
  it('returns tokens unchanged', () => {
    const stemmer = new NoOpStemmer();
    const tokens = makeTokens(['running', 'foxes', 'kubernetes']);
    const result = stemmer.process(tokens);
    expect(result.map(t => t.text)).toEqual(['running', 'foxes', 'kubernetes']);
  });

  it('has the correct name', () => {
    expect(new NoOpStemmer().name).toBe('NoOpStemmer');
  });
});

describe('NoOpLemmatizer', () => {
  it('returns tokens unchanged', () => {
    const lemmatizer = new NoOpLemmatizer();
    const tokens = makeTokens(['ran', 'better', 'mice']);
    const result = lemmatizer.process(tokens);
    expect(result.map(t => t.text)).toEqual(['ran', 'better', 'mice']);
  });
});

describe('LowercaseNormalizer', () => {
  it('lowercases token text', () => {
    const normalizer = new LowercaseNormalizer();
    const tokens = makeTokens(['Hello', 'WORLD', 'FooBar']);
    const result = normalizer.process(tokens);
    expect(result.map(t => t.text)).toEqual(['hello', 'world', 'foobar']);
  });

  it('preserves original', () => {
    const normalizer = new LowercaseNormalizer();
    const tokens = makeTokens(['Hello']);
    const result = normalizer.process(tokens);
    expect(result[0].original).toBe('Hello');
    expect(result[0].text).toBe('hello');
  });
});

describe('AccentStripper', () => {
  it('removes diacritics', () => {
    const stripper = new AccentStripper();
    const tokens = makeTokens(['café', 'naïve', 'über', 'résumé']);
    const result = stripper.process(tokens);
    expect(result.map(t => t.text)).toEqual(['cafe', 'naive', 'uber', 'resume']);
  });

  it('leaves ASCII text unchanged', () => {
    const stripper = new AccentStripper();
    const tokens = makeTokens(['hello', 'world']);
    const result = stripper.process(tokens);
    expect(result.map(t => t.text)).toEqual(['hello', 'world']);
  });
});

describe('StopWordFilter', () => {
  it('filters English stop words', () => {
    const filter = new StopWordFilter(ENGLISH_STOP_WORDS);
    const tokens = makeTokens(['the', 'quick', 'brown', 'fox', 'is', 'running']);
    const result = filter.process(tokens);
    expect(result.map(t => t.text)).toEqual(['quick', 'brown', 'fox', 'running']);
  });

  it('code stop words preserve programming keywords', () => {
    const filter = new StopWordFilter(CODE_STOP_WORDS);
    const tokens = makeTokens(['the', 'function', 'class', 'is', 'import', 'return']);
    const result = filter.process(tokens);
    // 'the' and 'is' are code stop words, but 'function', 'class', 'import', 'return' are NOT
    expect(result.map(t => t.text)).toContain('function');
    expect(result.map(t => t.text)).toContain('class');
    expect(result.map(t => t.text)).toContain('import');
    expect(result.map(t => t.text)).toContain('return');
    expect(result.map(t => t.text)).not.toContain('the');
    expect(result.map(t => t.text)).not.toContain('is');
  });

  it('accepts custom stop word set', () => {
    const custom = new Set(['foo', 'bar']);
    const filter = new StopWordFilter(custom);
    const tokens = makeTokens(['foo', 'baz', 'bar', 'qux']);
    const result = filter.process(tokens);
    expect(result.map(t => t.text)).toEqual(['baz', 'qux']);
  });

  it('defaults to English stop words', () => {
    const filter = new StopWordFilter();
    const tokens = makeTokens(['the', 'cat']);
    const result = filter.process(tokens);
    expect(result.map(t => t.text)).toEqual(['cat']);
  });
});

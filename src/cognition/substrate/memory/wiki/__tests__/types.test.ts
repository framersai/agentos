import { describe, it, expect } from 'vitest';
import { WIKI_PAGE_TYPES, isWikiPageType } from '../types.js';

describe('wiki types', () => {
  it('enumerates the three page types', () => {
    expect(WIKI_PAGE_TYPES).toEqual(['entity', 'concept', 'log']);
  });
  it('isWikiPageType guards values', () => {
    expect(isWikiPageType('entity')).toBe(true);
    expect(isWikiPageType('nope')).toBe(false);
  });
});

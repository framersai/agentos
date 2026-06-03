import { describe, it, expect } from 'vitest';
import * as wiki from '../index.js';

describe('wiki barrel', () => {
  it('exports the public surface', () => {
    expect(typeof wiki.WikiMemoryStore).toBe('function');
    expect(typeof wiki.WikiCompiler).toBe('function');
    expect(typeof wiki.ensureMemoryDir).toBe('function');
    expect(typeof wiki.parsePage).toBe('function');
    expect(wiki.WIKI_PAGE_TYPES).toEqual(['entity', 'concept', 'log']);
  });
});

/**
 * @fileoverview Tests for KeywordFallback — keyword-matching search used as
 * the degraded-mode fallback when the embedding API is unavailable.
 */

import type { CorpusChunk } from '../types.js';
import { KeywordFallback } from '../KeywordFallback.js';

/** Reusable test corpus. */
const CHUNKS: CorpusChunk[] = [
  {
    id: 'chunk-1',
    content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
    heading: 'TypeScript Overview',
    sourcePath: '/docs/typescript.md',
  },
  {
    id: 'chunk-2',
    content: 'Vitest is a blazing fast unit testing framework powered by Vite.',
    heading: 'Testing with Vitest',
    sourcePath: '/docs/testing.md',
  },
  {
    id: 'chunk-3',
    content: 'Docker containers package applications with their dependencies for consistent deployment.',
    heading: 'Docker Basics',
    sourcePath: '/docs/docker.md',
  },
  {
    id: 'chunk-4',
    content: 'Authentication tokens are used to verify user identity in web applications.',
    heading: 'Authentication',
    sourcePath: '/docs/auth.md',
  },
  {
    id: 'chunk-5',
    content: 'The database stores user profiles, session tokens, and application state.',
    heading: 'Database Schema',
    sourcePath: '/docs/database.md',
  },
  {
    id: 'chunk-6',
    content: 'GraphQL provides a flexible query language for APIs and runtime for fulfilling queries.',
    heading: 'GraphQL Introduction',
    sourcePath: '/docs/graphql.md',
  },
];

describe('KeywordFallback', () => {
  it('finds chunks matching query keywords', () => {
    const fallback = new KeywordFallback(CHUNKS);
    const results = fallback.search('TypeScript JavaScript');

    expect(results.length).toBeGreaterThan(0);
    // chunk-1 talks about TypeScript and JavaScript
    expect(results[0].id).toBe('chunk-1');
    // Every result must have the RetrievedChunk shape
    for (const r of results) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('content');
      expect(r).toHaveProperty('heading');
      expect(r).toHaveProperty('sourcePath');
      expect(r).toHaveProperty('relevanceScore');
      expect(r).toHaveProperty('matchType', 'vector');
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it('returns empty for no matches', () => {
    const fallback = new KeywordFallback(CHUNKS);
    const results = fallback.search('xylophone zeppelin');

    expect(results).toEqual([]);
  });

  it('matches heading with higher score than content', () => {
    const fallback = new KeywordFallback(CHUNKS);
    const results = fallback.search('authentication');

    // chunk-4 has "Authentication" in the heading (4pts) AND "authentication" in content (1pt)
    // chunk-5 only has "tokens" but NOT "authentication" directly
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('chunk-4');
    // If any other chunk matched "authentication" only in content, it should score lower
    if (results.length > 1) {
      expect(results[0].relevanceScore).toBeGreaterThan(results[1].relevanceScore);
    }
  });

  it('respects topK limit', () => {
    const fallback = new KeywordFallback(CHUNKS);
    // "the" is a stop word, but "applications" and "query" should match several chunks
    const results = fallback.search('applications query language', 2);

    expect(results.length).toBeLessThanOrEqual(2);
  });
});

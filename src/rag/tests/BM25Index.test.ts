/**
 * @fileoverview Tests for BM25Index — sparse keyword ranking for hybrid retrieval.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Index } from '../search/BM25Index.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function createIndexWith10Docs(): BM25Index {
  const index = new BM25Index();
  index.addDocuments([
    { id: 'doc-1', text: 'TypeScript compiler error TS2304 cannot find name' },
    { id: 'doc-2', text: 'JavaScript runtime TypeError explanation and fix' },
    { id: 'doc-3', text: 'Fix error TS2304 by adding type declarations to tsconfig' },
    { id: 'doc-4', text: 'React component lifecycle methods and hooks overview' },
    { id: 'doc-5', text: 'Node.js event loop and asynchronous programming patterns' },
    { id: 'doc-6', text: 'CSS Grid layout tutorial with responsive design examples' },
    { id: 'doc-7', text: 'Docker container orchestration with Kubernetes deployment' },
    { id: 'doc-8', text: 'SQL database indexing strategies for query optimization' },
    { id: 'doc-9', text: 'Python machine learning model training with scikit-learn' },
    { id: 'doc-10', text: 'Git branching strategies and merge conflict resolution' },
  ]);
  return index;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('BM25Index', () => {
  describe('constructor', () => {
    it('creates index with default parameters', () => {
      const index = new BM25Index();
      const stats = index.getStats();
      expect(stats.documentCount).toBe(0);
      expect(stats.termCount).toBe(0);
      expect(stats.avgDocLength).toBe(0);
    });

    it('accepts custom k1 and b parameters', () => {
      const index = new BM25Index({ k1: 1.5, b: 0.5 });
      expect(index).toBeDefined();
    });
  });

  describe('addDocument', () => {
    it('adds a document and updates stats', () => {
      const index = new BM25Index();
      index.addDocument('doc-1', 'hello world test document');
      const stats = index.getStats();
      expect(stats.documentCount).toBe(1);
      expect(stats.termCount).toBeGreaterThan(0);
    });

    it('throws on empty id', () => {
      const index = new BM25Index();
      expect(() => index.addDocument('', 'text')).toThrow();
    });

    it('throws on empty text', () => {
      const index = new BM25Index();
      expect(() => index.addDocument('id', '')).toThrow();
    });

    it('replaces existing document on same id', () => {
      const index = new BM25Index();
      index.addDocument('doc-1', 'original content');
      index.addDocument('doc-1', 'replacement content');
      const stats = index.getStats();
      expect(stats.documentCount).toBe(1);
    });

    it('stores metadata alongside document', () => {
      const index = new BM25Index();
      index.addDocument('doc-1', 'hello world', { source: 'test' });
      const results = index.search('hello');
      expect(results[0].metadata).toEqual({ source: 'test' });
    });
  });

  describe('addDocuments', () => {
    it('adds multiple documents at once', () => {
      const index = new BM25Index();
      index.addDocuments([
        { id: 'doc-1', text: 'first document' },
        { id: 'doc-2', text: 'second document' },
        { id: 'doc-3', text: 'third document' },
      ]);
      expect(index.getStats().documentCount).toBe(3);
    });
  });

  describe('search', () => {
    let index: BM25Index;

    beforeEach(() => {
      index = createIndexWith10Docs();
    });

    it('finds documents by exact keyword match', () => {
      const results = index.search('TS2304');
      expect(results.length).toBeGreaterThan(0);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('doc-1');
      expect(ids).toContain('doc-3');
    });

    it('ranks exact keyword matches higher than partial matches', () => {
      const results = index.search('error TS2304');
      // doc-1 and doc-3 both have "error" AND "TS2304"
      expect(results[0].id === 'doc-1' || results[0].id === 'doc-3').toBe(true);
    });

    it('does NOT find synonym matches (that is vectors job)', () => {
      // "bug" is a synonym for "error" but BM25 won't catch it
      const results = index.search('bug');
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain('doc-1');
      expect(ids).not.toContain('doc-3');
    });

    it('returns empty array for stop-word-only query', () => {
      const results = index.search('the is a');
      expect(results).toEqual([]);
    });

    it('returns empty array for empty query', () => {
      const results = index.search('');
      expect(results).toEqual([]);
    });

    it('respects topK parameter', () => {
      const results = index.search('error', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns scores in descending order', () => {
      const results = index.search('TypeScript error');
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('returns positive scores for matching documents', () => {
      const results = index.search('Docker Kubernetes');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('removeDocument', () => {
    it('removes an existing document', () => {
      const index = createIndexWith10Docs();
      const removed = index.removeDocument('doc-1');
      expect(removed).toBe(true);
      expect(index.getStats().documentCount).toBe(9);
    });

    it('returns false for non-existent document', () => {
      const index = createIndexWith10Docs();
      expect(index.removeDocument('nonexistent')).toBe(false);
    });

    it('removed document no longer appears in search', () => {
      const index = createIndexWith10Docs();
      index.removeDocument('doc-1');
      const results = index.search('TS2304');
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain('doc-1');
      expect(ids).toContain('doc-3'); // doc-3 still has TS2304
    });
  });

  describe('getStats', () => {
    it('reports correct stats after indexing', () => {
      const index = createIndexWith10Docs();
      const stats = index.getStats();
      expect(stats.documentCount).toBe(10);
      expect(stats.termCount).toBeGreaterThan(0);
      expect(stats.avgDocLength).toBeGreaterThan(0);
    });
  });
});

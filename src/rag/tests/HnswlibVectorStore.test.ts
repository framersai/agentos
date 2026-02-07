/**
 * @file HnswlibVectorStore.test.ts
 * @description Tests for the HNSW-based vector store implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock hnswlib-node before importing HnswlibVectorStore
const mockIndex = {
  initIndex: vi.fn(),
  setEf: vi.fn(),
  addPoint: vi.fn(),
  searchKnn: vi.fn(),
  markDelete: vi.fn(),
  resizeIndex: vi.fn(),
};

vi.mock('hnswlib-node', () => ({
  HierarchicalNSW: vi.fn().mockImplementation(() => ({ ...mockIndex })),
}));

import { HnswlibVectorStore } from '../implementations/vector_stores/HnswlibVectorStore';
import type { VectorDocument, QueryOptions } from '../IVectorStore';

describe('HnswlibVectorStore', () => {
  let store: HnswlibVectorStore;

  const makeDoc = (id: string, embedding: number[], metadata?: Record<string, any>, textContent?: string): VectorDocument => ({
    id,
    embedding,
    metadata,
    textContent,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new HnswlibVectorStore();
    await store.initialize({ id: 'test-hnsw', type: 'hnswlib' });
  });

  afterEach(async () => {
    await store.shutdown();
  });

  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const health = await store.checkHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.details.type).toBe('hnswlib');
    });

    it('should allow re-initialization', async () => {
      await store.initialize({ id: 'test-hnsw-2', type: 'hnswlib' });
      const health = await store.checkHealth();
      expect(health.isHealthy).toBe(true);
    });

    it('should apply custom HNSW parameters', async () => {
      const customStore = new HnswlibVectorStore();
      await customStore.initialize({
        id: 'custom-hnsw',
        type: 'hnswlib',
        hnswM: 32,
        hnswEfConstruction: 400,
        hnswEfSearch: 200,
        defaultEmbeddingDimension: 768,
        similarityMetric: 'euclidean',
      } as any);
      const health = await customStore.checkHealth();
      expect(health.isHealthy).toBe(true);
      await customStore.shutdown();
    });
  });

  // ===========================================================================
  // Collection Management
  // ===========================================================================

  describe('createCollection', () => {
    it('should create a collection', async () => {
      await store.createCollection('test-col', 128);
      const exists = await store.collectionExists!('test-col');
      expect(exists).toBe(true);
    });

    it('should throw on duplicate collection', async () => {
      await store.createCollection('test-col', 128);
      await expect(store.createCollection('test-col', 128)).rejects.toThrow(/already exists/);
    });

    it('should allow overwrite on duplicate', async () => {
      await store.createCollection('test-col', 128);
      await store.createCollection('test-col', 128, { overwriteIfExists: true });
      const exists = await store.collectionExists!('test-col');
      expect(exists).toBe(true);
    });

    it('should throw on invalid dimension', async () => {
      await expect(store.createCollection('bad', 0)).rejects.toThrow(/Invalid dimension/);
      await expect(store.createCollection('bad', -1)).rejects.toThrow(/Invalid dimension/);
    });
  });

  describe('deleteCollection', () => {
    it('should delete a collection', async () => {
      await store.createCollection('test-col', 128);
      await store.deleteCollection!('test-col');
      const exists = await store.collectionExists!('test-col');
      expect(exists).toBe(false);
    });
  });

  // ===========================================================================
  // Upsert
  // ===========================================================================

  describe('upsert', () => {
    it('should insert documents and auto-create collection', async () => {
      const docs = [
        makeDoc('doc1', [0.1, 0.2, 0.3]),
        makeDoc('doc2', [0.4, 0.5, 0.6]),
      ];

      const result = await store.upsert('auto-col', docs);
      expect(result.upsertedCount).toBe(2);
      expect(result.upsertedIds).toContain('doc1');
      expect(result.upsertedIds).toContain('doc2');
      expect(result.failedCount).toBe(0);
    });

    it('should update existing documents', async () => {
      const doc = makeDoc('doc1', [0.1, 0.2, 0.3]);
      await store.upsert('col', [doc]);

      const updatedDoc = makeDoc('doc1', [0.7, 0.8, 0.9]);
      const result = await store.upsert('col', [updatedDoc]);
      expect(result.upsertedCount).toBe(1);
    });

    it('should reject documents with wrong dimension', async () => {
      await store.createCollection('fixed-dim', 3);
      const doc = makeDoc('doc1', [0.1, 0.2]); // wrong dimension
      const result = await store.upsert('fixed-dim', [doc]);
      expect(result.failedCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toContain('dimension');
    });

    it('should store metadata and text content', async () => {
      const doc = makeDoc('doc1', [0.1, 0.2, 0.3], { category: 'test', score: 42 }, 'Hello world');
      const result = await store.upsert('col', [doc]);
      expect(result.upsertedCount).toBe(1);
    });
  });

  // ===========================================================================
  // Query
  // ===========================================================================

  describe('query', () => {
    it('should return empty results for non-existent collection', async () => {
      const result = await store.query('nonexistent', [0.1, 0.2, 0.3]);
      expect(result.documents).toHaveLength(0);
    });

    it('should return empty results for empty collection', async () => {
      await store.createCollection('empty', 3);
      const result = await store.query('empty', [0.1, 0.2, 0.3]);
      expect(result.documents).toHaveLength(0);
    });

    it('should throw on dimension mismatch', async () => {
      await store.createCollection('col', 3);
      await store.upsert('col', [makeDoc('doc1', [0.1, 0.2, 0.3])]);
      await expect(store.query('col', [0.1, 0.2])).rejects.toThrow(/dimension/);
    });

    it('should call HNSW searchKnn and return results', async () => {
      // Setup: add a doc
      await store.upsert('col', [
        makeDoc('doc1', [0.1, 0.2, 0.3], { tag: 'test' }, 'Test content'),
      ]);

      // Mock searchKnn to return our document
      mockIndex.searchKnn.mockReturnValue({
        neighbors: [0],
        distances: [0.05], // cosine distance: 1 - similarity
      });

      const result = await store.query('col', [0.1, 0.2, 0.3], {
        topK: 5,
        includeMetadata: true,
        includeTextContent: true,
      });

      expect(mockIndex.searchKnn).toHaveBeenCalled();
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe('doc1');
      expect(result.documents[0].similarityScore).toBeCloseTo(0.95, 1);
      expect(result.documents[0].metadata).toEqual({ tag: 'test' });
      expect(result.documents[0].textContent).toBe('Test content');
      expect(result.queryId).toMatch(/^hnsw-query-/);
    });

    it('should filter by minimum similarity score', async () => {
      await store.upsert('col', [makeDoc('doc1', [0.1, 0.2, 0.3])]);

      mockIndex.searchKnn.mockReturnValue({
        neighbors: [0],
        distances: [0.8], // low similarity
      });

      const result = await store.query('col', [0.1, 0.2, 0.3], {
        minSimilarityScore: 0.9,
      });

      expect(result.documents).toHaveLength(0);
    });

    it('should apply metadata filters', async () => {
      await store.upsert('col', [
        makeDoc('doc1', [0.1, 0.2, 0.3], { category: 'A' }),
        makeDoc('doc2', [0.4, 0.5, 0.6], { category: 'B' }),
      ]);

      mockIndex.searchKnn.mockReturnValue({
        neighbors: [0, 1],
        distances: [0.1, 0.2],
      });

      const result = await store.query('col', [0.1, 0.2, 0.3], {
        filter: { category: 'A' },
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].id).toBe('doc1');
    });

    it('should respect topK limit', async () => {
      await store.upsert('col', [
        makeDoc('d1', [0.1, 0.2, 0.3]),
        makeDoc('d2', [0.4, 0.5, 0.6]),
        makeDoc('d3', [0.7, 0.8, 0.9]),
      ]);

      mockIndex.searchKnn.mockReturnValue({
        neighbors: [0, 1, 2],
        distances: [0.1, 0.2, 0.3],
      });

      const result = await store.query('col', [0.1, 0.2, 0.3], { topK: 2 });
      expect(result.documents.length).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================================================
  // Metadata Filtering
  // ===========================================================================

  describe('metadata filtering', () => {
    beforeEach(async () => {
      await store.upsert('col', [
        makeDoc('d1', [0.1, 0.2, 0.3], { score: 85, tags: ['a', 'b'], name: 'Alpha' }),
        makeDoc('d2', [0.4, 0.5, 0.6], { score: 42, tags: ['b', 'c'], name: 'Beta' }),
        makeDoc('d3', [0.7, 0.8, 0.9], { score: 95, tags: ['a'], name: 'Gamma' }),
      ]);
    });

    const queryWithFilter = async (filter: any) => {
      mockIndex.searchKnn.mockReturnValue({
        neighbors: [0, 1, 2],
        distances: [0.1, 0.2, 0.3],
      });
      return store.query('col', [0.1, 0.2, 0.3], { filter, topK: 10 });
    };

    it('should filter by $eq', async () => {
      const result = await queryWithFilter({ name: { $eq: 'Alpha' } });
      expect(result.documents.every(d => d.metadata?.name === 'Alpha')).toBe(true);
    });

    it('should filter by $ne', async () => {
      const result = await queryWithFilter({ name: { $ne: 'Alpha' } });
      expect(result.documents.every(d => d.metadata?.name !== 'Alpha')).toBe(true);
    });

    it('should filter by $gt', async () => {
      const result = await queryWithFilter({ score: { $gt: 80 } });
      expect(result.documents.every(d => (d.metadata?.score as number) > 80)).toBe(true);
    });

    it('should filter by $in', async () => {
      const result = await queryWithFilter({ name: { $in: ['Alpha', 'Gamma'] } });
      expect(result.documents.every(d =>
        ['Alpha', 'Gamma'].includes(d.metadata?.name as string),
      )).toBe(true);
    });

    it('should filter by $contains on arrays', async () => {
      const result = await queryWithFilter({ tags: { $contains: 'a' } });
      expect(result.documents.every(d =>
        (d.metadata?.tags as string[]).includes('a'),
      )).toBe(true);
    });

    it('should filter by $textSearch', async () => {
      const result = await queryWithFilter({ name: { $textSearch: 'alph' } });
      expect(result.documents).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Delete
  // ===========================================================================

  describe('delete', () => {
    it('should delete documents by ID', async () => {
      await store.upsert('col', [
        makeDoc('d1', [0.1, 0.2, 0.3]),
        makeDoc('d2', [0.4, 0.5, 0.6]),
      ]);

      const result = await store.delete('col', ['d1']);
      expect(result.deletedCount).toBe(1);
    });

    it('should delete all documents', async () => {
      await store.upsert('col', [
        makeDoc('d1', [0.1, 0.2, 0.3]),
        makeDoc('d2', [0.4, 0.5, 0.6]),
      ]);

      const result = await store.delete('col', undefined, { deleteAll: true });
      expect(result.deletedCount).toBe(2);
    });

    it('should return 0 for non-existent collection', async () => {
      const result = await store.delete('nonexistent', ['d1']);
      expect(result.deletedCount).toBe(0);
    });

    it('should delete by metadata filter', async () => {
      await store.upsert('col', [
        makeDoc('d1', [0.1, 0.2, 0.3], { category: 'remove' }),
        makeDoc('d2', [0.4, 0.5, 0.6], { category: 'keep' }),
      ]);

      const result = await store.delete('col', undefined, {
        filter: { category: 'remove' },
      });
      expect(result.deletedCount).toBe(1);
    });
  });

  // ===========================================================================
  // Stats & Health
  // ===========================================================================

  describe('getStats', () => {
    it('should return stats for a specific collection', async () => {
      await store.upsert('col', [makeDoc('d1', [0.1, 0.2, 0.3])]);
      const stats = await store.getStats!('col');
      expect(stats.name).toBe('col');
      expect(stats.documentCount).toBe(1);
      expect(stats.dimension).toBe(3);
    });

    it('should return aggregate stats', async () => {
      await store.upsert('col1', [makeDoc('d1', [0.1, 0.2, 0.3])]);
      await store.upsert('col2', [makeDoc('d2', [0.4, 0.5, 0.6])]);
      const stats = await store.getStats!();
      expect(stats.totalCollections).toBe(2);
      expect(stats.totalDocuments).toBe(2);
    });

    it('should return error for non-existent collection', async () => {
      const stats = await store.getStats!('nonexistent');
      expect(stats.error).toBeDefined();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should throw when not initialized', async () => {
      const uninitStore = new HnswlibVectorStore();
      await expect(uninitStore.query('col', [0.1])).rejects.toThrow(/not initialized/);
    });

    it('should handle shutdown gracefully', async () => {
      await store.shutdown();
      const health = await store.checkHealth();
      expect(health.isHealthy).toBe(false);
    });

    it('should handle dynamic index resizing', async () => {
      // Create collection with small initial size, add many docs
      await store.createCollection('big', 3);
      const docs = Array.from({ length: 50 }, (_, i) =>
        makeDoc(`doc-${i}`, [Math.random(), Math.random(), Math.random()]),
      );
      const result = await store.upsert('big', docs);
      expect(result.upsertedCount).toBe(50);
    });
  });
});

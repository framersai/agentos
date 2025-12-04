/**
 * @fileoverview Unit tests for InMemoryVectorStore
 * Tests vector storage, retrieval, and management operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryVectorStore } from '../../src/rag/implementations/vector_stores/InMemoryVectorStore';
import type { VectorDocument, QueryOptions, CreateCollectionOptions } from '../../src/rag/IVectorStore';

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;
  const testCollectionName = 'test-collection';

  beforeEach(async () => {
    store = new InMemoryVectorStore();
    await store.initialize({
      id: 'test-store',
      type: 'in_memory' as any,
    });
  });

  afterEach(async () => {
    if (store) {
      await store.shutdown();
    }
  });

  describe('initialization', () => {
    it('initializes successfully', async () => {
      const newStore = new InMemoryVectorStore();
      await expect(newStore.initialize({
        id: 'new-store',
        type: 'in_memory' as any,
      })).resolves.not.toThrow();
      await newStore.shutdown();
    });

    it('handles re-initialization gracefully', async () => {
      await expect(store.initialize({
        id: 'test-store',
        type: 'in_memory' as any,
      })).resolves.not.toThrow();
    });
  });

  describe('collection management', () => {
    const testDimension = 384;

    it('creates a collection', async () => {
      await expect(
        store.createCollection(testCollectionName, testDimension, { similarityMetric: 'cosine' })
      ).resolves.not.toThrow();
    });

    it('deletes a collection', async () => {
      await store.createCollection(testCollectionName, testDimension);
      await expect(store.deleteCollection(testCollectionName)).resolves.not.toThrow();
      
      // After deletion, collection should not exist
      const exists = await store.collectionExists(testCollectionName);
      expect(exists).toBe(false);
    });

    it('checks if collection exists', async () => {
      await store.createCollection(testCollectionName, testDimension);
      
      const exists = await store.collectionExists(testCollectionName);
      expect(exists).toBe(true);
      
      const notExists = await store.collectionExists('non-existent');
      expect(notExists).toBe(false);
    });
  });

  describe('document operations', () => {
    const testDimension = 384;
    const testDocs: VectorDocument[] = [
      {
        id: 'doc-1',
        embedding: new Array(testDimension).fill(0.1),
        textContent: 'First test document',
        metadata: { category: 'test', priority: 1 },
      },
      {
        id: 'doc-2',
        embedding: new Array(testDimension).fill(0.2),
        textContent: 'Second test document',
        metadata: { category: 'test', priority: 2 },
      },
      {
        id: 'doc-3',
        embedding: new Array(testDimension).fill(0.3),
        textContent: 'Third test document with different category',
        metadata: { category: 'other', priority: 3 },
      },
    ];

    beforeEach(async () => {
      await store.createCollection(testCollectionName, testDimension);
    });

    it('upserts documents', async () => {
      const result = await store.upsert(testCollectionName, testDocs);
      
      expect(result.upsertedCount).toBe(3);
      expect(result.failedCount ?? 0).toBe(0);
      expect(result.upsertedIds).toHaveLength(3);
    });

    it('upserts and updates existing documents', async () => {
      await store.upsert(testCollectionName, [testDocs[0]]);
      
      const updatedDoc: VectorDocument = {
        ...testDocs[0],
        textContent: 'Updated first document',
        metadata: { ...testDocs[0].metadata, updated: true },
      };
      
      const result = await store.upsert(testCollectionName, [updatedDoc]);
      expect(result.upsertedCount).toBe(1);
    });

    it('queries documents by similarity', async () => {
      await store.upsert(testCollectionName, testDocs);
      
      const queryVector = new Array(testDimension).fill(0.15); // Closer to doc-1 and doc-2
      const options: QueryOptions = {
        topK: 2,
        includeMetadata: true,
        includeTextContent: true,
      };
      
      const result = await store.query(testCollectionName, queryVector, options);
      
      expect(result.documents).toBeDefined();
      expect(result.documents.length).toBeLessThanOrEqual(2);
      // Results should have document IDs
      result.documents.forEach(doc => {
        expect(doc.id).toBeDefined();
      });
    });

    it('filters query results by metadata', async () => {
      await store.upsert(testCollectionName, testDocs);
      
      const queryVector = new Array(testDimension).fill(0.2);
      const options: QueryOptions = {
        topK: 10,
        filter: { category: 'test' },
        includeMetadata: true,
      };
      
      const result = await store.query(testCollectionName, queryVector, options);
      
      // Should only return docs with category 'test' (2 of them)
      expect(result.documents.length).toBeLessThanOrEqual(2);
      // All returned docs should have category 'test'
      result.documents.forEach(doc => {
        if (doc.metadata) {
          expect(doc.metadata.category).toBe('test');
        }
      });
    });

    it('deletes documents by ID', async () => {
      await store.upsert(testCollectionName, testDocs);
      
      const deleteResult = await store.delete(testCollectionName, ['doc-1', 'doc-2']);
      expect(deleteResult.deletedCount).toBe(2);
      
      // Verify deletion
      const queryVector = new Array(testDimension).fill(0.1);
      const queryResult = await store.query(testCollectionName, queryVector, { topK: 10 });
      
      const remainingIds = queryResult.documents.map(d => d.id);
      expect(remainingIds).not.toContain('doc-1');
      expect(remainingIds).not.toContain('doc-2');
    });

    it('handles empty query results gracefully', async () => {
      // Query empty collection
      const queryVector = new Array(testDimension).fill(0.5);
      const result = await store.query(testCollectionName, queryVector, { topK: 5 });
      
      expect(result.documents).toEqual([]);
    });
  });

  describe('similarity calculations', () => {
    const smallDimension = 4;
    
    beforeEach(async () => {
      await store.createCollection(testCollectionName, smallDimension, { 
        similarityMetric: 'cosine' 
      });
    });

    it('returns higher scores for more similar vectors', async () => {
      const docs: VectorDocument[] = [
        { id: 'similar', embedding: [1, 0, 0, 0], textContent: 'Similar' },
        { id: 'different', embedding: [0, 0, 0, 1], textContent: 'Different' },
      ];
      
      await store.upsert(testCollectionName, docs);
      
      const queryVector = [0.9, 0.1, 0, 0]; // Very similar to 'similar'
      const result = await store.query(testCollectionName, queryVector, { topK: 2 });
      
      // Both documents should be returned
      expect(result.documents.length).toBe(2);
      // The 'similar' document should rank first (higher cosine similarity)
      expect(result.documents[0].id).toBe('similar');
      if (result.documents[1].score !== undefined) {
        expect(result.documents[0].score).toBeGreaterThan(result.documents[1].score);
      }
    });
  });

  describe('error handling', () => {
    const testDimension = 384;

    it('throws when querying non-existent collection', async () => {
      const queryVector = new Array(testDimension).fill(0.1);
      await expect(
        store.query('non-existent', queryVector, { topK: 5 })
      ).rejects.toThrow();
    });

    it('throws when upserting to non-existent collection', async () => {
      const doc: VectorDocument = {
        id: 'test',
        embedding: new Array(testDimension).fill(0.1),
        textContent: 'Test',
      };
      await expect(
        store.upsert('non-existent', [doc])
      ).rejects.toThrow();
    });
  });
});


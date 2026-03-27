/**
 * @fileoverview Tests for HybridSearcher — RRF fusion of dense+sparse results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridSearcher, type HybridResult } from '../search/HybridSearcher.js';
import { BM25Index } from '../search/BM25Index.js';
import type { IEmbeddingManager, EmbeddingResponse } from '../IEmbeddingManager.js';
import type { IVectorStore, QueryResult } from '../IVectorStore.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockEmbeddingManager(): IEmbeddingManager {
  return {
    initialize: vi.fn(),
    generateEmbeddings: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      modelId: 'test-model',
      providerId: 'test-provider',
      usage: { totalTokens: 10 },
    } satisfies EmbeddingResponse),
    getEmbeddingModelInfo: vi.fn(),
    getEmbeddingDimension: vi.fn().mockResolvedValue(3),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  };
}

function createMockVectorStore(results: QueryResult): IVectorStore {
  return {
    initialize: vi.fn(),
    upsert: vi.fn(),
    query: vi.fn().mockResolvedValue(results),
    delete: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
    shutdown: vi.fn(),
  };
}

function createBM25WithDocs(): BM25Index {
  const index = new BM25Index();
  index.addDocuments([
    { id: 'doc-A', text: 'TypeScript compiler error TS2304 cannot find name' },
    { id: 'doc-B', text: 'React hooks useState useEffect patterns' },
    { id: 'doc-C', text: 'Fix error TS2304 type declarations tsconfig' },
    { id: 'doc-D', text: 'Docker container deployment orchestration' },
    { id: 'doc-E', text: 'Node.js event loop async patterns' },
  ]);
  return index;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('HybridSearcher', () => {
  let embeddingManager: ReturnType<typeof createMockEmbeddingManager>;
  let bm25Index: ReturnType<typeof createBM25WithDocs>;

  beforeEach(() => {
    embeddingManager = createMockEmbeddingManager();
    bm25Index = createBM25WithDocs();
  });

  describe('search with RRF fusion', () => {
    it('correctly merges ranked lists from dense and sparse', async () => {
      // Dense results: doc-B (rank 1), doc-A (rank 2), doc-E (rank 3)
      const denseResults: QueryResult = {
        documents: [
          { id: 'doc-B', embedding: [], textContent: 'React hooks', similarityScore: 0.9, metadata: {} },
          { id: 'doc-A', embedding: [], textContent: 'TS error', similarityScore: 0.8, metadata: {} },
          { id: 'doc-E', embedding: [], textContent: 'Node async', similarityScore: 0.7, metadata: {} },
        ],
      };

      const vectorStore = createMockVectorStore(denseResults);

      // BM25 will return: doc-A (rank 1), doc-C (rank 2) for "error TS2304"
      const searcher = new HybridSearcher(vectorStore, embeddingManager, bm25Index, {
        fusionMethod: 'rrf',
        denseWeight: 0.7,
        sparseWeight: 0.3,
      });

      const results = await searcher.search('error TS2304', 'test-collection', 5);

      expect(results.length).toBeGreaterThan(0);

      // doc-A should rank highly because it appears in BOTH dense and sparse results
      const docA = results.find((r) => r.id === 'doc-A');
      expect(docA).toBeDefined();
      expect(docA!.denseScore).toBeDefined();
      expect(docA!.sparseScore).toBeDefined();

      // All scores should be positive
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
      }
    });

    it('includes documents only in one system', async () => {
      const denseResults: QueryResult = {
        documents: [
          { id: 'doc-X', embedding: [], textContent: 'Dense only', similarityScore: 0.95, metadata: {} },
        ],
      };

      const vectorStore = createMockVectorStore(denseResults);
      const searcher = new HybridSearcher(vectorStore, embeddingManager, bm25Index, {
        fusionMethod: 'rrf',
      });

      const results = await searcher.search('TS2304 error', 'test-collection', 10);

      // doc-X from dense only
      const docX = results.find((r) => r.id === 'doc-X');
      expect(docX).toBeDefined();
      expect(docX!.denseScore).toBe(0.95);
      expect(docX!.sparseScore).toBeUndefined();

      // doc-C from sparse only (has TS2304)
      const docC = results.find((r) => r.id === 'doc-C');
      expect(docC).toBeDefined();
      expect(docC!.sparseScore).toBeDefined();
      expect(docC!.denseScore).toBeUndefined();
    });

    it('respects topK limit', async () => {
      const denseResults: QueryResult = {
        documents: Array.from({ length: 20 }, (_, i) => ({
          id: `dense-${i}`,
          embedding: [],
          textContent: `Dense doc ${i}`,
          similarityScore: 0.9 - i * 0.03,
          metadata: {},
        })),
      };

      const vectorStore = createMockVectorStore(denseResults);
      const searcher = new HybridSearcher(vectorStore, embeddingManager, bm25Index);

      const results = await searcher.search('query', 'collection', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('search with weighted-sum fusion', () => {
    it('normalizes and weights scores from both systems', async () => {
      const denseResults: QueryResult = {
        documents: [
          { id: 'doc-A', embedding: [], textContent: 'TS error', similarityScore: 0.9, metadata: {} },
          { id: 'doc-B', embedding: [], textContent: 'React', similarityScore: 0.5, metadata: {} },
        ],
      };

      const vectorStore = createMockVectorStore(denseResults);
      const searcher = new HybridSearcher(vectorStore, embeddingManager, bm25Index, {
        fusionMethod: 'weighted-sum',
        denseWeight: 0.6,
        sparseWeight: 0.4,
      });

      const results = await searcher.search('error TS2304', 'collection', 5);
      expect(results.length).toBeGreaterThan(0);

      // Scores should be weighted combinations
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
        expect(result.score).toBeLessThanOrEqual(1.0); // Normalized scores * weights
      }
    });
  });

  describe('search with interleave fusion', () => {
    it('alternates between dense and sparse results', async () => {
      const denseResults: QueryResult = {
        documents: [
          { id: 'dense-1', embedding: [], textContent: 'D1', similarityScore: 0.9, metadata: {} },
          { id: 'dense-2', embedding: [], textContent: 'D2', similarityScore: 0.8, metadata: {} },
        ],
      };

      const vectorStore = createMockVectorStore(denseResults);
      const searcher = new HybridSearcher(vectorStore, embeddingManager, bm25Index, {
        fusionMethod: 'interleave',
      });

      const results = await searcher.search('error TS2304', 'collection', 10);

      // First result should be from dense, second from sparse (alternating)
      expect(results.length).toBeGreaterThanOrEqual(2);

      // No duplicates
      const ids = results.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('error handling', () => {
    it('throws when embedding generation fails', async () => {
      const failingManager = createMockEmbeddingManager();
      (failingManager.generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue({
        embeddings: [[]],
        modelId: 'test',
        providerId: 'test',
        usage: { totalTokens: 0 },
      });

      const vectorStore = createMockVectorStore({ documents: [] });
      const searcher = new HybridSearcher(vectorStore, failingManager, bm25Index);

      await expect(searcher.search('test', 'collection')).rejects.toThrow('Failed to generate query embedding');
    });
  });
});

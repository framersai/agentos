/**
 * @fileoverview Tests for multi-hypothesis HyDE retrieval.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HydeRetriever, type HydeLlmCaller } from '../HydeRetriever.js';
import type { IEmbeddingManager, EmbeddingResponse } from '../IEmbeddingManager.js';
import type { IVectorStore, QueryResult } from '../IVectorStore.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockEmbeddingManager(
  embeddings: number[][] = [[0.1, 0.2, 0.3]],
): IEmbeddingManager {
  return {
    initialize: vi.fn(),
    generateEmbeddings: vi.fn().mockImplementation(({ texts }: { texts: string | string[] }) => {
      const count = Array.isArray(texts) ? texts.length : 1;
      return Promise.resolve({
        embeddings: Array.from({ length: count }, (_, i) =>
          embeddings[i % embeddings.length],
        ),
        modelId: 'test-model',
        providerId: 'test-provider',
        usage: { totalTokens: count * 10 },
      } satisfies EmbeddingResponse);
    }),
    getEmbeddingModelInfo: vi.fn(),
    getEmbeddingDimension: vi.fn().mockResolvedValue(3),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  };
}

function createMockVectorStore(results: QueryResult = { documents: [] }): IVectorStore {
  return {
    initialize: vi.fn(),
    upsert: vi.fn(),
    query: vi.fn().mockResolvedValue(results),
    delete: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
    shutdown: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Multi-hypothesis HyDE', () => {
  let embeddingManager: ReturnType<typeof createMockEmbeddingManager>;

  beforeEach(() => {
    embeddingManager = createMockEmbeddingManager([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ]);
  });

  describe('generateMultipleHypotheses', () => {
    it('generates 3 diverse hypotheses by default', async () => {
      const llmCaller: HydeLlmCaller = vi.fn().mockResolvedValue(
        'Hypothesis 1 (technical perspective):\nBM25 is a ranking function based on term frequency.\n\n' +
        'Hypothesis 2 (practical perspective):\nTo implement BM25, tokenize documents and compute IDF.\n\n' +
        'Hypothesis 3 (overview perspective):\nBM25 is widely used in search engines for document ranking.',
      );

      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 3 },
        llmCaller,
        embeddingManager,
      });

      const { hypotheses, latencyMs } = await retriever.generateMultipleHypotheses(
        'How does BM25 work?',
      );

      expect(hypotheses).toHaveLength(3);
      expect(latencyMs).toBeGreaterThanOrEqual(0);
      expect(llmCaller).toHaveBeenCalledOnce();

      // Each hypothesis should be non-empty
      for (const h of hypotheses) {
        expect(h.trim().length).toBeGreaterThan(0);
      }
    });

    it('falls back to single hypothesis when count is 1', async () => {
      const llmCaller: HydeLlmCaller = vi.fn().mockResolvedValue('Single hypothesis answer');

      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 1 },
        llmCaller,
        embeddingManager,
      });

      const { hypotheses } = await retriever.generateMultipleHypotheses('query', 1);
      expect(hypotheses).toHaveLength(1);
      expect(hypotheses[0]).toBe('Single hypothesis answer');
    });

    it('handles LLM response that does not follow expected format', async () => {
      const llmCaller: HydeLlmCaller = vi
        .fn()
        .mockResolvedValueOnce('Just a plain text response without hypothesis markers')
        .mockResolvedValue('Fallback hypothesis');

      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 3 },
        llmCaller,
        embeddingManager,
      });

      const { hypotheses } = await retriever.generateMultipleHypotheses('query');

      // Should still return 3 hypotheses (1 from malformed + 2 fallbacks)
      expect(hypotheses).toHaveLength(3);
    });

    it('accepts count override parameter', async () => {
      const llmCaller: HydeLlmCaller = vi.fn().mockResolvedValue(
        'Hypothesis 1 (technical):\nA\n\nHypothesis 2 (practical):\nB\n\n' +
        'Hypothesis 3 (overview):\nC\n\nHypothesis 4 (troubleshooting):\nD\n\n' +
        'Hypothesis 5 (comparative):\nE',
      );

      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 3 },
        llmCaller,
        embeddingManager,
      });

      const { hypotheses } = await retriever.generateMultipleHypotheses('query', 5);
      expect(hypotheses).toHaveLength(5);
    });
  });

  describe('retrieveMulti', () => {
    it('searches with each hypothesis embedding and deduplicates results', async () => {
      const llmCaller: HydeLlmCaller = vi.fn().mockResolvedValue(
        'Hypothesis 1 (technical):\nTechnical answer.\n\n' +
        'Hypothesis 2 (practical):\nPractical answer.\n\n' +
        'Hypothesis 3 (overview):\nOverview answer.',
      );

      // Different searches return overlapping results
      const vectorStore = createMockVectorStore();
      (vectorStore.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          documents: [
            { id: 'doc-1', embedding: [], textContent: 'Doc 1', similarityScore: 0.9 },
            { id: 'doc-2', embedding: [], textContent: 'Doc 2', similarityScore: 0.7 },
          ],
        })
        .mockResolvedValueOnce({
          documents: [
            { id: 'doc-2', embedding: [], textContent: 'Doc 2', similarityScore: 0.85 }, // same doc, higher score
            { id: 'doc-3', embedding: [], textContent: 'Doc 3', similarityScore: 0.6 },
          ],
        })
        .mockResolvedValueOnce({
          documents: [
            { id: 'doc-1', embedding: [], textContent: 'Doc 1', similarityScore: 0.75 }, // same doc, lower score
            { id: 'doc-4', embedding: [], textContent: 'Doc 4', similarityScore: 0.5 },
          ],
        });

      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 3 },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieveMulti({
        query: 'test query',
        vectorStore,
        collectionName: 'test-collection',
        queryOptions: { topK: 10 },
      });

      // Should have 3 hypotheses
      expect(result.hypothesisCount).toBe(3);
      expect(result.hypotheses).toHaveLength(3);

      // Vector store should have been called 3 times (once per hypothesis)
      expect(vectorStore.query).toHaveBeenCalledTimes(3);

      // Results should be deduplicated — 4 unique docs
      expect(result.queryResult.documents).toHaveLength(4);

      // doc-1 should keep the highest score (0.9 from first search, not 0.75)
      const doc1 = result.queryResult.documents.find((d) => d.id === 'doc-1');
      expect(doc1?.similarityScore).toBe(0.9);

      // doc-2 should keep the highest score (0.85 from second search, not 0.7)
      const doc2 = result.queryResult.documents.find((d) => d.id === 'doc-2');
      expect(doc2?.similarityScore).toBe(0.85);

      // Results should be sorted by score descending
      for (let i = 1; i < result.queryResult.documents.length; i++) {
        expect(result.queryResult.documents[i - 1].similarityScore)
          .toBeGreaterThanOrEqual(result.queryResult.documents[i].similarityScore);
      }
    });

    it('returns empty result when embedding fails', async () => {
      const llmCaller: HydeLlmCaller = vi.fn().mockResolvedValue(
        'Hypothesis 1:\nA\n\nHypothesis 2:\nB\n\nHypothesis 3:\nC',
      );

      const failingEmbedding = createMockEmbeddingManager();
      (failingEmbedding.generateEmbeddings as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          embeddings: [],
          modelId: 'test',
          providerId: 'test',
          usage: { totalTokens: 0 },
        });

      const vectorStore = createMockVectorStore();
      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 3 },
        llmCaller,
        embeddingManager: failingEmbedding,
      });

      const result = await retriever.retrieveMulti({
        query: 'test',
        vectorStore,
        collectionName: 'collection',
      });

      expect(result.queryResult.documents).toEqual([]);
      expect(result.hypotheses).toHaveLength(3);
    });

    it('applies topK limit to merged results', async () => {
      const llmCaller: HydeLlmCaller = vi.fn().mockResolvedValue(
        'Hypothesis 1:\nA\n\nHypothesis 2:\nB\n\nHypothesis 3:\nC',
      );

      const vectorStore = createMockVectorStore();
      (vectorStore.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        documents: Array.from({ length: 10 }, (_, i) => ({
          id: `doc-${i}`,
          embedding: [],
          textContent: `Doc ${i}`,
          similarityScore: 0.9 - i * 0.05,
        })),
      });

      const retriever = new HydeRetriever({
        config: { enabled: true, hypothesisCount: 3 },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieveMulti({
        query: 'test',
        vectorStore,
        collectionName: 'collection',
        queryOptions: { topK: 3 },
      });

      expect(result.queryResult.documents.length).toBeLessThanOrEqual(3);
    });
  });
});

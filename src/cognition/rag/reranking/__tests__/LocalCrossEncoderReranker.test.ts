/**
 * @fileoverview Unit tests for LocalCrossEncoderReranker provider
 * @module backend/agentos/rag/reranking/tests/LocalCrossEncoderReranker.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalCrossEncoderReranker, LOCAL_RERANKER_MODELS } from '../providers/LocalCrossEncoderReranker';
import type { RerankerInput, RerankerRequestConfig } from '../IRerankerService';

// Mock Transformers.js (preferred: @huggingface/transformers, fallback: @xenova/transformers)
const pipelineInstanceMock = vi.fn();
const pipelineMock = vi.fn();
const envMock: any = {
  cacheDir: undefined,
  backends: { onnx: { wasm: { numThreads: 1 } } },
};

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineMock,
  env: envMock,
}));

vi.mock('@xenova/transformers', () => ({
  pipeline: pipelineMock,
  env: envMock,
}));

describe('LocalCrossEncoderReranker', () => {
  let reranker: LocalCrossEncoderReranker;

  beforeEach(() => {
    vi.clearAllMocks();
    pipelineMock.mockResolvedValue(pipelineInstanceMock);
    pipelineInstanceMock.mockResolvedValue([{ label: 'LABEL_1', score: 0.8 }]);
    reranker = new LocalCrossEncoderReranker({
      providerId: 'local',
      defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should create instance with correct providerId', () => {
      expect(reranker.providerId).toBe('local');
    });

    it('should not load model until first use (lazy initialization)', () => {
      // Model loading happens on first rerank call, not at construction
      expect(pipelineMock).not.toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should return true (local model always available)', async () => {
      const isAvailable = await reranker.isAvailable();
      expect(isAvailable).toBe(true);
    });
  });

  describe('getSupportedModels', () => {
    it('should return list of supported local models', () => {
      const models = reranker.getSupportedModels();
      expect(models).toEqual(LOCAL_RERANKER_MODELS);
      expect(models).toContain('cross-encoder/ms-marco-MiniLM-L-6-v2');
      expect(models).toContain('BAAI/bge-reranker-base');
    });
  });

  describe('rerank', () => {
    const sampleInput: RerankerInput = {
      query: 'What is machine learning?',
      documents: [
        { id: 'doc-1', content: 'Machine learning is a subset of AI.', originalScore: 0.8 },
        { id: 'doc-2', content: 'Deep learning uses neural networks.', originalScore: 0.7 },
        { id: 'doc-3', content: 'Python is a programming language.', originalScore: 0.6 },
      ],
    };

    const sampleConfig: RerankerRequestConfig = {
      providerId: 'local',
      modelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
      topN: 2,
    };

    it('should initialize model on first rerank call', async () => {
      await reranker.rerank(sampleInput, sampleConfig);

      expect(pipelineMock).toHaveBeenCalledWith(
        'text-classification',
        'cross-encoder/ms-marco-MiniLM-L-6-v2',
        expect.objectContaining({ quantized: true }),
      );
    });

    it('should return reranked documents with scores', async () => {
      const result = await reranker.rerank(sampleInput, sampleConfig);

      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThan(0);
      result.results.forEach((doc) => {
        expect(doc).toHaveProperty('id');
        expect(doc).toHaveProperty('content');
        expect(doc).toHaveProperty('relevanceScore');
        expect(typeof doc.relevanceScore).toBe('number');
      });
    });

    it('should sort results by relevance score descending', async () => {
      const result = await reranker.rerank(sampleInput, sampleConfig);

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].relevanceScore).toBeGreaterThanOrEqual(
          result.results[i].relevanceScore,
        );
      }
    });

    it('should include diagnostics in response', async () => {
      const result = await reranker.rerank(sampleInput, sampleConfig);

      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.providerId).toBe('local');
      expect(result.diagnostics?.modelId).toBe('cross-encoder/ms-marco-MiniLM-L-6-v2');
      expect(result.diagnostics?.documentsProcessed).toBe(3);
      expect(result.diagnostics?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should preserve original scores', async () => {
      const result = await reranker.rerank(sampleInput, sampleConfig);

      const doc1 = result.results.find((r) => r.id === 'doc-1');
      expect(doc1?.originalScore).toBe(0.8);
    });

    it('should preserve document metadata', async () => {
      const inputWithMetadata: RerankerInput = {
        query: 'test',
        documents: [
          {
            id: 'doc-1',
            content: 'Test content',
            metadata: { source: 'wiki', page: 42 },
          },
        ],
      };

      const result = await reranker.rerank(inputWithMetadata, sampleConfig);

      expect(result.results[0].metadata).toEqual({ source: 'wiki', page: 42 });
    });

    it('should use default model when not specified', async () => {
      await reranker.rerank(sampleInput, {
        providerId: 'local',
        modelId: '',
      });

      expect(pipelineMock).toHaveBeenCalledWith(
        'text-classification',
        'cross-encoder/ms-marco-MiniLM-L-6-v2',
        expect.anything(),
      );
    });

    it('should handle empty documents array', async () => {
      const emptyInput: RerankerInput = {
        query: 'test',
        documents: [],
      };

      const result = await reranker.rerank(emptyInput, sampleConfig);

      expect(result.results).toEqual([]);
    });

    it('should reuse loaded model for subsequent calls', async () => {
      await reranker.rerank(sampleInput, sampleConfig);
      await reranker.rerank(sampleInput, sampleConfig);

      // Model should only be loaded once
      expect(pipelineMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Batch Processing', () => {
    it('should process documents in batches for large inputs', async () => {
      const rerankerWithSmallBatch = new LocalCrossEncoderReranker({
        providerId: 'local',
        defaultModelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
        batchSize: 2,
      });

      const manyDocs: RerankerInput = {
        query: 'test',
        documents: Array.from({ length: 5 }, (_, i) => ({
          id: `doc-${i}`,
          content: `Document ${i}`,
        })),
      };

      const result = await rerankerWithSmallBatch.rerank(manyDocs, {
        providerId: 'local',
        modelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
      });

      expect(result.results).toHaveLength(5);
    });
  });

  describe('Score Normalization', () => {
    it('should normalize scores to 0-1 range using sigmoid', async () => {
      const result = await reranker.rerank(
        {
          query: 'test',
          documents: [{ id: 'doc-1', content: 'test content' }],
        },
        { providerId: 'local', modelId: 'cross-encoder/ms-marco-MiniLM-L-6-v2' },
      );

      result.results.forEach((doc) => {
        expect(doc.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(doc.relevanceScore).toBeLessThanOrEqual(1);
      });
    });
  });
});

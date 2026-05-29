/**
 * @fileoverview Unit tests for RerankerService
 * @module backend/agentos/rag/reranking/tests/RerankerService.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RerankerService } from '../RerankerService';
import type {
  IRerankerProvider,
  RerankerInput,
  RerankerOutput,
  RerankerRequestConfig,
  RerankerServiceConfig,
} from '../IRerankerService';
import type { RagRetrievedChunk } from '../../IRetrievalAugmentor';

// Mock provider implementation
const createMockProvider = (providerId: string): IRerankerProvider => ({
  providerId,
  rerank: vi.fn().mockImplementation(async (input: RerankerInput, _config: RerankerRequestConfig): Promise<RerankerOutput> => {
    // Simulate reranking by reversing order and assigning new scores
    const results = input.documents.map((doc, idx) => ({
      id: doc.id,
      content: doc.content,
      relevanceScore: 1 - (idx * 0.1), // Descending scores
      originalScore: doc.originalScore,
      metadata: doc.metadata,
    }));
    // Sort by relevanceScore descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return { results };
  }),
  isAvailable: vi.fn().mockResolvedValue(true),
  getSupportedModels: vi.fn().mockReturnValue(['model-1', 'model-2']),
});

describe('RerankerService', () => {
  let service: RerankerService;
  let mockProvider: IRerankerProvider;
  const defaultConfig: RerankerServiceConfig = {
    providers: [
      { providerId: 'mock-provider', defaultModelId: 'model-1' },
    ],
    defaultProviderId: 'mock-provider',
    defaultModelId: 'model-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RerankerService({ config: defaultConfig });
    mockProvider = createMockProvider('mock-provider');
    service.registerProvider(mockProvider);
  });

  describe('Provider Registration', () => {
    it('should register a provider', () => {
      const newProvider = createMockProvider('new-provider');
      service.registerProvider(newProvider);
      expect(service.getProvider('new-provider')).toBe(newProvider);
    });

    it('should list registered providers', () => {
      const providers = service.listProviders();
      expect(providers).toContain('mock-provider');
    });

    it('should return undefined for unregistered provider', () => {
      expect(service.getProvider('nonexistent')).toBeUndefined();
    });

    it('should check provider availability', async () => {
      const isAvailable = await service.isProviderAvailable('mock-provider');
      expect(isAvailable).toBe(true);
      expect(mockProvider.isAvailable).toHaveBeenCalled();
    });

    it('should return false for unavailable provider', async () => {
      const isAvailable = await service.isProviderAvailable('nonexistent');
      expect(isAvailable).toBe(false);
    });
  });

  describe('Reranking Operations', () => {
    const sampleInput: RerankerInput = {
      query: 'test query',
      documents: [
        { id: 'doc-1', content: 'First document', originalScore: 0.8 },
        { id: 'doc-2', content: 'Second document', originalScore: 0.9 },
        { id: 'doc-3', content: 'Third document', originalScore: 0.7 },
      ],
    };

    it('should rerank documents using default provider', async () => {
      const result = await service.rerank(sampleInput);

      expect(result.results).toBeDefined();
      expect(result.results.length).toBe(3);
      expect(mockProvider.rerank).toHaveBeenCalledWith(
        sampleInput,
        expect.objectContaining({
          providerId: 'mock-provider',
          modelId: 'model-1',
        }),
      );
    });

    it('should rerank documents using specified provider', async () => {
      const alternateProvider = createMockProvider('alternate-provider');
      service.registerProvider(alternateProvider);

      await service.rerank(sampleInput, { providerId: 'alternate-provider' });

      expect(alternateProvider.rerank).toHaveBeenCalled();
      expect(mockProvider.rerank).not.toHaveBeenCalled();
    });

    it('should throw error when provider not found', async () => {
      await expect(
        service.rerank(sampleInput, { providerId: 'nonexistent' }),
      ).rejects.toThrow("Provider 'nonexistent' not found");
    });

    it('should throw error when no provider specified and no default', async () => {
      const noDefaultService = new RerankerService({
        config: { providers: [], defaultProviderId: undefined },
      });

      await expect(noDefaultService.rerank(sampleInput)).rejects.toThrow(
        'No provider specified and no default configured',
      );
    });

    it('should apply topN limit', async () => {
      const result = await service.rerank(sampleInput, { topN: 2 });

      expect(result.results.length).toBe(2);
    });

    it('should apply maxDocuments limit before reranking', async () => {
      const manyDocs: RerankerInput = {
        query: 'test',
        documents: Array.from({ length: 150 }, (_, i) => ({
          id: `doc-${i}`,
          content: `Document ${i}`,
        })),
      };

      await service.rerank(manyDocs, { maxDocuments: 50 });

      expect(mockProvider.rerank).toHaveBeenCalledWith(
        expect.objectContaining({
          documents: expect.arrayContaining([]),
        }),
        expect.anything(),
      );
      // Check that only 50 documents were sent
      const callArgs = (mockProvider.rerank as any).mock.calls[0][0];
      expect(callArgs.documents.length).toBe(50);
    });
  });

  describe('rerankChunks', () => {
    const sampleChunks: RagRetrievedChunk[] = [
      {
        id: 'chunk-1',
        content: 'First chunk content',
        originalDocumentId: 'doc-1',
        relevanceScore: 0.8,
        metadata: { source: 'test' },
      },
      {
        id: 'chunk-2',
        content: 'Second chunk content',
        originalDocumentId: 'doc-1',
        relevanceScore: 0.9,
        metadata: { source: 'test' },
      },
      {
        id: 'chunk-3',
        content: 'Third chunk content',
        originalDocumentId: 'doc-2',
        relevanceScore: 0.7,
        metadata: { source: 'test' },
      },
    ];

    it('should rerank RAG chunks', async () => {
      const result = await service.rerankChunks('test query', sampleChunks);

      expect(result.length).toBe(3);
      expect(result[0]).toHaveProperty('relevanceScore');
      expect(result[0]).toHaveProperty('originalDocumentId');
    });

    it('should preserve chunk metadata with reranker info', async () => {
      const result = await service.rerankChunks('test query', sampleChunks);

      expect(result[0].metadata).toHaveProperty('_rerankerOriginalScore');
      expect(result[0].metadata).toHaveProperty('_rerankerProviderId');
    });

    it('should return empty array for empty input', async () => {
      const result = await service.rerankChunks('test query', []);
      expect(result).toEqual([]);
    });

    it('should apply topN to reranked chunks', async () => {
      const result = await service.rerankChunks('test query', sampleChunks, {
        topN: 2,
      });

      expect(result.length).toBe(2);
    });

    it('should throw error for unknown document ID in results', async () => {
      // Create a provider that returns an unknown document ID
      const badProvider: IRerankerProvider = {
        providerId: 'bad-provider',
        rerank: vi.fn().mockResolvedValue({
          results: [{ id: 'unknown-id', content: 'test', relevanceScore: 1.0 }],
        }),
        isAvailable: vi.fn().mockResolvedValue(true),
      };

      const badService = new RerankerService({
        config: {
          providers: [{ providerId: 'bad-provider' }],
          defaultProviderId: 'bad-provider',
        },
      });
      badService.registerProvider(badProvider);

      await expect(
        badService.rerankChunks('test', sampleChunks),
      ).rejects.toThrow('unknown document ID');
    });
  });

  describe('Configuration', () => {
    it('should get provider config', () => {
      const config = service.getProviderConfig('mock-provider');
      expect(config).toBeDefined();
      expect(config?.defaultModelId).toBe('model-1');
    });

    it('should return undefined for unknown provider config', () => {
      const config = service.getProviderConfig('nonexistent');
      expect(config).toBeUndefined();
    });

    it('should use provider default model when not specified', async () => {
      await service.rerank({
        query: 'test',
        documents: [{ id: '1', content: 'test' }],
      });

      expect(mockProvider.rerank).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ modelId: 'model-1' }),
      );
    });

    it('should override default model with request config', async () => {
      await service.rerank(
        { query: 'test', documents: [{ id: '1', content: 'test' }] },
        { modelId: 'custom-model' },
      );

      expect(mockProvider.rerank).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ modelId: 'custom-model' }),
      );
    });
  });
});

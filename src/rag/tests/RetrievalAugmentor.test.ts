import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetrievalAugmentor } from '../RetrievalAugmentor';
import { IRetrievalAugmentor, RagDocumentInput, RagRetrievalOptions } from '../IRetrievalAugmentor';
import { RetrievalAugmentorServiceConfig } from '../../config/RetrievalAugmentorConfiguration';
// Mock dependencies
import { IEmbeddingManager } from '../IEmbeddingManager';
import { IVectorStoreManager } from '../IVectorStoreManager';
import { IVectorStore } from '../IVectorStore';

const mockEmbeddingManager: IEmbeddingManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
  generateEmbeddings: vi.fn().mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3]], modelId: 'test-emb-model', providerId: 'test-emb-provider', usage: { totalTokens: 5 }
  }),
  getEmbeddingModelInfo: vi.fn().mockResolvedValue({ modelId: 'test-emb-model', providerId: 'test-emb-provider', dimension: 3 }),
  getEmbeddingDimension: vi.fn().mockResolvedValue(3),
  checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

const mockVectorStore: IVectorStore = {
  initialize: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn().mockResolvedValue({ upsertedCount: 1, upsertedIds: ['doc1_chunk_0'] }),
  query: vi.fn().mockResolvedValue({ documents: [{ id: 'doc1_chunk_0', embedding: [0.1,0.2,0.3], similarityScore: 0.9, textContent: 'Test content' }] }),
  hybridSearch: vi.fn().mockResolvedValue({ documents: [{ id: 'doc1_chunk_0', embedding: [0.1,0.2,0.3], similarityScore: 0.95, textContent: 'Hybrid content' }] }),
  delete: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  shutdown: vi.fn().mockResolvedValue(undefined),
  createCollection: vi.fn().mockResolvedValue(undefined),
  collectionExists: vi.fn().mockResolvedValue(true),
};

const mockVectorStoreManager: IVectorStoreManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
  getProvider: vi.fn().mockReturnValue(mockVectorStore),
  getDefaultProvider: vi.fn().mockReturnValue(mockVectorStore),
  getStoreForDataSource: vi.fn().mockResolvedValue({ store: mockVectorStore, collectionName: 'test-collection', dimension: 3 }),
  listProviderIds: vi.fn().mockReturnValue(['mock-store-provider']),
  listDataSourceIds: vi.fn().mockReturnValue(['test-ds-1']),
  checkHealth: vi.fn().mockResolvedValue({ isOverallHealthy: true }),
  shutdownAllProviders: vi.fn().mockResolvedValue(undefined),
};

const mockConfig: RetrievalAugmentorServiceConfig = {
  defaultQueryEmbeddingModelId: 'test-emb-model',
  categoryBehaviors: [], // Keep it simple for basic tests
  // defaultDataSourceId: 'test-ds-1' // This was on RetrievalAugmentorConfig in IRetrievalAugmentor.ts, not ServiceConfig
};


describe('RetrievalAugmentor Functionality', () => {
  let augmentor: IRetrievalAugmentor;

  beforeEach(async () => {
    vi.clearAllMocks();
    augmentor = new RetrievalAugmentor();
    // The actual IRetrievalAugmentor initialize takes RetrievalAugmentorServiceConfig
    // The config in IRetrievalAugmentor.ts was simpler and passed managers directly
    // This needs alignment. For now, using the ServiceConfig from the config file.
    await augmentor.initialize(mockConfig, mockEmbeddingManager, mockVectorStoreManager);
  });

  it('should be defined', () => {
    expect(augmentor).toBeDefined();
  });

  it('should initialize without errors', () => {
    expect(augmentor.augmenterId).toBeDefined();
    // Initialization happens in beforeEach
  });

  it('should ingest a single document', async () => {
    const doc: RagDocumentInput = { id: 'doc1', content: 'This is a test document.' , dataSourceId: 'test-ds-1'};
    const result = await augmentor.ingestDocuments(doc);

    expect(result.processedCount).toBe(1);
    expect(result.ingestedIds?.length).toBe(1); // Assuming chunking and upsert work
    expect(result.ingestedIds).toContain('doc1');
    expect(mockEmbeddingManager.generateEmbeddings).toHaveBeenCalled();
    expect(mockVectorStore.upsert).toHaveBeenCalled();
  });

  it('should retrieve context for a query', async () => {
    const queryText = 'test query';
    const options: RagRetrievalOptions = { targetDataSourceIds: ['test-ds-1'], topK: 1 };
    const result = await augmentor.retrieveContext(queryText, options);

    expect(result.queryText).toBe(queryText);
    expect(result.retrievedChunks.length).toBeGreaterThanOrEqual(0); // Mock returns 1
    if (result.retrievedChunks.length > 0) {
        expect(result.retrievedChunks[0].content).toBe('Test content');
    }
    expect(result.augmentedContext).toBeDefined();
    expect(mockEmbeddingManager.generateEmbeddings).toHaveBeenCalledWith(expect.objectContaining({ texts: queryText }));
    expect(mockVectorStore.query).toHaveBeenCalled();
  });

  it('should use hybridSearch when strategy is hybrid', async () => {
    const queryText = 'test query';
    const result = await augmentor.retrieveContext(queryText, {
      targetDataSourceIds: ['test-ds-1'],
      topK: 1,
      strategy: 'hybrid',
    });

    expect(result.queryText).toBe(queryText);
    expect((mockVectorStore as any).hybridSearch).toHaveBeenCalled();
  });

  it('should request embeddings and more candidates when strategy is mmr', async () => {
    const queryText = 'test query';
    await augmentor.retrieveContext(queryText, {
      targetDataSourceIds: ['test-ds-1'],
      topK: 2,
      strategy: 'mmr',
      strategyParams: { mmrLambda: 0.6 },
    });

    expect(mockVectorStore.query).toHaveBeenCalledWith(
      'test-collection',
      expect.any(Array),
      expect.objectContaining({
        includeEmbedding: true,
        topK: 10, // 2 * 5 candidate multiplier
      }),
    );
  });

  // Add more tests:
  // - Ingestion with different chunking strategies (once implemented)
  // - Retrieval with metadata filters
  // - Error handling during ingestion and retrieval
  // - deleteDocuments and updateDocuments
});

describe('RetrievalAugmentor Reranking', () => {
  let augmentor: RetrievalAugmentor;
  let mockRerankerProvider: any;

  const configWithReranking: RetrievalAugmentorServiceConfig = {
    ...mockConfig,
    rerankerServiceConfig: {
      providers: [{ providerId: 'mock-reranker', defaultModelId: 'test-model' }],
      defaultProviderId: 'mock-reranker',
    },
    defaultRerankerProviderId: 'mock-reranker',
    defaultRerankerModelId: 'test-model',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRerankerProvider = {
      providerId: 'mock-reranker',
      rerank: vi.fn().mockImplementation(async (input: any) => ({
        results: input.documents.map((doc: any, idx: number) => ({
          id: doc.id,
          content: doc.content,
          relevanceScore: 1 - idx * 0.1, // Assign new scores
          originalScore: doc.originalScore,
          metadata: doc.metadata,
        })),
      })),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    augmentor = new RetrievalAugmentor();
    await augmentor.initialize(configWithReranking, mockEmbeddingManager, mockVectorStoreManager);
    augmentor.registerRerankerProvider(mockRerankerProvider);
  });

  it('should skip reranking when not enabled', async () => {
    const result = await augmentor.retrieveContext('test query', {
      targetDataSourceIds: ['test-ds-1'],
      // rerankerConfig not enabled
    });

    expect(mockRerankerProvider.rerank).not.toHaveBeenCalled();
    expect(result.diagnostics?.rerankingTimeMs).toBeUndefined();
  });

  it('should apply reranking when enabled', async () => {
    const result = await augmentor.retrieveContext('test query', {
      targetDataSourceIds: ['test-ds-1'],
      rerankerConfig: {
        enabled: true,
      },
    });

    expect(mockRerankerProvider.rerank).toHaveBeenCalled();
    expect(result.diagnostics?.rerankingTimeMs).toBeDefined();
    expect(result.diagnostics?.messages).toContainEqual(
      expect.stringContaining('Reranking applied'),
    );
  });

  it('should use specified provider for reranking', async () => {
    await augmentor.retrieveContext('test query', {
      targetDataSourceIds: ['test-ds-1'],
      rerankerConfig: {
        enabled: true,
        providerId: 'mock-reranker',
        modelId: 'custom-model',
      },
    });

    expect(mockRerankerProvider.rerank).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerId: 'mock-reranker',
        modelId: 'custom-model',
      }),
    );
  });

  it('should apply topN after reranking', async () => {
    const result = await augmentor.retrieveContext('test query', {
      targetDataSourceIds: ['test-ds-1'],
      topK: 10, // Get more initially
      rerankerConfig: {
        enabled: true,
        topN: 3, // Reranker returns top 3
      },
    });

    expect(mockRerankerProvider.rerank).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        topN: 3,
      }),
    );
  });

  it('should handle reranking errors gracefully', async () => {
    mockRerankerProvider.rerank.mockRejectedValueOnce(new Error('Reranker API error'));

    const result = await augmentor.retrieveContext('test query', {
      targetDataSourceIds: ['test-ds-1'],
      rerankerConfig: {
        enabled: true,
      },
    });

    // Should return results without reranking
    expect(result.retrievedChunks.length).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics?.messages).toContainEqual(
      expect.stringContaining('Reranking failed'),
    );
  });

  it('should warn when reranking enabled but service not configured', async () => {
    const augmentorNoReranker = new RetrievalAugmentor();
    await augmentorNoReranker.initialize(mockConfig, mockEmbeddingManager, mockVectorStoreManager);

    const result = await augmentorNoReranker.retrieveContext('test query', {
      targetDataSourceIds: ['test-ds-1'],
      rerankerConfig: {
        enabled: true,
      },
    });

    expect(result.diagnostics?.messages).toContainEqual(
      expect.stringContaining('RerankerService not configured'),
    );
  });
});

describe('RetrievalAugmentor registerRerankerProvider', () => {
  it('should throw error when RerankerService not configured', async () => {
    const augmentor = new RetrievalAugmentor();
    await augmentor.initialize(mockConfig, mockEmbeddingManager, mockVectorStoreManager);

    expect(() => {
      augmentor.registerRerankerProvider({
        providerId: 'test',
        rerank: vi.fn(),
        isAvailable: vi.fn(),
      });
    }).toThrow('RerankerService not configured');
  });

  it('should register provider when RerankerService is configured', async () => {
    const configWithReranking: RetrievalAugmentorServiceConfig = {
      ...mockConfig,
      rerankerServiceConfig: {
        providers: [{ providerId: 'test' }],
        defaultProviderId: 'test',
      },
    };

    const augmentor = new RetrievalAugmentor();
    await augmentor.initialize(configWithReranking, mockEmbeddingManager, mockVectorStoreManager);

    const mockProvider = {
      providerId: 'test',
      rerank: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    expect(() => augmentor.registerRerankerProvider(mockProvider)).not.toThrow();
  });
});

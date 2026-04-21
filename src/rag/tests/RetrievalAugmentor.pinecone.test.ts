import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RetrievalAugmentor } from '../RetrievalAugmentor';
import { VectorStoreManager } from '../VectorStoreManager';
import type { RetrievalAugmentorServiceConfig } from '../../config/RetrievalAugmentorConfiguration';
import type { IEmbeddingManager } from '../IEmbeddingManager';
import type {
  PineconeVectorStoreConfig,
  RagDataSourceConfig,
  VectorStoreManagerConfig,
} from '../../core/config/VectorStoreConfiguration';

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
const fetchResponseQueue: Array<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}> = [];

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function errResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  };
}

const mockFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  fetchCalls.push({ url, init: init ?? {} });
  if (fetchResponseQueue.length > 0) return fetchResponseQueue.shift()!;
  return okJson({});
});

vi.stubGlobal('fetch', mockFetch);

function resetFetchMocks() {
  fetchCalls.length = 0;
  fetchResponseQueue.length = 0;
  mockFetch.mockClear();
}

function parseFetchBody(call: { url: string; init: RequestInit }) {
  return JSON.parse(call.init.body as string);
}

const mockEmbeddingManager: IEmbeddingManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
  generateEmbeddings: vi.fn().mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3, 0.4]],
    modelId: 'test-emb-model',
    providerId: 'test-emb-provider',
    usage: { totalTokens: 1 },
  }),
  getEmbeddingModelInfo: vi.fn().mockResolvedValue({
    modelId: 'test-emb-model',
    providerId: 'test-emb-provider',
    dimension: 4,
  }),
  getEmbeddingDimension: vi.fn().mockResolvedValue(4),
  checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

const ragConfig: RetrievalAugmentorServiceConfig = {
  defaultQueryEmbeddingModelId: 'test-emb-model',
  categoryBehaviors: [],
};

describe('RetrievalAugmentor Pinecone runtime integration', () => {
  let augmentor: RetrievalAugmentor | undefined;
  let vectorStoreManager: VectorStoreManager | undefined;

  beforeEach(() => {
    resetFetchMocks();
  });

  afterEach(async () => {
    await augmentor?.shutdown().catch(() => undefined);
    await vectorStoreManager?.shutdownAllProviders().catch(() => undefined);
    vi.useRealTimers();
    resetFetchMocks();
  });

  async function initializePineconeAugmentor(
    dataSourceId = 'pinecone-docs',
    actualNameInProvider = 'agentos-docs',
  ): Promise<RetrievalAugmentor> {
    const providerConfig: PineconeVectorStoreConfig = {
      id: 'pinecone-prod',
      type: 'pinecone',
      apiKey: 'test-api-key',
      indexHost: 'https://my-index-abc.svc.aped-1234.pinecone.io',
      apiVersion: '2026-04',
    };

    const managerConfig: VectorStoreManagerConfig = {
      managerId: 'vsm-pinecone-retrieval-test',
      providers: [providerConfig],
      defaultProviderId: 'pinecone-prod',
    };

    const dataSources: RagDataSourceConfig[] = [
      {
        dataSourceId,
        displayName: 'Pinecone Docs',
        vectorStoreProviderId: 'pinecone-prod',
        actualNameInProvider,
        embeddingDimension: 4,
      },
    ];

    vectorStoreManager = new VectorStoreManager();
    await vectorStoreManager.initialize(managerConfig, dataSources);

    augmentor = new RetrievalAugmentor();
    await augmentor.initialize(ragConfig, mockEmbeddingManager, vectorStoreManager);
    return augmentor;
  }

  it('deletes logical documents via Pinecone metadata filter without falling back to raw ids', async () => {
    fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
    fetchResponseQueue.push(okJson({}));
    const runtimeAugmentor = await initializePineconeAugmentor();

    const result = await runtimeAugmentor.deleteDocuments(['doc-1'], 'pinecone-docs');

    const deleteCalls = fetchCalls.filter(call => call.url.includes('/vectors/delete'));
    expect(deleteCalls).toHaveLength(1);

    const deleteBody = parseFetchBody(deleteCalls[0]);
    expect(deleteBody.namespace).toBe('agentos-docs');
    expect(deleteBody.filter).toEqual({ originalDocumentId: { $eq: 'doc-1' } });
    expect(deleteBody.ids).toBeUndefined();
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
  });

  it('retries throttled Pinecone metadata deletes without falling back to raw ids', async () => {
    fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
    const runtimeAugmentor = await initializePineconeAugmentor();

    resetFetchMocks();
    vi.useFakeTimers();
    fetchResponseQueue.push(errResponse(429, 'rate limited'));
    fetchResponseQueue.push(okJson({}));

    const resultPromise = runtimeAugmentor.deleteDocuments(['doc-1'], 'pinecone-docs');

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    const deleteCalls = fetchCalls.filter(call => call.url.includes('/vectors/delete'));
    expect(deleteCalls).toHaveLength(2);
    expect(parseFetchBody(deleteCalls[0]).filter).toEqual({ originalDocumentId: { $eq: 'doc-1' } });
    expect(parseFetchBody(deleteCalls[0]).ids).toBeUndefined();
    expect(parseFetchBody(deleteCalls[1]).filter).toEqual({ originalDocumentId: { $eq: 'doc-1' } });
    expect(parseFetchBody(deleteCalls[1]).ids).toBeUndefined();
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
  });

  it('retries throttled Pinecone upserts during ingestion', async () => {
    fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
    const runtimeAugmentor = await initializePineconeAugmentor();

    resetFetchMocks();
    vi.useFakeTimers();
    fetchResponseQueue.push(errResponse(429, 'rate limited'));
    fetchResponseQueue.push(okJson({ upsertedCount: 1 }));

    const resultPromise = runtimeAugmentor.ingestDocuments({
      id: 'doc-1',
      content: 'Pinecone ingestion retry test',
      dataSourceId: 'pinecone-docs',
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    const upsertCalls = fetchCalls.filter(call => call.url.includes('/vectors/upsert'));
    expect(upsertCalls).toHaveLength(2);
    expect(parseFetchBody(upsertCalls[0]).vectors[0].id).toBe('doc-1_chunk_0');
    expect(parseFetchBody(upsertCalls[1]).vectors[0].id).toBe('doc-1_chunk_0');
    expect(result.processedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.ingestedIds).toContain('doc-1');
  });

  it('retries throttled Pinecone queries during retrieval', async () => {
    fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
    const runtimeAugmentor = await initializePineconeAugmentor();

    resetFetchMocks();
    vi.useFakeTimers();
    fetchResponseQueue.push(errResponse(429, 'rate limited'));
    fetchResponseQueue.push(okJson({
      matches: [
        {
          id: 'doc-1_chunk_0',
          score: 0.92,
          metadata: {
            originalDocumentId: 'doc-1',
            source: 'pinecone',
          },
        },
      ],
    }));

    const resultPromise = runtimeAugmentor.retrieveContext('retry query', {
      targetDataSourceIds: ['pinecone-docs'],
      topK: 1,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    const queryCalls = fetchCalls.filter(call => call.url.endsWith('/query'));
    expect(queryCalls).toHaveLength(2);
    expect(result.retrievedChunks).toHaveLength(1);
    expect(result.retrievedChunks[0]).toMatchObject({
      id: 'doc-1_chunk_0',
      originalDocumentId: 'doc-1',
      dataSourceId: 'pinecone-docs',
      source: 'pinecone',
    });
  });
});

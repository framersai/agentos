import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryLifecycleManager } from '../MemoryLifecycleManager';
import type { GMIResolverFunction } from '../IMemoryLifecycleManager';
import type { MemoryLifecycleManagerConfig } from '../../../../core/config/MemoryLifecycleManagerConfiguration';
import { VectorStoreManager } from '../../../../rag/VectorStoreManager';
import type {
  PineconeVectorStoreConfig,
  RagDataSourceConfig,
  VectorStoreManagerConfig,
} from '../../../../core/config/VectorStoreConfiguration';

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

const deletePolicyId = 'delete-old-docs';
const noopGMIResolver: GMIResolverFunction = vi.fn().mockResolvedValue(null);

const lifecycleConfig: MemoryLifecycleManagerConfig = {
  managerId: 'mlm-pinecone-integration-test',
  policies: [
    {
      policyId: deletePolicyId,
      description: 'Deletes expired Pinecone-backed lifecycle items.',
      isEnabled: true,
      priority: 10,
      appliesTo: {
        categories: ['conversation_history', 'general_log'] as any,
        dataSourceIds: ['pinecone-memory'],
      },
      retentionDays: 30,
      action: { type: 'delete' },
      gmiNegotiation: { enabled: false },
    },
  ],
  defaultCheckInterval: 'PT1H',
  dryRunMode: false,
  defaultRetentionDays: 30,
  defaultGMINegotiationTimeoutMs: 1000,
  itemTimestampMetadataField: 'timestamp',
};

describe('MemoryLifecycleManager Pinecone runtime integration', () => {
  let mlm: MemoryLifecycleManager | undefined;
  let vectorStoreManager: VectorStoreManager | undefined;

  beforeEach(() => {
    resetFetchMocks();
  });

  afterEach(async () => {
    await mlm?.shutdown().catch(() => undefined);
    await vectorStoreManager?.shutdownAllProviders().catch(() => undefined);
    resetFetchMocks();
  });

  it('enforcePolicies discovers and deletes expired Pinecone records through VectorStoreManager', async () => {
    const expiredTimestamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
    fetchResponseQueue.push(okJson({
      vectors: {
        'old-memory-001': {
          id: 'old-memory-001',
          values: [0.1, 0.2, 0.3, 0.4],
          metadata: {
            category: 'general_log',
            timestamp: expiredTimestamp,
            source: 'pinecone-memory',
          },
        },
      },
      namespace: 'agentos-memory',
    }));
    fetchResponseQueue.push(okJson({}));

    const providerConfig: PineconeVectorStoreConfig = {
      id: 'pinecone-prod',
      type: 'pinecone',
      apiKey: 'test-api-key',
      indexHost: 'https://my-index-abc.svc.aped-1234.pinecone.io',
      apiVersion: '2026-04',
    };

    const managerConfig: VectorStoreManagerConfig = {
      managerId: 'vsm-pinecone-integration-test',
      providers: [providerConfig],
      defaultProviderId: 'pinecone-prod',
    };

    const dataSources: RagDataSourceConfig[] = [
      {
        dataSourceId: 'pinecone-memory',
        displayName: 'Pinecone Memory',
        vectorStoreProviderId: 'pinecone-prod',
        actualNameInProvider: 'agentos-memory',
        embeddingDimension: 4,
      },
    ];

    vectorStoreManager = new VectorStoreManager();
    await vectorStoreManager.initialize(managerConfig, dataSources);

    mlm = new MemoryLifecycleManager();
    await mlm.initialize(lifecycleConfig, vectorStoreManager, noopGMIResolver);

    const report = await mlm.enforcePolicies({ policyIds: [deletePolicyId] });

    const scanCall = fetchCalls.find(call => call.url.includes('/vectors/fetch_by_metadata'));
    const deleteCall = fetchCalls.find(call => call.url.includes('/vectors/delete'));

    expect(scanCall).toBeDefined();
    expect(deleteCall).toBeDefined();

    const scanHeaders = scanCall?.init.headers as Record<string, string>;
    expect(scanHeaders['X-Pinecone-Api-Version']).toBe('2026-04');

    const scanBody = parseFetchBody(scanCall!);
    expect(scanBody.namespace).toBe('agentos-memory');
    expect(scanBody.filter.$and).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: { $in: ['conversation_history', 'general_log'] },
        }),
        expect.objectContaining({
          timestamp: { $lt: expect.any(String) },
        }),
      ]),
    );

    const deleteBody = parseFetchBody(deleteCall!);
    expect(deleteBody.namespace).toBe('agentos-memory');
    expect(deleteBody.ids).toEqual(['old-memory-001']);

    expect(report.itemsScanned).toBe(1);
    expect(report.itemsAffected).toBe(1);
    expect(report.policyResults?.[deletePolicyId]?.actionsTaken?.delete).toBe(1);
  });
});

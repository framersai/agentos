/**
 * @fileoverview Unit tests for PineconeVectorStore with mocked global fetch.
 *
 * All Pinecone API calls are intercepted via vi.stubGlobal('fetch', ...) so
 * no network access is required. Tests verify correct URL construction,
 * request bodies, header handling, batch splitting, and response parsing.
 *
 * @module rag/implementations/vector_stores/__tests__/PineconeVectorStore.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

/** Captured fetch calls: URL + init. */
const fetchCalls: Array<{ url: string; init: RequestInit }> = [];

/** Queue of responses returned by the mock fetch (FIFO). */
const fetchResponseQueue: Array<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}> = [];

/** Default OK response factory. */
function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

/** Default error response factory. */
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

// ---------------------------------------------------------------------------
// Import class under test after mocks are installed.
// ---------------------------------------------------------------------------

import { PineconeVectorStore } from '../PineconeVectorStore.js';
import type { PineconeVectorStoreConfig } from '../PineconeVectorStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<PineconeVectorStoreConfig>): PineconeVectorStoreConfig {
  return {
    id: 'test-pinecone',
    type: 'pinecone',
    apiKey: 'test-api-key-123',
    indexHost: 'https://my-index-abc.svc.aped-1234.pinecone.io',
    namespace: 'default',
    defaultDimension: 4,
    ...overrides,
  };
}

function resetMocks() {
  fetchCalls.length = 0;
  fetchResponseQueue.length = 0;
  mockFetch.mockClear();
}

function lastFetchCall() {
  return fetchCalls[fetchCalls.length - 1];
}

function parseFetchBody(call: { url: string; init: RequestInit }) {
  return JSON.parse(call.init.body as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PineconeVectorStore', () => {
  let store: PineconeVectorStore;

  beforeEach(() => {
    resetMocks();
  });

  afterEach(async () => {
    try {
      await store?.close();
    } catch { /* ok */ }
    resetMocks();
  });

  // =========================================================================
  // initialize()
  // =========================================================================

  describe('initialize()', () => {
    it('calls /describe_index_stats to verify connectivity', async () => {
      fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toContain('/describe_index_stats');
      expect(fetchCalls[0].init.method).toBe('POST');

      // Verify headers include API key.
      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers['Api-Key']).toBe('test-api-key-123');
    });

    it('throws on non-OK response', async () => {
      fetchResponseQueue.push(errResponse(401, 'unauthorized'));
      store = new PineconeVectorStore(makeConfig());

      await expect(store.initialize()).rejects.toThrow('Pinecone initialization failed (401)');
    });

    it('is idempotent — second call is a no-op', async () => {
      fetchResponseQueue.push(okJson({}));
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      const count = fetchCalls.length;
      await store.initialize();
      expect(fetchCalls.length).toBe(count);
    });
  });

  // =========================================================================
  // upsert()
  // =========================================================================

  describe('upsert()', () => {
    it('sends correct vectors to /vectors/upsert', async () => {
      fetchResponseQueue.push(okJson({})); // init
      fetchResponseQueue.push(okJson({ upsertedCount: 2 })); // upsert
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({ upsertedCount: 2 }));
      const result = await store.upsert('test-ns', [
        { id: 'v1', embedding: [0.1, 0.2, 0.3, 0.4], metadata: { topic: 'ai' }, textContent: 'hello' },
        { id: 'v2', embedding: [0.5, 0.6, 0.7, 0.8] },
      ]);

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toContain('/vectors/upsert');

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.namespace).toBe('test-ns');
      expect(body.vectors.length).toBe(2);
      expect(body.vectors[0].id).toBe('v1');
      expect(body.vectors[0].values).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(body.vectors[0].metadata).toEqual({ topic: 'ai' });

      expect(result.upsertedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });

    it('splits into batches of 100', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      // Create 250 documents.
      const docs = Array.from({ length: 250 }, (_, i) => ({
        id: `d${i}`,
        embedding: [0.1, 0.2, 0.3, 0.4],
      }));

      // Queue 3 batch responses (100 + 100 + 50).
      fetchResponseQueue.push(okJson({ upsertedCount: 100 }));
      fetchResponseQueue.push(okJson({ upsertedCount: 100 }));
      fetchResponseQueue.push(okJson({ upsertedCount: 50 }));

      const result = await store.upsert('ns', docs);

      expect(fetchCalls.length).toBe(3);
      expect(parseFetchBody(fetchCalls[0]).vectors.length).toBe(100);
      expect(parseFetchBody(fetchCalls[1]).vectors.length).toBe(100);
      expect(parseFetchBody(fetchCalls[2]).vectors.length).toBe(50);
      expect(result.upsertedCount).toBe(250);
    });

    it('tracks failed batches', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(errResponse(500, 'server error'));

      const result = await store.upsert('ns', [
        { id: 'f1', embedding: [1, 2, 3, 4] },
        { id: 'f2', embedding: [5, 6, 7, 8] },
      ]);

      expect(result.upsertedCount).toBe(0);
      expect(result.failedCount).toBe(2);
    });
  });

  // =========================================================================
  // query()
  // =========================================================================

  describe('query()', () => {
    it('sends to /query with correct topK and filter', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({
        matches: [
          { id: 'm1', score: 0.95, metadata: { topic: 'ai' } },
          { id: 'm2', score: 0.87 },
        ],
      }));

      const result = await store.query('test-ns', [0.1, 0.2, 0.3, 0.4], {
        topK: 5,
        filter: { topic: { $eq: 'ai' } },
        includeMetadata: true,
      });

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toContain('/query');

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.topK).toBe(5);
      expect(body.namespace).toBe('test-ns');
      expect(body.vector).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(body.includeMetadata).toBe(true);
      expect(body.filter).toBeDefined();

      expect(result.documents.length).toBe(2);
      expect(result.documents[0].id).toBe('m1');
      expect(result.documents[0].similarityScore).toBe(0.95);
      expect(result.documents[0].metadata).toEqual({ topic: 'ai' });
    });

    it('throws on non-OK response', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(errResponse(400, 'bad request'));

      await expect(
        store.query('ns', [1, 2, 3, 4]),
      ).rejects.toThrow('Pinecone query failed');
    });
  });

  // =========================================================================
  // delete()
  // =========================================================================

  describe('delete()', () => {
    it('deletes by IDs', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({}));
      const result = await store.delete('ns', ['a', 'b', 'c']);

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.ids).toEqual(['a', 'b', 'c']);
      expect(body.namespace).toBe('ns');
      expect(result.deletedCount).toBe(3);
    });

    it('deleteAll sends deleteAll=true', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({}));
      const result = await store.delete('ns', undefined, { deleteAll: true });

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.deleteAll).toBe(true);
      expect(result.deletedCount).toBe(-1); // Pinecone doesn't return count.
    });

    it('returns 0 when no ids and not deleteAll', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      const result = await store.delete('ns', []);
      expect(result.deletedCount).toBe(0);
      expect(fetchCalls.length).toBe(0);
    });
  });

  // =========================================================================
  // _buildPineconeFilter()
  // =========================================================================

  describe('_buildPineconeFilter (via query)', () => {
    beforeEach(async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
    });

    it('translates implicit scalar equality to $eq', async () => {
      fetchResponseQueue.push(okJson({ matches: [] }));
      await store.query('ns', [1, 2, 3, 4], { filter: { status: 'active' } });

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.filter).toEqual({ status: { $eq: 'active' } });
    });

    it('translates $eq/$gt/$in operators', async () => {
      fetchResponseQueue.push(okJson({ matches: [] }));
      await store.query('ns', [1, 2, 3, 4], {
        filter: {
          type: { $eq: 'article' },
          score: { $gt: 0.5 },
          tags: { $in: ['a', 'b'] },
        },
      });

      const body = parseFetchBody(fetchCalls[0]);
      // Multiple conditions should be wrapped in $and.
      expect(body.filter.$and).toBeDefined();
      expect(body.filter.$and.length).toBe(3);

      const typeFilter = body.filter.$and.find((c: any) => c.type);
      expect(typeFilter.type.$eq).toBe('article');

      const scoreFilter = body.filter.$and.find((c: any) => c.score);
      expect(scoreFilter.score.$gt).toBe(0.5);

      const tagsFilter = body.filter.$and.find((c: any) => c.tags);
      expect(tagsFilter.tags.$in).toEqual(['a', 'b']);
    });

    it('single filter condition returns without $and wrapper', async () => {
      fetchResponseQueue.push(okJson({ matches: [] }));
      await store.query('ns', [1, 2, 3, 4], {
        filter: { topic: { $eq: 'testing' } },
      });

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.filter).toEqual({ topic: { $eq: 'testing' } });
      expect(body.filter.$and).toBeUndefined();
    });
  });

  // =========================================================================
  // healthCheck()
  // =========================================================================

  describe('healthCheck()', () => {
    it('returns true when describe_index_stats returns OK', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({}));
      expect(await store.healthCheck()).toBe(true);
    });

    it('returns false when fetch fails', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      mockFetch.mockRejectedValueOnce(new Error('network error'));
      expect(await store.healthCheck()).toBe(false);
    });
  });

  // =========================================================================
  // Namespace isolation
  // =========================================================================

  describe('namespace isolation', () => {
    it('uses collection name as namespace', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig({ namespace: '' }));
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({ upsertedCount: 1 }));
      await store.upsert('my-agent-ns', [{ id: 'x', embedding: [1, 2, 3, 4] }]);

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.namespace).toBe('my-agent-ns');
    });
  });
});

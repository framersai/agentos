/**
 * @fileoverview Unit tests for PineconeVectorStore with mocked global fetch.
 *
 * All Pinecone API calls are intercepted via vi.stubGlobal('fetch', ...) so
 * no network access is required. Tests verify correct URL construction,
 * request bodies, header handling, batch splitting, and response parsing.
 *
 * @module rag/vector_stores/__tests__/PineconeVectorStore.test
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
    vi.useRealTimers();
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
      expect(headers['X-Pinecone-Api-Version']).toBe('2026-04');
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

    it('retries throttled initialization checks with exponential backoff', async () => {
      vi.useFakeTimers();
      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));
      store = new PineconeVectorStore(makeConfig());

      const initPromise = store.initialize();
      await vi.runAllTimersAsync();
      await initPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].url).toContain('/describe_index_stats');
      expect(fetchCalls[1].url).toContain('/describe_index_stats');
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

    it('includes sparse values when provided via customParams.sparseVectorsById', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({ upsertedCount: 1 }));
      await store.upsert(
        'hybrid-ns',
        [{ id: 'hybrid-1', embedding: [0.1, 0.2, 0.3, 0.4] }],
        {
          customParams: {
            sparseVectorsById: {
              'hybrid-1': {
                indices: [10, 45, 16],
                values: [0.5, 0.25, 0.2],
              },
            },
          },
        },
      );

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.vectors[0].sparse_values).toEqual({
        indices: [10, 45, 16],
        values: [0.5, 0.25, 0.2],
      });
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
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(500, 'server error'));
      fetchResponseQueue.push(errResponse(500, 'server error'));
      fetchResponseQueue.push(errResponse(500, 'server error'));
      fetchResponseQueue.push(errResponse(500, 'server error'));

      const resultPromise = store.upsert('ns', [
        { id: 'f1', embedding: [1, 2, 3, 4] },
        { id: 'f2', embedding: [5, 6, 7, 8] },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.upsertedCount).toBe(0);
      expect(result.failedCount).toBe(2);
    });

    it('retries throttled upsert batches with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({ upsertedCount: 1 }));

      const resultPromise = store.upsert('ns', [
        { id: 'u1', embedding: [0.1, 0.2, 0.3, 0.4] },
      ]);

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].url).toContain('/vectors/upsert');
      expect(fetchCalls[1].url).toContain('/vectors/upsert');
      expect(result.upsertedCount).toBe(1);
      expect(result.upsertedIds).toEqual(['u1']);
      expect(result.failedCount).toBe(0);
    });

    it('does not claim failed batch ids as upserted', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(500, 'server error'));
      fetchResponseQueue.push(errResponse(500, 'server error'));
      fetchResponseQueue.push(errResponse(500, 'server error'));
      fetchResponseQueue.push(errResponse(500, 'server error'));

      const resultPromise = store.upsert('ns', [
        { id: 'f1', embedding: [0.1, 0.2, 0.3, 0.4] },
        { id: 'f2', embedding: [0.5, 0.6, 0.7, 0.8] },
      ]);

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.upsertedCount).toBe(0);
      expect(result.upsertedIds).toEqual([]);
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

    it('retries throttled queries with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({
        matches: [{ id: 'm1', score: 0.91, metadata: { topic: 'ai' } }],
      }));

      const resultPromise = store.query('ns', [0.1, 0.2, 0.3, 0.4], {
        topK: 1,
        includeMetadata: true,
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].url).toContain('/query');
      expect(fetchCalls[1].url).toContain('/query');
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]).toMatchObject({
        id: 'm1',
        similarityScore: 0.91,
        metadata: { topic: 'ai' },
      });
    });
  });

  describe('scanByMetadata()', () => {
    it('uses fetch_by_metadata with namespace, filter, limit, and pagination token', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({
        vectors: {
          first: {
            id: 'first',
            values: [0.11, 0.22, 0.33, 0.44],
            metadata: { topic: 'ai', source: 'memory' },
          },
          second: {
            id: 'second',
            values: [0.55, 0.66, 0.77, 0.88],
            metadata: { topic: 'ai', source: 'session' },
          },
        },
        namespace: 'memory-ns',
        pagination: {
          next: 'page-2-token',
        },
      }));

      const result = await store.scanByMetadata?.('memory-ns', {
        filter: { topic: { $eq: 'ai' } },
        limit: 2,
        cursor: 'page-1-token',
        includeEmbedding: true,
        includeMetadata: true,
      });

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toContain('/vectors/fetch_by_metadata');

      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers['X-Pinecone-Api-Version']).toBe('2026-04');

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.namespace).toBe('memory-ns');
      expect(body.filter).toEqual({ topic: { $eq: 'ai' } });
      expect(body.limit).toBe(2);
      expect(body.paginationToken).toBe('page-1-token');

      expect(result?.nextCursor).toBe('page-2-token');
      expect(result?.documents).toHaveLength(2);
      expect(result?.documents[0]).toMatchObject({
        id: 'first',
        similarityScore: 1,
        embedding: [0.11, 0.22, 0.33, 0.44],
        metadata: { topic: 'ai', source: 'memory' },
      });
      expect(result?.documents[1]).toMatchObject({
        id: 'second',
        similarityScore: 1,
        embedding: [0.55, 0.66, 0.77, 0.88],
        metadata: { topic: 'ai', source: 'session' },
      });
    });

    it('retries throttled metadata scans with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({
        vectors: {
          first: {
            id: 'first',
            values: [0.1, 0.2, 0.3, 0.4],
            metadata: { topic: 'ai' },
          },
        },
      }));

      const resultPromise = store.scanByMetadata?.('memory-ns', {
        filter: { topic: { $eq: 'ai' } },
        limit: 1,
        includeMetadata: true,
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].url).toContain('/vectors/fetch_by_metadata');
      expect(fetchCalls[1].url).toContain('/vectors/fetch_by_metadata');
      expect(result?.documents).toHaveLength(1);
      expect(result?.documents[0].id).toBe('first');
    });
  });

  describe('hybridSearch()', () => {
    it('sends sparseVector payload when sparse query coordinates are supplied', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({
        matches: [{ id: 'hybrid-1', score: 0.91, metadata: { topic: 'hybrid' } }],
      }));

      const result = await store.hybridSearch(
        'hybrid-ns',
        [0.2, 0.4, 0.6, 0.8],
        'hybrid query',
        {
          topK: 4,
          includeMetadata: true,
          alpha: 0.75,
          customParams: {
            sparseVector: {
              indices: [2, 9],
              values: [0.8, 0.4],
            },
          },
        },
      );

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.vector).toEqual([0.15000000000000002, 0.30000000000000004, 0.44999999999999996, 0.6000000000000001]);
      expect(body.sparseVector).toEqual({
        indices: [2, 9],
        values: [0.2, 0.1],
      });
      expect(body.topK).toBe(4);
      expect(result.queryId).toContain('pinecone-hybrid-');
      expect(result.documents[0].id).toBe('hybrid-1');
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

    it('retries throttled ID deletes with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({}));

      const resultPromise = store.delete('ns', ['a', 'b']);

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(parseFetchBody(fetchCalls[0]).ids).toEqual(['a', 'b']);
      expect(parseFetchBody(fetchCalls[1]).ids).toEqual(['a', 'b']);
      expect(result.deletedCount).toBe(2);
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

    it('retries throttled deleteAll requests with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({}));

      const resultPromise = store.delete('ns', undefined, { deleteAll: true });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(parseFetchBody(fetchCalls[0]).deleteAll).toBe(true);
      expect(parseFetchBody(fetchCalls[1]).deleteAll).toBe(true);
      expect(result.deletedCount).toBe(-1);
    });

    it('deletes by metadata filter through /vectors/delete', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      fetchResponseQueue.push(okJson({}));
      const result = await store.delete('ns', undefined, {
        filter: { originalDocumentId: 'doc-1' },
      });

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toContain('/vectors/delete');

      const body = parseFetchBody(fetchCalls[0]);
      expect(body.namespace).toBe('ns');
      expect(body.filter).toEqual({ originalDocumentId: { $eq: 'doc-1' } });
      expect(body.ids).toBeUndefined();
      expect(body.deleteAll).toBeUndefined();
      expect(result.deletedCount).toBe(-1);
    });

    it('retries throttled metadata deletes with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({}));

      const resultPromise = store.delete('ns', undefined, {
        filter: { originalDocumentId: 'doc-1' },
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(fetchCalls).toHaveLength(2);
      expect(parseFetchBody(fetchCalls[0]).filter).toEqual({ originalDocumentId: { $eq: 'doc-1' } });
      expect(parseFetchBody(fetchCalls[1]).filter).toEqual({ originalDocumentId: { $eq: 'doc-1' } });
      expect(result.deletedCount).toBe(-1);
    });

    it('throws when ids and filter are both provided', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();

      await expect(
        store.delete('ns', ['doc-1'], { filter: { originalDocumentId: 'doc-1' } }),
      ).rejects.toThrow('Pinecone delete options are mutually exclusive');

      expect(fetchCalls).toHaveLength(0);
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
      vi.useFakeTimers();

      mockFetch
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'));

      const healthPromise = store.healthCheck();
      await vi.runAllTimersAsync();

      expect(await healthPromise).toBe(false);
    });

    it('retries throttled health checks with exponential backoff', async () => {
      fetchResponseQueue.push(okJson({})); // init
      store = new PineconeVectorStore(makeConfig());
      await store.initialize();
      resetMocks();
      vi.useFakeTimers();

      fetchResponseQueue.push(errResponse(429, 'rate limited'));
      fetchResponseQueue.push(okJson({ namespaces: {}, totalVectorCount: 0 }));

      const healthPromise = store.healthCheck();
      await vi.runAllTimersAsync();

      expect(await healthPromise).toBe(true);
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].url).toContain('/describe_index_stats');
      expect(fetchCalls[1].url).toContain('/describe_index_stats');
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

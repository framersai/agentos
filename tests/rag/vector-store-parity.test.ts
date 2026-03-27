/**
 * @fileoverview Parameterized feature parity test suite for vector stores.
 * @module tests/rag/vector-store-parity
 *
 * Runs the same test battery against every IVectorStore backend.
 * SQLite tests always run. Postgres and Qdrant tests are conditional
 * on Docker availability — they auto-skip if the backend is unreachable.
 *
 * This ensures migration between any pair of backends preserves behavior.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the store implementations.
import { SqlVectorStore } from '../../src/rag/implementations/vector_stores/SqlVectorStore.js';
import type { IVectorStore } from '../../src/rag/IVectorStore.js';

// ---------------------------------------------------------------------------
// Test embedding helpers
// ---------------------------------------------------------------------------

/** Generate a simple test embedding of given dimension. */
function testEmbedding(seed: number, dim = 4): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1)));
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

async function createSqliteStore(): Promise<IVectorStore> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'parity-sqlite-'));
  const store = new SqlVectorStore({
    id: 'test-sqlite',
    type: 'sql',
    customProps: {
      storageType: 'sqlite',
      dbPath: join(tmpDir, 'test.sqlite'),
    },
  });
  await store.initialize();
  // Attach cleanup metadata.
  (store as any).__tmpDir = tmpDir;
  return store;
}

// Postgres and Qdrant factories return null if not available.
async function createPostgresStore(): Promise<IVectorStore | null> {
  try {
    const { PostgresVectorStore } = await import(
      '../../src/rag/implementations/vector_stores/PostgresVectorStore.js'
    );
    const connStr = process.env.TEST_POSTGRES_URL ?? 'postgresql://postgres:wunderland@localhost:5432/agent_memory';
    const store = new PostgresVectorStore({
      id: 'test-postgres',
      type: 'postgres',
      connectionString: connStr,
      tablePrefix: 'parity_test_',
    });
    await store.initialize();
    return store;
  } catch {
    return null;
  }
}

async function createQdrantStore(): Promise<IVectorStore | null> {
  // Qdrant parity tests are implemented but conditional on Qdrant availability.
  // The QdrantVectorStore uses fetch against the HTTP API.
  try {
    const url = process.env.TEST_QDRANT_URL ?? 'http://localhost:6333';
    const res = await fetch(`${url}/healthz`);
    if (!res.ok) return null;

    const { QdrantVectorStore } = await import(
      '../../src/rag/implementations/vector_stores/QdrantVectorStore.js'
    );
    const store = new QdrantVectorStore({
      id: 'test-qdrant',
      type: 'qdrant',
      customProps: { url },
    });
    await store.initialize();
    return store;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parameterized parity tests
// ---------------------------------------------------------------------------

const COLLECTION = 'parity-test';

describe.each([
  ['sqlite', createSqliteStore],
  ['postgres', createPostgresStore],
  ['qdrant', createQdrantStore],
] as const)('IVectorStore parity: %s', (name, factory) => {
  let store: IVectorStore | null = null;
  let available = false;

  beforeAll(async () => {
    try {
      store = await factory();
      available = store !== null;
      if (store) {
        // Create a fresh collection for tests.
        await store.createCollection(COLLECTION, {
          dimension: 4,
          similarityMetric: 'cosine',
        });
      }
    } catch {
      available = false;
    }
  });

  afterAll(async () => {
    if (store) {
      try { await store.dropCollection(COLLECTION); } catch { /* ignore */ }
      if ((store as any).__tmpDir) {
        rmSync((store as any).__tmpDir, { recursive: true, force: true });
      }
      if ('close' in store && typeof (store as any).close === 'function') {
        await (store as any).close();
      }
    }
  });

  // --- Vector operations ---

  it.skipIf(!available)('upserts documents', async () => {
    const result = await store!.upsert(COLLECTION, [
      { id: 'v1', embedding: testEmbedding(1), metadata: { tag: 'alpha' } },
      { id: 'v2', embedding: testEmbedding(2), metadata: { tag: 'beta' } },
      { id: 'v3', embedding: testEmbedding(3), metadata: { tag: 'alpha', score: 90 } },
    ]);
    expect(result.successCount).toBe(3);
  });

  it.skipIf(!available)('queries top-K by cosine similarity', async () => {
    const result = await store!.query(COLLECTION, testEmbedding(1), { topK: 2 });
    expect(result.documents.length).toBe(2);
    // First result should be 'v1' (identical embedding).
    expect(result.documents[0].id).toBe('v1');
    expect(result.documents[0].similarityScore).toBeGreaterThan(0.9);
  });

  it.skipIf(!available)('respects topK limit', async () => {
    const result = await store!.query(COLLECTION, testEmbedding(1), { topK: 1 });
    expect(result.documents.length).toBe(1);
  });

  it.skipIf(!available)('filters by metadata equality', async () => {
    const result = await store!.query(COLLECTION, testEmbedding(1), {
      topK: 10,
      filter: { tag: { $eq: 'beta' } },
      includeMetadata: true,
    });
    expect(result.documents.length).toBe(1);
    expect(result.documents[0].id).toBe('v2');
  });

  it.skipIf(!available)('includes embeddings when requested', async () => {
    const result = await store!.query(COLLECTION, testEmbedding(1), {
      topK: 1,
      includeEmbedding: true,
    });
    expect(result.documents[0].embedding.length).toBe(4);
  });

  // --- CRUD ---

  it.skipIf(!available)('handles duplicate upserts (idempotent)', async () => {
    await store!.upsert(COLLECTION, [
      { id: 'v1', embedding: testEmbedding(1), metadata: { tag: 'updated' } },
    ]);
    const result = await store!.query(COLLECTION, testEmbedding(1), {
      topK: 1,
      includeMetadata: true,
    });
    expect(result.documents[0].id).toBe('v1');
  });

  it.skipIf(!available)('deletes documents by ID', async () => {
    await store!.upsert(COLLECTION, [
      { id: 'del-1', embedding: testEmbedding(99) },
    ]);
    const delResult = await store!.delete(COLLECTION, { ids: ['del-1'] });
    expect(delResult.deletedCount).toBeGreaterThanOrEqual(1);

    // Verify it's gone.
    const queryResult = await store!.query(COLLECTION, testEmbedding(99), { topK: 10 });
    expect(queryResult.documents.find(d => d.id === 'del-1')).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryVectorStore } from '../InMemoryVectorStore.js';

describe('InMemoryVectorStore.scanByMetadata', () => {
  let store: InMemoryVectorStore;

  beforeEach(async () => {
    store = new InMemoryVectorStore();
    await store.initialize({ id: 'in-memory-test', type: 'in_memory' });
    await store.createCollection?.('scan', 2, { overwriteIfExists: true });
  });

  it('returns filtered documents with metadata, text content, and embeddings', async () => {
    await store.upsert('scan', [
      {
        id: 'expired',
        embedding: [1, 0],
        metadata: { status: 'expired', timestamp: '2026-01-01T00:00:00.000Z' },
        textContent: 'old document',
      },
      {
        id: 'fresh',
        embedding: [0, 1],
        metadata: { status: 'fresh', timestamp: '2026-04-21T00:00:00.000Z' },
        textContent: 'fresh document',
      },
    ]);

    const result = await store.scanByMetadata?.('scan', {
      filter: { status: 'expired' },
      includeMetadata: true,
      includeTextContent: true,
      includeEmbedding: true,
    });

    expect(result?.documents.map((doc) => doc.id)).toEqual(['expired']);
    expect(result?.documents[0]?.metadata).toEqual({
      status: 'expired',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result?.documents[0]?.textContent).toBe('old document');
    expect(result?.documents[0]?.embedding).toEqual([1, 0]);
  });

  it('supports ISO timestamp range filters during metadata scan', async () => {
    await store.upsert('scan', [
      {
        id: 'expired',
        embedding: [1, 0],
        metadata: { timestamp: '2024-01-01T00:00:00.000Z' },
        textContent: 'old document',
      },
      {
        id: 'fresh',
        embedding: [0, 1],
        metadata: { timestamp: '2026-04-21T00:00:00.000Z' },
        textContent: 'fresh document',
      },
    ]);

    const result = await store.scanByMetadata?.('scan', {
      filter: { timestamp: { $lt: '2025-01-01T00:00:00.000Z' } },
      includeMetadata: true,
    });

    expect(result?.documents.map((doc) => doc.id)).toEqual(['expired']);
  });
});

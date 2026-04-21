import { describe, expect, it, vi } from 'vitest';

import { Neo4jVectorStore } from '../Neo4jVectorStore';

describe('Neo4jVectorStore.scanByMetadata', () => {
  it('returns filtered documents with metadata, text content, and embeddings', async () => {
    const store = new Neo4jVectorStore();
    const read = vi.fn().mockResolvedValue([
      {
        docId: 'doc-expired',
        embedding: [0.1, 0.2, 0.3],
        textContent: 'Expired memory',
        metadata_json: JSON.stringify({
          category: 'episodic',
          timestamp: '2024-01-01T00:00:00.000Z',
          gmiOwnerId: 'gmi-1',
        }),
      },
      {
        docId: 'doc-fresh',
        embedding: [0.4, 0.5, 0.6],
        textContent: 'Fresh memory',
        metadata_json: JSON.stringify({
          category: 'episodic',
          timestamp: '2026-04-20T00:00:00.000Z',
          gmiOwnerId: 'gmi-1',
        }),
      },
    ]);

    Object.assign(store as any, {
      cypher: {
        read,
        write: vi.fn(),
        writeVoid: vi.fn(),
      },
      connectionManager: {
        checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
        shutdown: vi.fn(),
      },
      indexPrefix: 'agentos_vec',
      ownsConnectionManager: false,
    });

    expect(store.scanByMetadata).toBeTypeOf('function');

    const result = await store.scanByMetadata?.('memory', {
      filter: {
        category: 'episodic',
        timestamp: { $lt: '2025-01-01T00:00:00.000Z' },
      },
      includeEmbedding: true,
      includeMetadata: true,
      includeTextContent: true,
      limit: 10,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(result?.documents).toHaveLength(1);
    expect(result?.documents[0]).toMatchObject({
      id: 'doc-expired',
      embedding: [0.1, 0.2, 0.3],
      textContent: 'Expired memory',
      metadata: {
        category: 'episodic',
        timestamp: '2024-01-01T00:00:00.000Z',
        gmiOwnerId: 'gmi-1',
      },
      similarityScore: 1,
    });
  });
});

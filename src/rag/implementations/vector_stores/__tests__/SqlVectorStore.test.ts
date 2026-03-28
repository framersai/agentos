import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SidecarItem = { id: string; embedding: number[] };

class MockHnswIndexSidecar {
  public ids: string[] = [];
  public available = true;

  initialize = vi.fn(async () => {});
  isAvailable = vi.fn(() => this.available);
  isActive = vi.fn(() => this.ids.length > 0);
  rebuildFromData = vi.fn(async (items: SidecarItem[]) => {
    this.ids = items.map(item => item.id);
  });
  upsertBatch = vi.fn(async (items: SidecarItem[]) => {
    for (const item of items) {
      if (!this.ids.includes(item.id)) {
        this.ids.push(item.id);
      }
    }
  });
  removeBatch = vi.fn(async (ids: string[]) => {
    this.ids = this.ids.filter(id => !ids.includes(id));
  });
  search = vi.fn(async () => this.ids.map(id => ({ id, score: 0.9 })));
  shutdown = vi.fn(async () => {});
}

import { SqlVectorStore, type SqlVectorStoreConfig } from '../SqlVectorStore';

describe('SqlVectorStore HNSW integration', () => {
  let store: SqlVectorStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new SqlVectorStore();
  });

  afterEach(async () => {
    await store.shutdown();
  });

  it('keeps separate HNSW sidecars per collection', async () => {
    const alphaSidecar = new MockHnswIndexSidecar();
    const betaSidecar = new MockHnswIndexSidecar();
    const hnswSidecarFactory = vi.fn()
      .mockImplementationOnce(() => alphaSidecar)
      .mockImplementationOnce(() => betaSidecar);

    const config: SqlVectorStoreConfig = {
      id: 'sql-vector-store-test',
      type: 'sql',
      hnswThreshold: 1,
      hnswSidecarFactory: hnswSidecarFactory as unknown as SqlVectorStoreConfig['hnswSidecarFactory'],
    };

    await store.initialize(config);

    await store.createCollection('alpha', 2, { overwriteIfExists: true });
    await store.createCollection('beta', 2, { overwriteIfExists: true });

    await store.upsert('alpha', [
      { id: 'alpha-1', embedding: [1, 0], textContent: 'alpha document' },
    ]);
    await store.upsert('beta', [
      { id: 'beta-1', embedding: [0, 1], textContent: 'beta document' },
    ]);

    const alphaResult = await store.query('alpha', [1, 0], {
      topK: 1,
      includeTextContent: true,
    });
    const betaResult = await store.query('beta', [0, 1], {
      topK: 1,
      includeTextContent: true,
    });

    expect(hnswSidecarFactory).toHaveBeenCalledTimes(2);
    expect(alphaSidecar.initialize).toHaveBeenCalledWith(expect.objectContaining({
      indexPath: expect.stringMatching(/alpha\.hnsw$/),
      dimensions: 2,
      metric: 'cosine',
    }));
    expect(betaSidecar.initialize).toHaveBeenCalledWith(expect.objectContaining({
      indexPath: expect.stringMatching(/beta\.hnsw$/),
      dimensions: 2,
      metric: 'cosine',
    }));
    expect(alphaResult.documents[0]?.id).toBe('alpha-1');
    expect(alphaResult.documents[0]?.textContent).toBe('alpha document');
    expect(betaResult.documents[0]?.id).toBe('beta-1');
    expect(betaResult.documents[0]?.textContent).toBe('beta document');
  });

  it('refreshes the active sidecar on document updates and deletes', async () => {
    const gammaSidecar = new MockHnswIndexSidecar();
    const hnswSidecarFactory = vi.fn(() => gammaSidecar);

    const config: SqlVectorStoreConfig = {
      id: 'sql-vector-store-test',
      type: 'sql',
      hnswThreshold: 1,
      hnswSidecarFactory: hnswSidecarFactory as unknown as SqlVectorStoreConfig['hnswSidecarFactory'],
    };

    await store.initialize(config);

    await store.createCollection('gamma', 2, { overwriteIfExists: true });
    await store.upsert('gamma', [
      { id: 'gamma-1', embedding: [1, 0], textContent: 'original document' },
    ]);

    expect(hnswSidecarFactory).toHaveBeenCalledTimes(1);
    expect(gammaSidecar.rebuildFromData).toHaveBeenCalledTimes(1);

    await store.upsert('gamma', [
      { id: 'gamma-1', embedding: [0, 1], textContent: 'updated document' },
    ]);

    expect(gammaSidecar.upsertBatch).toHaveBeenCalledWith([
      { id: 'gamma-1', embedding: [0, 1] },
    ]);

    await store.delete('gamma', ['gamma-1']);

    expect(gammaSidecar.removeBatch).toHaveBeenCalledWith(['gamma-1']);
  });
});

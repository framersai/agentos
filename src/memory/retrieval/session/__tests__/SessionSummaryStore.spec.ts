import { describe, it, expect, beforeEach } from 'vitest';
import { SessionSummaryStore } from '../SessionSummaryStore.js';
import { InMemoryVectorStore } from '../../../../rag/vector_stores/InMemoryVectorStore.js';
import type { IEmbeddingManager } from '../../../../core/embeddings/IEmbeddingManager.js';

// Test stub: cast at usage site below via `as unknown as IEmbeddingManager`.
class FakeEmbedder {
  async generateEmbeddings(input: { texts: string | string[] }) {
    const texts = Array.isArray(input.texts) ? input.texts : [input.texts];
    const embeddings = texts.map((t) => {
      const sum = [...t].reduce((a, c) => a + c.charCodeAt(0), 0);
      return [sum, sum * 2, sum * 3, sum * 4, sum * 5, sum * 6, sum * 7, sum * 8]
        .map((x) => x / 10000);
    });
    return { embeddings, model: 'fake', usage: { promptTokens: 0, totalTokens: 0 } };
  }
  async generateEmbedding(text: string) {
    const { embeddings } = await this.generateEmbeddings({ texts: text });
    return { embedding: embeddings[0], model: 'fake', usage: { promptTokens: 0, totalTokens: 0 } };
  }
  getEmbeddingDimension() { return 8; }
  getModel() { return 'fake'; }
}

async function mkStore(): Promise<SessionSummaryStore> {
  const vectorStore = new InMemoryVectorStore();
  await vectorStore.initialize({
    id: 'test-store',
    type: 'in_memory',
    defaultEmbeddingDimension: 8,
    similarityMetric: 'cosine',
  } as import('../../../../core/vector-store/IVectorStore.js').VectorStoreProviderConfig);
  return new SessionSummaryStore({ vectorStore, embeddingManager: new FakeEmbedder() as unknown as IEmbeddingManager });
}

describe('SessionSummaryStore', () => {
  let store: SessionSummaryStore;
  beforeEach(async () => { store = await mkStore(); });

  it('round-trips: indexSession then querySessions returns the indexed session', async () => {
    await store.indexSession({
      scope: 'user', scopeId: 'u1', sessionId: 's-1',
      summary: 'User asked about rescue dog adoption from a Portland shelter.',
    });
    const results = await store.querySessions('rescue dog adoption', { scope: 'user', scopeId: 'u1', topK: 5 });
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe('s-1');
    expect(results[0].similarityScore).toBeGreaterThan(0);
  });

  it('querySessions orders results by descending similarity', async () => {
    await store.indexSession({ scope: 'user', scopeId: 'u1', sessionId: 's-a', summary: 'AAA AAA AAA' });
    await store.indexSession({ scope: 'user', scopeId: 'u1', sessionId: 's-b', summary: 'BBB BBB BBB' });
    await store.indexSession({ scope: 'user', scopeId: 'u1', sessionId: 's-c', summary: 'CCC CCC CCC' });
    const results = await store.querySessions('AAA AAA', { scope: 'user', scopeId: 'u1', topK: 3 });
    expect(results.length).toBe(3);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarityScore).toBeGreaterThanOrEqual(results[i + 1].similarityScore);
    }
  });

  it('isolates by scope and scopeId — different scopes do not cross-contaminate', async () => {
    await store.indexSession({ scope: 'user', scopeId: 'u1', sessionId: 's-x', summary: 'alpha' });
    await store.indexSession({ scope: 'user', scopeId: 'u2', sessionId: 's-x', summary: 'beta' });
    const u1Results = await store.querySessions('alpha', { scope: 'user', scopeId: 'u1', topK: 5 });
    const u2Results = await store.querySessions('alpha', { scope: 'user', scopeId: 'u2', topK: 5 });
    expect(u1Results.length).toBe(1);
    expect(u2Results.length).toBe(1);
    expect(u1Results[0].sessionId).toBe('s-x');
    expect(u2Results[0].sessionId).toBe('s-x');
  });

  it('returns empty array when collection does not exist', async () => {
    const results = await store.querySessions('anything', { scope: 'user', scopeId: 'cold-scope', topK: 5 });
    expect(results).toEqual([]);
  });

  it('is idempotent: re-indexing the same sessionId replaces (does not duplicate)', async () => {
    await store.indexSession({ scope: 'user', scopeId: 'u1', sessionId: 's-dup', summary: 'version one' });
    await store.indexSession({ scope: 'user', scopeId: 'u1', sessionId: 's-dup', summary: 'version two' });
    const results = await store.querySessions('version', { scope: 'user', scopeId: 'u1', topK: 10 });
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe('s-dup');
  });
});

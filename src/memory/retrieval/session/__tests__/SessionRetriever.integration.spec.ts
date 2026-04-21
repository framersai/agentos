import { describe, it, expect } from 'vitest';
import { SessionSummaryStore } from '../SessionSummaryStore.js';
import { SessionRetriever } from '../SessionRetriever.js';
import { MemoryStore } from '../../store/MemoryStore.js';
import { InMemoryVectorStore } from '../../../../rag/vector_stores/InMemoryVectorStore.js';
import type { IKnowledgeGraph } from '../../graph/knowledge/IKnowledgeGraph.js';
import type { IEmbeddingManager } from '../../../../core/embeddings/IEmbeddingManager.js';
import type { MemoryTrace, MemoryScope } from '../../../core/types.js';
import type { PADState } from '../../../core/config.js';

// Test stubs: use structural typing + `as unknown as IEmbeddingManager`
// at construction sites. Interfaces have methods (initialize,
// getEmbeddingModelInfo, checkHealth) we don't need for these tests.
class HashEmbedder {
  async generateEmbeddings(input: { texts: string | string[] }) {
    const texts = Array.isArray(input.texts) ? input.texts : [input.texts];
    const embeddings = texts.map((t) => {
      const seed = [...t].reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0);
      const vec = new Array(16).fill(0).map((_, i) => Math.sin(seed * (i + 1)) * 0.5 + 0.5);
      const mag = Math.hypot(...vec);
      return vec.map((x) => x / (mag || 1));
    });
    return { embeddings, model: 'hash', usage: { promptTokens: 0, totalTokens: 0 } };
  }
  async generateEmbedding(text: string) {
    const { embeddings } = await this.generateEmbeddings({ texts: text });
    return { embedding: embeddings[0], model: 'hash', usage: { promptTokens: 0, totalTokens: 0 } };
  }
  getEmbeddingDimension() { return 16; }
  getModel() { return 'hash'; }
}

class NoopKG {
  async recordMemory() { return 'noop'; }
  async findRelatedMemories() { return []; }
  async findEntityRelationships() { return []; }
  async linkMemories() { /* no-op */ }
  async getEntityContext() { return { entities: [], memories: [], relationships: [] }; }
  async getMemoryById() { return null; }
  async updateMemory() { /* no-op */ }
  async removeMemory() { /* no-op */ }
}

async function mkVectorStore(): Promise<InMemoryVectorStore> {
  const vs = new InMemoryVectorStore();
  await vs.initialize({
    id: 'integration-test', type: 'in_memory',
    defaultEmbeddingDimension: 16, similarityMetric: 'cosine',
  } as import('../../../../core/vector-store/IVectorStore.js').VectorStoreProviderConfig);
  return vs;
}

function mkTrace(id: string, sessionId: string, content: string): MemoryTrace {
  return {
    id, type: 'episodic', scope: 'user', scopeId: 'u1',
    content, entities: [], tags: [`bench-session:${sessionId}`],
    provenance: { sourceType: 'user_statement', sourceTimestamp: Date.now(), confidence: 1, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.5, stability: 0.5, retrievalCount: 0,
    lastAccessedAt: Date.now(), accessCount: 0, reinforcementInterval: 0,
    associatedTraceIds: [], createdAt: Date.now(), updatedAt: Date.now(), isActive: true,
  };
}

const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };
const scope = { scope: 'user' as MemoryScope, scopeId: 'u1' };

describe('SessionRetriever (integration)', () => {
  it('end-to-end: index 3 session summaries, encode chunks, retrieve returns at least one chunk', async () => {
    const embedder = new HashEmbedder() as unknown as IEmbeddingManager;
    const traceVectorStore = await mkVectorStore();
    const summaryVectorStore = await mkVectorStore();
    const summaryStore = new SessionSummaryStore({
      vectorStore: summaryVectorStore, embeddingManager: embedder,
    });
    const memoryStore = new MemoryStore({
      vectorStore: traceVectorStore,
      embeddingManager: embedder,
      knowledgeGraph: new NoopKG() as unknown as IKnowledgeGraph,
      collectionPrefix: 'cogmem',
    });

    await summaryStore.indexSession({
      scope: 'user', scopeId: 'u1', sessionId: 's-dog',
      summary: 'User adopted a rescue dog from Portland shelter, named Biscuit.',
    });
    await summaryStore.indexSession({
      scope: 'user', scopeId: 'u1', sessionId: 's-car',
      summary: 'User bought a used Subaru Outback, blue, 2018 model.',
    });
    await summaryStore.indexSession({
      scope: 'user', scopeId: 'u1', sessionId: 's-food',
      summary: 'User tried a new sushi place in Midtown for dinner.',
    });

    for (const [sid, contents] of [
      ['s-dog', ['Biscuit is a 2-year-old mutt.', 'We visited Portland Humane Society.']],
      ['s-car', ['The Outback has 40k miles.', 'I paid $18k for it.']],
      ['s-food', ['The tuna sashimi was fresh.', 'I tipped 25%.']],
    ] as const) {
      for (const [i, content] of contents.entries()) {
        await memoryStore.store(mkTrace(`${sid}-${i}`, sid, content));
      }
    }

    const retriever = new SessionRetriever({
      summaryStore, memoryStore, embeddingManager: embedder,
      defaultTopSessions: 2, defaultChunksPerSession: 2,
    });
    const result = await retriever.retrieve(
      'rescue dog Portland shelter',
      neutralMood, scope, { recallTopK: 10 },
    );
    // Wiring check: retrieval completes, returns some chunks, shape is correct.
    expect(result.retrieved.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics).toBeDefined();
    expect(typeof result.diagnostics.totalTimeMs).toBe('number');
  });

  it('cache smoke: two retrieve calls with the same query return stable results', async () => {
    const embedder = new HashEmbedder() as unknown as IEmbeddingManager;
    const summaryStore = new SessionSummaryStore({
      vectorStore: await mkVectorStore(), embeddingManager: embedder,
    });
    const memoryStore = new MemoryStore({
      vectorStore: await mkVectorStore(), embeddingManager: embedder,
      knowledgeGraph: new NoopKG() as unknown as IKnowledgeGraph,
      collectionPrefix: 'cogmem',
    });
    await summaryStore.indexSession({
      scope: 'user', scopeId: 'u1', sessionId: 's-1', summary: 'alpha beta gamma',
    });
    await memoryStore.store(mkTrace('t1', 's-1', 'alpha chunk'));

    const retriever = new SessionRetriever({ summaryStore, memoryStore, embeddingManager: embedder });
    const r1 = await retriever.retrieve('alpha', neutralMood, scope);
    const r2 = await retriever.retrieve('alpha', neutralMood, scope);
    expect(r1.retrieved.length).toBe(r2.retrieved.length);
    if (r1.retrieved.length > 0) {
      expect(r1.retrieved[0].id).toBe(r2.retrieved[0].id);
    }
  });
});

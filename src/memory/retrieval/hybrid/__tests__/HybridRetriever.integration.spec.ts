import { describe, it, expect } from 'vitest';
import { HybridRetriever } from '../HybridRetriever.js';
import { MemoryStore } from '../../store/MemoryStore.js';
import { InMemoryVectorStore } from '../../../../rag/vector_stores/InMemoryVectorStore.js';
import type { IKnowledgeGraph } from '../../graph/knowledge/IKnowledgeGraph.js';
import type { IEmbeddingManager } from '../../../../core/embeddings/IEmbeddingManager.js';
import type { MemoryTrace, MemoryScope } from '../../../core/types.js';
import type { PADState } from '../../../core/config.js';

// Test stubs: use structural typing + `as unknown as IEmbeddingManager` at
// construction sites below. Interfaces have methods (initialize,
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

function mkTrace(id: string, content: string): MemoryTrace {
  return {
    id, type: 'episodic', scope: 'user', scopeId: 'u1',
    content, entities: [], tags: [],
    provenance: { sourceType: 'user_statement', sourceTimestamp: Date.now(), confidence: 1, verificationCount: 0 },
    emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: '' },
    encodingStrength: 0.5, stability: 0.5, retrievalCount: 0,
    lastAccessedAt: Date.now(), accessCount: 0, reinforcementInterval: 0,
    associatedTraceIds: [], createdAt: Date.now(), updatedAt: Date.now(), isActive: true,
  };
}

const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };
const scope = { scope: 'user' as MemoryScope, scopeId: 'u1' };

describe('HybridRetriever (integration)', () => {
  it('end-to-end: BM25 surfaces exact-term match that dense may miss', async () => {
    const embedder = new HashEmbedder();
    const traceVectorStore = await mkVectorStore();
    const memoryStore = new MemoryStore({
      vectorStore: traceVectorStore,
      embeddingManager: embedder as unknown as IEmbeddingManager,
      knowledgeGraph: new NoopKG() as unknown as IKnowledgeGraph,
      collectionPrefix: 'cogmem',
    });
    const hybrid = new HybridRetriever({ memoryStore });

    const contents: Array<[string, string]> = [
      ['t1', 'The user bought turbinado sugar at Whole Foods.'],
      ['t2', 'Discussed a Subaru Outback with 40k miles.'],
      ['t3', 'Tried new sushi in Midtown.'],
      ['t4', "Adopted a rescue dog named Biscuit."],
      ['t5', "Attended a cousin's wedding in Portland."],
    ];
    for (const [id, content] of contents) {
      await memoryStore.store(mkTrace(id, content));
      hybrid.bm25.addDocument(id, content);
    }

    const result = await hybrid.retrieve('turbinado sugar', neutralMood, scope, { recallTopK: 10 });
    expect(result.retrieved.length).toBeGreaterThanOrEqual(1);
    expect(result.retrieved.some((t) => t.id === 't1')).toBe(true);
  });

  it('cache smoke: same query twice is stable', async () => {
    const embedder = new HashEmbedder();
    const memoryStore = new MemoryStore({
      vectorStore: await mkVectorStore(),
      embeddingManager: embedder as unknown as IEmbeddingManager,
      knowledgeGraph: new NoopKG() as unknown as IKnowledgeGraph,
      collectionPrefix: 'cogmem',
    });
    const hybrid = new HybridRetriever({ memoryStore });
    await memoryStore.store(mkTrace('t1', 'alpha beta gamma'));
    hybrid.bm25.addDocument('t1', 'alpha beta gamma');
    const r1 = await hybrid.retrieve('alpha', neutralMood, scope);
    const r2 = await hybrid.retrieve('alpha', neutralMood, scope);
    expect(r1.retrieved.length).toBe(r2.retrieved.length);
    if (r1.retrieved.length > 0) {
      expect(r1.retrieved[0].id).toBe(r2.retrieved[0].id);
    }
  });
});

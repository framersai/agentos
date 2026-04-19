/**
 * @fileoverview Pins the public CognitiveMemoryManager.getTraceCount()
 * wrapper over the underlying MemoryStore.getTraceCount() — the
 * ergonomic passthrough used by agentos-bench for memory-footprint
 * telemetry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CognitiveMemoryManager } from '../../src/memory/CognitiveMemoryManager';
import type { CognitiveMemoryConfig, PADState } from '../../src/memory/core/config';
import type { IVectorStore, VectorDocument, QueryResult } from '../../src/rag/IVectorStore';
import type { IEmbeddingManager } from '../../src/rag/IEmbeddingManager';
import type { IKnowledgeGraph } from '../../src/memory/retrieval/graph/knowledge/IKnowledgeGraph';
import type { IWorkingMemory } from '../../src/cognitive_substrate/memory/IWorkingMemory';

function createMockVectorStore(): IVectorStore {
  const collections = new Map<string, VectorDocument[]>();
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createCollection: vi.fn().mockResolvedValue(undefined),
    deleteCollection: vi.fn().mockResolvedValue(undefined),
    collectionExists: vi.fn(async (n: string) => collections.has(n)),
    upsert: vi.fn(async (c: string, docs: VectorDocument[]) => {
      const existing = collections.get(c) ?? [];
      for (const d of docs) {
        const i = existing.findIndex((e) => e.id === d.id);
        if (i >= 0) existing[i] = d;
        else existing.push(d);
      }
      collections.set(c, existing);
      return { succeeded: docs.length, failed: 0 };
    }),
    query: vi.fn(async (c: string): Promise<QueryResult> => ({
      documents: (collections.get(c) ?? []).map((d) => ({ ...d, similarityScore: 0.85 })),
    })),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ documentCount: 0, vectorCount: 0 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as IVectorStore;
}

function createMockEmbeddingManager(): IEmbeddingManager {
  return {
    generateEmbeddings: vi.fn(async () => ({ embeddings: [[0.1, 0.2, 0.3, 0.4]], model: 'mock', tokensUsed: 10 })),
    getDimension: vi.fn().mockReturnValue(4),
  } as unknown as IEmbeddingManager;
}

function createMockKnowledgeGraph(): IKnowledgeGraph {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    recordMemory: vi.fn().mockResolvedValue({
      id: 'mem-1',
      createdAt: new Date().toISOString(),
      accessCount: 0,
      lastAccessedAt: new Date().toISOString(),
    }),
    upsertEntity: vi.fn().mockResolvedValue({ id: 'e-1' }),
    getEntity: vi.fn().mockResolvedValue(undefined),
    queryEntities: vi.fn().mockResolvedValue([]),
    deleteEntity: vi.fn().mockResolvedValue(true),
    upsertRelation: vi.fn().mockResolvedValue({ id: 'r-1' }),
    getRelations: vi.fn().mockResolvedValue([]),
    deleteRelation: vi.fn().mockResolvedValue(true),
    getMemory: vi.fn().mockResolvedValue(undefined),
    queryMemories: vi.fn().mockResolvedValue([]),
    recallMemories: vi.fn().mockResolvedValue([]),
    traverse: vi.fn().mockResolvedValue({ root: {}, levels: [], totalEntities: 0, totalRelations: 0 }),
    findPath: vi.fn().mockResolvedValue(null),
    getNeighborhood: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
    semanticSearch: vi.fn().mockResolvedValue([]),
    extractFromText: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
    mergeEntities: vi.fn().mockResolvedValue({}),
    decayMemories: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({ totalEntities: 0, totalRelations: 0, totalMemories: 0 }),
    clear: vi.fn().mockResolvedValue(undefined),
  } as unknown as IKnowledgeGraph;
}

function createMockWorkingMemory(): IWorkingMemory {
  const store = new Map<string, unknown>();
  return {
    id: 'mock-wm',
    initialize: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    get: vi.fn(async (k: string) => store.get(k)),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    getAll: vi.fn(async () => Object.fromEntries(store)),
    clear: vi.fn(async () => { store.clear(); }),
    size: vi.fn(async () => store.size),
    has: vi.fn(async (k: string) => store.has(k)),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as IWorkingMemory;
}

describe('CognitiveMemoryManager.getTraceCount', () => {
  let manager: CognitiveMemoryManager;
  const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };

  beforeEach(async () => {
    manager = new CognitiveMemoryManager();
    await manager.initialize({
      vectorStore: createMockVectorStore(),
      embeddingManager: createMockEmbeddingManager(),
      knowledgeGraph: createMockKnowledgeGraph(),
      workingMemory: createMockWorkingMemory(),
      agentId: 'test-agent',
      traits: { openness: 0.7, conscientiousness: 0.6, emotionality: 0.5 },
      moodProvider: () => neutralMood,
      featureDetectionStrategy: 'keyword',
      collectionPrefix: 'test',
    } as CognitiveMemoryConfig);
  });

  it('returns 0 before any encode', () => {
    expect(manager.getTraceCount()).toBe(0);
  });

  it('increments after each encode', async () => {
    await manager.encode('hello world', neutralMood, 'neutral');
    expect(manager.getTraceCount()).toBe(1);
    await manager.encode('another trace', neutralMood, 'neutral');
    expect(manager.getTraceCount()).toBe(2);
  });

  it('matches getStore().getTraceCount() exactly', async () => {
    await manager.encode('trace A', neutralMood, 'neutral');
    await manager.encode('trace B', neutralMood, 'neutral');
    expect(manager.getTraceCount()).toBe(manager.getStore().getTraceCount());
  });
});

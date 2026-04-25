/**
 * @fileoverview Pins the consolidation-disabled invariant:
 * when `config.consolidation.enabled === false`, no setInterval
 * timer is created by ConsolidationPipeline.start(). This prevents
 * bench / test processes from hanging on exit because the
 * consolidation timer keeps the Node event loop alive.
 *
 * Live symptom that motivated this pin: agentos-bench runs
 * produced complete run JSONs but node never exited — the
 * ConsolidationPipeline.start() call inside CognitiveMemoryManager
 * ignored the `enabled: false` config.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      collections.set(c, [...(collections.get(c) ?? []), ...docs]);
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
    recordMemory: vi.fn().mockResolvedValue({ id: 'm', createdAt: '', accessCount: 0, lastAccessedAt: '' }),
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

describe('CognitiveMemoryManager — consolidation disabled does not spawn timers', () => {
  let manager: CognitiveMemoryManager;
  const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };
  const setIntervalSpy = vi.spyOn(global, 'setInterval');

  beforeEach(async () => {
    setIntervalSpy.mockClear();
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
      consolidation: { enabled: false },
    } as CognitiveMemoryConfig);
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it('does not call setInterval when consolidation.enabled = false', () => {
    // If the live hang bug were still here, setInterval would have
    // been called inside ConsolidationPipeline.start() during
    // manager.initialize(). The fix gates start() on enabled.
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('shutdown completes without leaving the event loop active', async () => {
    // Shutdown must be quick; any lingering timers would show up as
    // unresolved promises / long shutdown times on real Brain.
    const start = Date.now();
    await manager.shutdown();
    expect(Date.now() - start).toBeLessThan(500);
  });
});

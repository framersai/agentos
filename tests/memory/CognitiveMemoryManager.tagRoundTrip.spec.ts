/**
 * @fileoverview Pins: encode({tags: [...]}) → retrieve() round-trip
 * must preserve the tag list on ScoredMemoryTrace.tags. Any future
 * change that drops tags during vector-store hydration breaks this
 * test.
 *
 * The real SqliteBrain round-trip is covered downstream in
 * agentos-bench integration tests; this spec pins the in-memory
 * MemoryStore → VectorStore hydration path.
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
    recordMemory: vi.fn().mockResolvedValue({ id: 'mem-1', createdAt: new Date().toISOString(), accessCount: 0, lastAccessedAt: new Date().toISOString() }),
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

describe('CognitiveMemoryManager tag round-trip', () => {
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

  it('preserves tags from encode through retrieve', async () => {
    const encoded = await manager.encode(
      'the coffee machine broke on march 3',
      neutralMood,
      'neutral',
      { tags: ['bench-session:session_42', 'foo-tag'] },
    );
    expect(encoded.tags).toContain('bench-session:session_42');
    expect(encoded.tags).toContain('foo-tag');

    const result = await manager.retrieve('coffee machine', neutralMood, {
      scopes: [{ scope: 'user', scopeId: 'test-agent' }],
    });
    const retrieved = result.retrieved.find((t) => t.id === encoded.id);
    expect(retrieved, 'encoded trace should round-trip through retrieve').toBeDefined();
    expect(retrieved!.tags).toContain('bench-session:session_42');
    expect(retrieved!.tags).toContain('foo-tag');
  });

  it('supports multiple distinct tags per trace without collision', async () => {
    const a = await manager.encode('trace A', neutralMood, 'neutral', {
      tags: ['bench-session:s1', 'category:a'],
    });
    const b = await manager.encode('trace B', neutralMood, 'neutral', {
      tags: ['bench-session:s2', 'category:b'],
    });

    const result = await manager.retrieve('anything', neutralMood, {
      scopes: [{ scope: 'user', scopeId: 'test-agent' }],
    });
    const ra = result.retrieved.find((t) => t.id === a.id);
    const rb = result.retrieved.find((t) => t.id === b.id);
    expect(ra!.tags).toContain('bench-session:s1');
    expect(ra!.tags).toContain('category:a');
    expect(rb!.tags).toContain('bench-session:s2');
    expect(rb!.tags).toContain('category:b');
  });

  it('round-trips tags with colons and special characters in values', async () => {
    const enc = await manager.encode('special', neutralMood, 'neutral', {
      tags: ['bench-session:project:123', 'path:/a/b/c'],
    });
    const result = await manager.retrieve('special', neutralMood, {
      scopes: [{ scope: 'user', scopeId: 'test-agent' }],
    });
    const retrieved = result.retrieved.find((t) => t.id === enc.id);
    expect(retrieved!.tags).toContain('bench-session:project:123');
    expect(retrieved!.tags).toContain('path:/a/b/c');
  });
});

/**
 * @fileoverview Integration test for the CognitiveMemoryManager.
 * Tests the full encode → retrieve → assemble prompt cycle
 * with mocked dependencies (vector store, embedding manager, knowledge graph).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CognitiveMemoryManager } from '../../src/memory/CognitiveMemoryManager';
import type { CognitiveMemoryConfig, PADState } from '../../src/memory/core/config';
import type { IVectorStore, VectorDocument, QueryResult } from '../../src/rag/IVectorStore';
import type { IEmbeddingManager } from '../../src/rag/IEmbeddingManager';
import type { IKnowledgeGraph } from '../../src/core/knowledge/IKnowledgeGraph';
import type { IWorkingMemory } from '../../src/cognitive_substrate/memory/IWorkingMemory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockVectorStore(): IVectorStore {
  const collections = new Map<string, VectorDocument[]>();

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    createCollection: vi.fn().mockResolvedValue(undefined),
    deleteCollection: vi.fn().mockResolvedValue(undefined),
    collectionExists: vi.fn(async (name: string) => collections.has(name)),
    upsert: vi.fn(async (collection: string, docs: VectorDocument[]) => {
      const existing = collections.get(collection) ?? [];
      for (const doc of docs) {
        const idx = existing.findIndex((d) => d.id === doc.id);
        if (idx >= 0) existing[idx] = doc;
        else existing.push(doc);
      }
      collections.set(collection, existing);
      return { succeeded: docs.length, failed: 0 };
    }),
    query: vi.fn(async (collection: string, _embedding: number[], _options?: any): Promise<QueryResult> => {
      const docs = collections.get(collection) ?? [];
      return {
        documents: docs.map((d) => ({
          ...d,
          similarityScore: 0.85,
        })),
      };
    }),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ documentCount: 0, vectorCount: 0 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as IVectorStore;
}

function createMockEmbeddingManager(): IEmbeddingManager {
  return {
    generateEmbeddings: vi.fn(async (_input: any) => ({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
      model: 'mock',
      tokensUsed: 10,
    })),
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
  const store = new Map<string, any>();
  return {
    id: 'mock-wm',
    initialize: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(async (k: string, v: any) => { store.set(k, v); }),
    get: vi.fn(async (k: string) => store.get(k)),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    getAll: vi.fn(async () => Object.fromEntries(store)),
    clear: vi.fn(async () => { store.clear(); }),
    size: vi.fn(async () => store.size),
    has: vi.fn(async (k: string) => store.has(k)),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CognitiveMemoryManager (integration)', () => {
  let manager: CognitiveMemoryManager;
  let vectorStore: IVectorStore;
  let embeddingManager: IEmbeddingManager;
  const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };

  beforeEach(async () => {
    vectorStore = createMockVectorStore();
    embeddingManager = createMockEmbeddingManager();

    manager = new CognitiveMemoryManager();
    await manager.initialize({
      vectorStore,
      embeddingManager,
      knowledgeGraph: createMockKnowledgeGraph(),
      workingMemory: createMockWorkingMemory(),
      agentId: 'test-agent',
      traits: { openness: 0.7, conscientiousness: 0.6, emotionality: 0.5 },
      moodProvider: () => neutralMood,
      featureDetectionStrategy: 'keyword',
      collectionPrefix: 'test',
    });
  });

  describe('encode', () => {
    it('creates and stores a memory trace', async () => {
      const trace = await manager.encode('The user likes dark mode', neutralMood, 'neutral');

      expect(trace.id).toBeDefined();
      expect(trace.content).toBe('The user likes dark mode');
      expect(trace.type).toBe('episodic');
      expect(trace.isActive).toBe(true);
      expect(trace.encodingStrength).toBeGreaterThan(0);
    });

    it('embeds content via embedding manager', async () => {
      await manager.encode('test input', neutralMood, 'neutral');
      expect(embeddingManager.generateEmbeddings).toHaveBeenCalled();
    });

    it('upserts into vector store', async () => {
      await manager.encode('test input', neutralMood, 'neutral');
      expect(vectorStore.upsert).toHaveBeenCalled();
    });

    it('adds trace to working memory', async () => {
      await manager.encode('test input', neutralMood, 'neutral');
      expect(manager.getWorkingMemory().getSlotCount()).toBe(1);
    });

    it('respects custom type and scope options', async () => {
      const trace = await manager.encode('learned fact', neutralMood, 'neutral', {
        type: 'semantic',
        scope: 'persona',
        scopeId: 'persona-1',
      });

      expect(trace.type).toBe('semantic');
      expect(trace.scope).toBe('persona');
      expect(trace.scopeId).toBe('persona-1');
    });
  });

  describe('retrieve', () => {
    it('returns scored traces from vector search', async () => {
      // Encode a memory first
      await manager.encode('User prefers dark mode', neutralMood, 'neutral');

      const result = await manager.retrieve('dark mode preference', neutralMood, {
        scopes: [{ scope: 'user', scopeId: 'test-agent' }],
      });
      expect(result.retrieved.length).toBeGreaterThan(0);
      expect(result.retrieved[0].retrievalScore).toBeGreaterThan(0);
    });

    it('includes diagnostics', async () => {
      const result = await manager.retrieve('test query', neutralMood);
      expect(result.diagnostics).toHaveProperty('totalTimeMs');
      expect(result.diagnostics).toHaveProperty('candidatesScanned');
    });
  });

  describe('assembleForPrompt', () => {
    it('produces formatted context within token budget', async () => {
      await manager.encode('User likes TypeScript', neutralMood, 'neutral');
      await manager.encode('User works at Acme Corp', neutralMood, 'neutral');

      const assembled = await manager.assembleForPrompt('TypeScript help', 500, neutralMood, {
        scopes: [{ scope: 'user', scopeId: 'test-agent' }],
      });

      expect(assembled.tokensUsed).toBeLessThanOrEqual(500);
      expect(assembled.contextText.length).toBeGreaterThan(0);
      expect(assembled.includedMemoryIds.length).toBeGreaterThan(0);
    });
  });

  describe('getMemoryHealth', () => {
    it('returns health report', async () => {
      await manager.encode('test trace', neutralMood, 'neutral');
      const health = await manager.getMemoryHealth();

      expect(health.totalTraces).toBeGreaterThan(0);
      expect(health.activeTraces).toBeGreaterThan(0);
      expect(health.workingMemoryUtilization).toBeGreaterThan(0);
      expect(health.tracesPerType).toHaveProperty('episodic');
    });
  });

  describe('lifecycle', () => {
    it('throws before initialization', async () => {
      const uninitManager = new CognitiveMemoryManager();
      await expect(uninitManager.encode('test', neutralMood, 'neutral'))
        .rejects.toThrow('not initialized');
    });

    it('can shutdown gracefully', async () => {
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('personality bias', () => {
    it('different traits produce different encoding strengths for same input', async () => {
      // Manager already has openness: 0.7
      const traceOpen = await manager.encode('A surprising new discovery!', neutralMood, 'neutral');

      // Create a second manager with low openness
      const manager2 = new CognitiveMemoryManager();
      await manager2.initialize({
        vectorStore: createMockVectorStore(),
        embeddingManager: createMockEmbeddingManager(),
        knowledgeGraph: createMockKnowledgeGraph(),
        workingMemory: createMockWorkingMemory(),
        agentId: 'test-agent-2',
        traits: { openness: 0.1 },
        moodProvider: () => neutralMood,
        featureDetectionStrategy: 'keyword',
      });

      const traceClosed = await manager2.encode('A surprising new discovery!', neutralMood, 'neutral');

      // High openness should encode novel content more strongly
      expect(traceOpen.encodingStrength).not.toBe(traceClosed.encodingStrength);
    });
  });
});

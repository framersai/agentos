/**
 * @fileoverview Stage E Phase 4.1: CognitiveMemoryManager `typedNetwork` config
 * field + initialization wiring tests.
 *
 * Verifies the manager exposes a TypedNetworkStore + Observer + spreading
 * activation when `config.typedNetwork` is provided, and exposes nulls when
 * the field is absent (zero-cost no-op for non-Stage-E callers).
 *
 * @module memory/__tests__/CognitiveMemoryManager.typedNetwork.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CognitiveMemoryManager } from '../CognitiveMemoryManager.js';
import {
  TypedNetworkStore,
  TypedNetworkObserver,
  TypedSpreadingActivation,
  type ITypedExtractionLLM,
} from '../retrieval/typed-network/index.js';

function makeMinimalDeps() {
  const mockKnowledgeGraph = {
    initialize: vi.fn(),
    upsertEntity: vi.fn(),
    upsertRelation: vi.fn(),
    queryEntities: vi.fn().mockResolvedValue([]),
    getNeighborhood: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
    getRelations: vi.fn().mockResolvedValue([]),
    deleteEntity: vi.fn(),
    deleteRelation: vi.fn(),
    traverse: vi.fn().mockResolvedValue({
      root: { id: 'r', type: 'memory', label: 'r', properties: {}, confidence: 1, source: { type: 'system', timestamp: '', method: '' } } as any,
      levels: [],
      totalEntities: 0,
      totalRelations: 0,
    }),
    recordMemory: vi.fn(),
  };

  const mockVectorStore = {
    initialize: vi.fn(),
    upsert: vi.fn(),
    query: vi.fn().mockResolvedValue({ documents: [] }),
    collectionExists: vi.fn().mockResolvedValue(true),
    createCollection: vi.fn(),
  };

  const mockEmbeddingManager = {
    generateEmbeddings: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      modelId: 'test',
      providerId: 'test',
      usage: { totalTokens: 0 },
    }),
    getEmbeddingDimension: vi.fn().mockResolvedValue(3),
    getEmbeddingModelInfo: vi.fn().mockResolvedValue({
      dimension: 3,
      modelId: 'test',
      providerId: 'test',
      maxInputTokens: 8192,
    }),
    initialize: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
    shutdown: vi.fn(),
  };

  const mockWorkingMemory = {
    capacity: 7,
    store: vi.fn(),
    retrieve: vi.fn().mockResolvedValue([]),
    clear: vi.fn(),
    getSlots: vi.fn().mockReturnValue([]),
  };

  return {
    workingMemory: mockWorkingMemory as any,
    knowledgeGraph: mockKnowledgeGraph as any,
    vectorStore: mockVectorStore as any,
    embeddingManager: mockEmbeddingManager as any,
    agentId: 'stage-e-test',
    traits: { emotionality: 0.5, conscientiousness: 0.5 },
    moodProvider: () => ({ valence: 0, arousal: 0.3, dominance: 0 }),
    featureDetectionStrategy: 'keyword' as const,
  };
}

const stubLLM: ITypedExtractionLLM = {
  invoke: async () => JSON.stringify({ facts: [] }),
};

describe('CognitiveMemoryManager: typedNetwork wiring', () => {
  let manager: CognitiveMemoryManager;

  beforeEach(() => {
    manager = new CognitiveMemoryManager();
  });

  it('exposes null typed-network components when config.typedNetwork is absent', async () => {
    await manager.initialize(makeMinimalDeps());
    expect(manager.getTypedNetworkStore()).toBeNull();
    expect(manager.getTypedNetworkObserver()).toBeNull();
    expect(manager.getTypedSpreadingActivation()).toBeNull();
  });

  it('instantiates typed-network store/observer/activation when configured (full variant)', async () => {
    await manager.initialize({
      ...makeMinimalDeps(),
      typedNetwork: {
        variant: 'full',
        observerLLM: stubLLM,
      },
    });
    expect(manager.getTypedNetworkStore()).toBeInstanceOf(TypedNetworkStore);
    expect(manager.getTypedNetworkObserver()).toBeInstanceOf(TypedNetworkObserver);
    expect(manager.getTypedSpreadingActivation()).toBeInstanceOf(TypedSpreadingActivation);
  });

  it('instantiates only store + observer for minimal variant (no spreading activation)', async () => {
    await manager.initialize({
      ...makeMinimalDeps(),
      typedNetwork: {
        variant: 'minimal',
        observerLLM: stubLLM,
      },
    });
    expect(manager.getTypedNetworkStore()).toBeInstanceOf(TypedNetworkStore);
    expect(manager.getTypedNetworkObserver()).toBeInstanceOf(TypedNetworkObserver);
    // Minimal variant skips spreading activation: bank routing only.
    expect(manager.getTypedSpreadingActivation()).toBeNull();
  });
});

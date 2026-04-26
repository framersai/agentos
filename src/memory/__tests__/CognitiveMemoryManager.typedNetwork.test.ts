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

  it('encode() extracts typed facts via observer and persists into the typed-network store', async () => {
    // The stub LLM returns 2 typed facts: one WORLD, one OPINION.
    const extractingLLM: ITypedExtractionLLM = {
      invoke: async () =>
        JSON.stringify({
          facts: [
            {
              text: 'Berlin is in Germany',
              bank: 'WORLD',
              temporal: { mention: '2026-04-25T12:00:00Z' },
              participants: [],
              reasoning_markers: [],
              entities: ['Berlin', 'Germany'],
              confidence: 1.0,
            },
            {
              text: 'The user prefers TypeScript',
              bank: 'OPINION',
              temporal: { mention: '2026-04-25T12:00:00Z' },
              participants: [{ name: 'user', role: 'subject' }],
              reasoning_markers: ['because'],
              entities: ['TypeScript'],
              confidence: 0.7,
            },
          ],
        }),
    };
    await manager.initialize({
      ...makeMinimalDeps(),
      typedNetwork: { variant: 'full', observerLLM: extractingLLM },
    });

    // Encode triggers extraction.
    const trace = await manager.encode(
      'Berlin is in Germany. I think the user prefers TypeScript because it is statically typed.',
      { valence: 0, arousal: 0.3, dominance: 0 },
      'neutral',
    );

    const store = manager.getTypedNetworkStore()!;
    expect(store.getBank('WORLD').size).toBe(1);
    expect(store.getBank('OPINION').size).toBe(1);
    expect(store.getBank('EXPERIENCE').size).toBe(0);
    expect(store.getBank('OBSERVATION').size).toBe(0);

    // Trace ID should be the namespace anchor for the extracted facts so the
    // facts are linked back to the parent encoding event.
    const expectedFactId = `${trace.id}-fact-0`;
    expect(store.getFact(expectedFactId)).toBeDefined();
    expect(store.getFact(expectedFactId)?.text).toBe('Berlin is in Germany');
  });

  it('encode() is a no-op (no extraction call) when typedNetwork not configured', async () => {
    await manager.initialize(makeMinimalDeps());
    // No typedNetwork: extraction must never be called.
    await manager.encode(
      'Sample text',
      { valence: 0, arousal: 0.3, dominance: 0 },
      'neutral',
    );
    // No store to inspect; verifying via absence of error + null state above.
    expect(manager.getTypedNetworkStore()).toBeNull();
  });

  it('retrieve() surfaces activated typed facts via diagnostics.retrievedTypedFacts (full variant)', async () => {
    // LLM produces 2 facts on encode; spreading-activation seed entities
    // come from the query ("Berlin").
    const extractingLLM: ITypedExtractionLLM = {
      invoke: async () =>
        JSON.stringify({
          facts: [
            {
              text: 'Berlin is in Germany',
              bank: 'WORLD',
              temporal: { mention: '2026-04-25T12:00:00Z' },
              participants: [],
              reasoning_markers: [],
              entities: ['Berlin', 'Germany'],
              confidence: 1.0,
            },
            {
              text: 'Germany is in Europe',
              bank: 'WORLD',
              temporal: { mention: '2026-04-25T12:00:00Z' },
              participants: [],
              reasoning_markers: [],
              entities: ['Germany', 'Europe'],
              confidence: 1.0,
            },
          ],
        }),
    };
    await manager.initialize({
      ...makeMinimalDeps(),
      typedNetwork: { variant: 'full', observerLLM: extractingLLM },
    });

    await manager.encode(
      'Berlin is in Germany. Germany is in Europe.',
      { valence: 0, arousal: 0.3, dominance: 0 },
      'neutral',
    );

    // Query mentions Berlin (capitalized → naive entity extraction picks it up).
    const result = await manager.retrieve(
      'Tell me about Berlin',
      { valence: 0, arousal: 0.3, dominance: 0 },
    );

    // The Berlin fact should activate (seed match on 'Berlin' entity).
    expect(result.diagnostics.retrievedTypedFacts).toBeDefined();
    expect(result.diagnostics.retrievedTypedFacts!.length).toBeGreaterThan(0);
    const berlinFact = result.diagnostics.retrievedTypedFacts!.find((f) =>
      f.text.includes('Berlin'),
    );
    expect(berlinFact).toBeDefined();
  });

  it('retrieve() omits retrievedTypedFacts when typed-network not configured', async () => {
    await manager.initialize(makeMinimalDeps());
    const result = await manager.retrieve(
      'Berlin',
      { valence: 0, arousal: 0.3, dominance: 0 },
    );
    expect(result.diagnostics.retrievedTypedFacts).toBeUndefined();
  });

  it('retrieve() returns empty retrievedTypedFacts when no seed entity matches', async () => {
    await manager.initialize({
      ...makeMinimalDeps(),
      typedNetwork: { variant: 'full', observerLLM: stubLLM },
    });
    // No facts in store (stub LLM returns empty); query has no matching entities.
    const result = await manager.retrieve(
      'random unrelated query',
      { valence: 0, arousal: 0.3, dominance: 0 },
    );
    // Defined (typed-network ran) but empty (no seeds matched).
    expect(result.diagnostics.retrievedTypedFacts).toBeDefined();
    expect(result.diagnostics.retrievedTypedFacts).toEqual([]);
  });
});

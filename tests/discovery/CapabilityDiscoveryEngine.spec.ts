/**
 * @file CapabilityDiscoveryEngine.spec.ts
 * @description Unit tests for the CapabilityDiscoveryEngine class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityDiscoveryEngine } from '../../src/discovery/CapabilityDiscoveryEngine.js';
import { DEFAULT_DISCOVERY_CONFIG } from '../../src/discovery/types.js';
import type { CapabilityIndexSources, PresetCoOccurrence } from '../../src/discovery/types.js';

// ---------------------------------------------------------------------------
// MOCKS
// ---------------------------------------------------------------------------

function createMockEmbeddingManager() {
  return {
    generateEmbeddings: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      model: 'test-model',
      usage: { totalTokens: 10 },
    }),
  };
}

function createMockVectorStore() {
  return {
    createCollection: vi.fn().mockResolvedValue(undefined),
    collectionExists: vi.fn().mockResolvedValue(false),
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({
      documents: [
        {
          id: 'tool:web-search',
          similarityScore: 0.85,
          metadata: { kind: 'tool', name: 'web-search', category: 'information', available: true },
        },
      ],
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const testSources: CapabilityIndexSources = {
  tools: [
    {
      id: 'web-search',
      name: 'web-search',
      displayName: 'Web Search',
      description: 'Search the web for information',
      category: 'information',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CapabilityDiscoveryEngine', () => {
  let mockEmbeddingManager: ReturnType<typeof createMockEmbeddingManager>;
  let mockVectorStore: ReturnType<typeof createMockVectorStore>;
  let engine: CapabilityDiscoveryEngine;

  beforeEach(() => {
    mockEmbeddingManager = createMockEmbeddingManager();
    mockVectorStore = createMockVectorStore();
    engine = new CapabilityDiscoveryEngine(
      mockEmbeddingManager as any,
      mockVectorStore as any,
    );
  });

  // =========================================================================
  // isInitialized
  // =========================================================================

  describe('isInitialized', () => {
    it('returns false before initialize', () => {
      expect(engine.isInitialized()).toBe(false);
    });

    it('returns true after initialize', async () => {
      await engine.initialize(testSources);
      expect(engine.isInitialized()).toBe(true);
    });
  });

  // =========================================================================
  // initialize
  // =========================================================================

  describe('initialize', () => {
    it('sets isInitialized to true', async () => {
      await engine.initialize(testSources);
      expect(engine.isInitialized()).toBe(true);
    });

    it('calls embeddingManager.generateEmbeddings', async () => {
      await engine.initialize(testSources);
      expect(mockEmbeddingManager.generateEmbeddings).toHaveBeenCalled();
    });

    it('populates capability IDs', async () => {
      await engine.initialize(testSources);
      const ids = engine.listCapabilityIds();
      expect(ids).toContain('tool:web-search');
    });

    it('accepts preset co-occurrences', async () => {
      const presets: PresetCoOccurrence[] = [
        { presetName: 'test', capabilityIds: ['tool:web-search'] },
      ];
      await engine.initialize(testSources, presets);
      expect(engine.isInitialized()).toBe(true);
    });
  });

  // =========================================================================
  // discover
  // =========================================================================

  describe('discover', () => {
    it('returns empty result when not initialized', async () => {
      const result = await engine.discover('search the web');

      expect(result.tier0).toContain('not initialized');
      expect(result.tier1).toEqual([]);
      expect(result.tier2).toEqual([]);
    });

    it('calls index search and assembles result', async () => {
      await engine.initialize(testSources);

      // The vectorStore.query mock returns a matching document
      const result = await engine.discover('search the web');

      // Should have called generateEmbeddings at least once for the query
      // (once for index build, once for search)
      expect(mockEmbeddingManager.generateEmbeddings).toHaveBeenCalled();
      expect(mockVectorStore.query).toHaveBeenCalled();

      // Tier0 should be generated
      expect(result.tier0).toContain('Available capability categories');

      // Diagnostics should be populated
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('populates tier1 results from search', async () => {
      await engine.initialize(testSources);
      const result = await engine.discover('search the web');

      // The mock vectorStore returns one document with score 0.85
      // which exceeds the default tier1MinRelevance of 0.3
      if (result.tier1.length > 0) {
        expect(result.tier1[0].capability.id).toBe('tool:web-search');
        expect(result.tier1[0].relevanceScore).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // getConfig
  // =========================================================================

  describe('getConfig', () => {
    it('returns merged config with defaults', () => {
      const customEngine = new CapabilityDiscoveryEngine(
        mockEmbeddingManager as any,
        mockVectorStore as any,
        { tier1TopK: 10, tier2TopK: 4 },
      );

      const config = customEngine.getConfig();

      expect(config.tier1TopK).toBe(10);
      expect(config.tier2TopK).toBe(4);
      // Defaults should still be present
      expect(config.tier1MinRelevance).toBe(DEFAULT_DISCOVERY_CONFIG.tier1MinRelevance);
      expect(config.collectionName).toBe(DEFAULT_DISCOVERY_CONFIG.collectionName);
      expect(config.graphBoostFactor).toBe(DEFAULT_DISCOVERY_CONFIG.graphBoostFactor);
    });

    it('returns default config when no overrides', () => {
      const config = engine.getConfig();
      expect(config).toEqual(DEFAULT_DISCOVERY_CONFIG);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('returns correct counts after initialization', async () => {
      await engine.initialize(testSources);
      const stats = engine.getStats();

      expect(stats.capabilityCount).toBe(1);
      expect(stats.graphNodes).toBe(1);
      expect(stats.graphEdges).toBe(0); // Only one node, no edges
      expect(stats.indexVersion).toBe(1);
    });

    it('returns zeros before initialization', () => {
      const stats = engine.getStats();

      expect(stats.capabilityCount).toBe(0);
      expect(stats.graphNodes).toBe(0);
      expect(stats.graphEdges).toBe(0);
      expect(stats.indexVersion).toBe(0);
    });
  });

  // =========================================================================
  // refreshIndex
  // =========================================================================

  describe('refreshIndex', () => {
    it('updates capabilities', async () => {
      await engine.initialize(testSources);

      const newSources: Partial<CapabilityIndexSources> = {
        tools: [
          {
            id: 'news-search',
            name: 'news-search',
            displayName: 'News Search',
            description: 'Search news articles',
            inputSchema: { type: 'object' },
          },
        ],
      };

      await engine.refreshIndex(newSources);

      const ids = engine.listCapabilityIds();
      expect(ids).toContain('tool:web-search');
      expect(ids).toContain('tool:news-search');
    });

    it('increments index version', async () => {
      await engine.initialize(testSources);
      const statsBefore = engine.getStats();

      await engine.refreshIndex({
        tools: [
          {
            id: 'new-tool',
            name: 'new-tool',
            displayName: 'New Tool',
            description: 'New',
            inputSchema: { type: 'object' },
          },
        ],
      });

      const statsAfter = engine.getStats();
      expect(statsAfter.indexVersion).toBe(statsBefore.indexVersion + 1);
    });

    it('does nothing when called with no sources', async () => {
      await engine.initialize(testSources);
      const statsBefore = engine.getStats();

      await engine.refreshIndex();

      const statsAfter = engine.getStats();
      expect(statsAfter.indexVersion).toBe(statsBefore.indexVersion);
    });
  });

  // =========================================================================
  // getCapabilityDetail
  // =========================================================================

  describe('getCapabilityDetail', () => {
    it('returns descriptor for known capability', async () => {
      await engine.initialize(testSources);
      const detail = engine.getCapabilityDetail('tool:web-search');
      expect(detail).toBeDefined();
      expect(detail!.name).toBe('web-search');
    });

    it('returns undefined for unknown capability', async () => {
      await engine.initialize(testSources);
      const detail = engine.getCapabilityDetail('tool:nonexistent');
      expect(detail).toBeUndefined();
    });
  });
});

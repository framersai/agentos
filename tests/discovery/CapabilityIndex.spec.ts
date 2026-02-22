/**
 * @file CapabilityIndex.spec.ts
 * @description Unit tests for the CapabilityIndex class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityIndex } from '../../src/discovery/CapabilityIndex.js';
import type { CapabilityIndexSources, CapabilityDescriptor } from '../../src/discovery/types.js';

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
    query: vi.fn().mockResolvedValue({ documents: [] }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CapabilityIndex', () => {
  let mockEmbeddingManager: ReturnType<typeof createMockEmbeddingManager>;
  let mockVectorStore: ReturnType<typeof createMockVectorStore>;
  let index: CapabilityIndex;

  beforeEach(() => {
    mockEmbeddingManager = createMockEmbeddingManager();
    mockVectorStore = createMockVectorStore();
    index = new CapabilityIndex(
      mockEmbeddingManager as any,
      mockVectorStore as any,
      'test_collection',
    );
  });

  // =========================================================================
  // normalizeSources
  // =========================================================================

  describe('normalizeSources', () => {
    it('converts tool source correctly', () => {
      const sources: CapabilityIndexSources = {
        tools: [
          {
            id: 'web-search',
            name: 'web-search',
            displayName: 'Web Search',
            description: 'Search the web',
            category: 'information',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      };

      const result = index.normalizeSources(sources);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tool:web-search');
      expect(result[0].kind).toBe('tool');
      expect(result[0].name).toBe('web-search');
      expect(result[0].displayName).toBe('Web Search');
      expect(result[0].category).toBe('information');
      expect(result[0].fullSchema).toEqual({
        type: 'object',
        properties: { query: { type: 'string' } },
      });
      expect(result[0].sourceRef).toEqual({ type: 'tool', toolName: 'web-search' });
    });

    it('defaults tool category to general when not provided', () => {
      const sources: CapabilityIndexSources = {
        tools: [
          {
            id: 'my-tool',
            name: 'my-tool',
            displayName: 'My Tool',
            description: 'A tool',
            inputSchema: { type: 'object' },
          },
        ],
      };

      const result = index.normalizeSources(sources);
      expect(result[0].category).toBe('general');
    });

    it('converts skill source correctly', () => {
      const sources: CapabilityIndexSources = {
        skills: [
          {
            name: 'github-pr',
            description: 'Create GitHub PRs',
            content: '# GitHub PR Skill',
            category: 'developer-tools',
            tags: ['github', 'pr'],
            requiredSecrets: ['GITHUB_TOKEN'],
            metadata: { requires: { bins: ['gh', 'git'] } },
          },
        ],
      };

      const result = index.normalizeSources(sources);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('skill:github-pr');
      expect(result[0].kind).toBe('skill');
      // displayName derived from kebab-case: "Github Pr"
      expect(result[0].displayName).toBe('Github Pr');
      expect(result[0].tags).toEqual(['github', 'pr']);
      expect(result[0].fullContent).toBe('# GitHub PR Skill');
      expect(result[0].sourceRef).toEqual({
        type: 'skill',
        skillName: 'github-pr',
        skillPath: undefined,
      });
    });

    it('uses metadata.requires.bins as requiredTools fallback for skills', () => {
      const sources: CapabilityIndexSources = {
        skills: [
          {
            name: 'deploy',
            description: 'Deploy application',
            content: 'Deploy instructions',
            metadata: { requires: { bins: ['docker', 'kubectl'] } },
          },
        ],
      };

      const result = index.normalizeSources(sources);
      expect(result[0].requiredTools).toEqual(['docker', 'kubectl']);
    });

    it('converts extension source correctly', () => {
      const sources: CapabilityIndexSources = {
        extensions: [
          {
            id: 'ext-weather',
            name: 'weather-service',
            displayName: 'Weather Service',
            description: 'Get weather data',
            category: 'information',
            requiredSecrets: ['WEATHER_API_KEY'],
            available: true,
          },
        ],
      };

      const result = index.normalizeSources(sources);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('extension:weather-service');
      expect(result[0].kind).toBe('extension');
      expect(result[0].displayName).toBe('Weather Service');
      expect(result[0].available).toBe(true);
      expect(result[0].sourceRef).toEqual({
        type: 'extension',
        packageName: 'weather-service',
        extensionId: 'ext-weather',
      });
    });

    it('defaults extension available to false when not provided', () => {
      const sources: CapabilityIndexSources = {
        extensions: [
          {
            id: 'ext-missing',
            name: 'missing-ext',
            displayName: 'Missing',
            description: 'Not available',
            category: 'general',
          },
        ],
      };

      const result = index.normalizeSources(sources);
      expect(result[0].available).toBe(false);
    });

    it('converts channel source correctly with category always communication', () => {
      const sources: CapabilityIndexSources = {
        channels: [
          {
            platform: 'telegram',
            displayName: 'Telegram',
            description: 'Telegram messaging',
            tier: 'P0',
            capabilities: ['text', 'images', 'stickers'],
          },
        ],
      };

      const result = index.normalizeSources(sources);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('channel:telegram');
      expect(result[0].kind).toBe('channel');
      expect(result[0].category).toBe('communication');
      expect(result[0].tags).toEqual(['text', 'images', 'stickers']);
      expect(result[0].sourceRef).toEqual({ type: 'channel', platform: 'telegram' });
    });

    it('passes through manifest descriptors', () => {
      const manifest: CapabilityDescriptor = {
        id: 'custom:my-tool',
        kind: 'tool',
        name: 'my-tool',
        displayName: 'My Tool',
        description: 'A custom tool',
        category: 'custom',
        tags: [],
        requiredSecrets: [],
        requiredTools: [],
        available: true,
        sourceRef: { type: 'manifest', manifestPath: '/path/to/manifest', entryId: 'custom:my-tool' },
      };

      const sources: CapabilityIndexSources = { manifests: [manifest] };
      const result = index.normalizeSources(sources);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(manifest);
    });
  });

  // =========================================================================
  // buildIndex
  // =========================================================================

  describe('buildIndex', () => {
    it('calls embeddingManager and vectorStore', async () => {
      const sources: CapabilityIndexSources = {
        tools: [
          {
            id: 'search',
            name: 'search',
            displayName: 'Search',
            description: 'Search',
            inputSchema: { type: 'object' },
          },
        ],
      };

      await index.buildIndex(sources);

      expect(mockEmbeddingManager.generateEmbeddings).toHaveBeenCalledOnce();
      expect(mockVectorStore.createCollection).toHaveBeenCalledOnce();
      expect(mockVectorStore.upsert).toHaveBeenCalledOnce();
      expect(index.isBuilt()).toBe(true);
      expect(index.size()).toBe(1);
    });

    it('handles empty sources', async () => {
      await index.buildIndex({});

      expect(mockEmbeddingManager.generateEmbeddings).not.toHaveBeenCalled();
      expect(index.isBuilt()).toBe(true);
      expect(index.size()).toBe(0);
    });
  });

  // =========================================================================
  // search
  // =========================================================================

  describe('search', () => {
    it('returns empty when not built', async () => {
      const results = await index.search('test query', 5);
      expect(results).toEqual([]);
    });

    it('returns empty when built with empty sources', async () => {
      await index.buildIndex({});
      const results = await index.search('test query', 5);
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // upsertCapability / removeCapability
  // =========================================================================

  describe('upsertCapability', () => {
    it('adds to descriptors map', async () => {
      const cap: CapabilityDescriptor = {
        id: 'tool:new-tool',
        kind: 'tool',
        name: 'new-tool',
        displayName: 'New Tool',
        description: 'A new tool',
        category: 'general',
        tags: [],
        requiredSecrets: [],
        requiredTools: [],
        available: true,
        sourceRef: { type: 'tool', toolName: 'new-tool' },
      };

      await index.upsertCapability(cap);

      expect(index.getCapability('tool:new-tool')).toEqual(cap);
      expect(mockEmbeddingManager.generateEmbeddings).toHaveBeenCalledOnce();
      expect(mockVectorStore.upsert).toHaveBeenCalledOnce();
    });
  });

  describe('removeCapability', () => {
    it('removes from descriptors map', async () => {
      const cap: CapabilityDescriptor = {
        id: 'tool:to-remove',
        kind: 'tool',
        name: 'to-remove',
        displayName: 'To Remove',
        description: 'Will be removed',
        category: 'general',
        tags: [],
        requiredSecrets: [],
        requiredTools: [],
        available: true,
        sourceRef: { type: 'tool', toolName: 'to-remove' },
      };

      await index.upsertCapability(cap);
      expect(index.getCapability('tool:to-remove')).toBeDefined();

      await index.removeCapability('tool:to-remove');
      expect(index.getCapability('tool:to-remove')).toBeUndefined();
      expect(mockVectorStore.delete).toHaveBeenCalledWith('test_collection', ['tool:to-remove']);
    });
  });

  // =========================================================================
  // Accessors
  // =========================================================================

  describe('accessors', () => {
    it('getAllCapabilities returns all stored descriptors', async () => {
      const sources: CapabilityIndexSources = {
        tools: [
          { id: 't1', name: 'tool-a', displayName: 'A', description: 'A', inputSchema: { type: 'object' } },
          { id: 't2', name: 'tool-b', displayName: 'B', description: 'B', inputSchema: { type: 'object' } },
        ],
      };

      // Need multiple embeddings for multiple tools
      mockEmbeddingManager.generateEmbeddings.mockResolvedValueOnce({
        embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        model: 'test-model',
        usage: { totalTokens: 20 },
      });

      await index.buildIndex(sources);

      expect(index.getAllCapabilities()).toHaveLength(2);
      expect(index.listIds()).toEqual(['tool:tool-a', 'tool:tool-b']);
      expect(index.size()).toBe(2);
    });
  });
});

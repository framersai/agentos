/**
 * @file DiscoverCapabilitiesTool.spec.ts
 * @description Unit tests for the createDiscoverCapabilitiesTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDiscoverCapabilitiesTool } from '../../src/discovery/DiscoverCapabilitiesTool.js';
import type { ICapabilityDiscoveryEngine, CapabilityDiscoveryResult } from '../../src/discovery/types.js';
import type { ToolExecutionContext } from '../../src/core/tools/ITool.js';

// ---------------------------------------------------------------------------
// MOCKS
// ---------------------------------------------------------------------------

function makeMockResult(overrides: Partial<CapabilityDiscoveryResult> = {}): CapabilityDiscoveryResult {
  return {
    tier0: 'Available capability categories: ...',
    tier1: [
      {
        capability: {
          id: 'tool:web-search',
          kind: 'tool',
          name: 'web-search',
          displayName: 'Web Search',
          description: 'Search the web for information',
          category: 'information',
          tags: ['search'],
          requiredSecrets: [],
          requiredTools: [],
          available: true,
          sourceRef: { type: 'tool', toolName: 'web-search' },
        },
        relevanceScore: 0.87,
        summaryText: '1. web-search (tool): Search the web for information',
      },
    ],
    tier2: [],
    tokenEstimate: { tier0Tokens: 20, tier1Tokens: 15, tier2Tokens: 0, totalTokens: 35 },
    diagnostics: {
      queryTimeMs: 5,
      embeddingTimeMs: 3,
      graphTraversalTimeMs: 1,
      candidatesScanned: 10,
      capabilitiesRetrieved: 1,
    },
    ...overrides,
  };
}

function createMockEngine(overrides: Partial<ICapabilityDiscoveryEngine> = {}): ICapabilityDiscoveryEngine {
  return {
    isInitialized: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue(makeMockResult()),
    initialize: vi.fn().mockResolvedValue(undefined),
    getCapabilityDetail: vi.fn().mockReturnValue(undefined),
    refreshIndex: vi.fn().mockResolvedValue(undefined),
    listCapabilityIds: vi.fn().mockReturnValue(['tool:web-search']),
    ...overrides,
  };
}

const mockContext: ToolExecutionContext = {
  agentId: 'test-agent',
  conversationId: 'test-conv',
} as ToolExecutionContext;

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('createDiscoverCapabilitiesTool', () => {
  let mockEngine: ICapabilityDiscoveryEngine;

  beforeEach(() => {
    mockEngine = createMockEngine();
  });

  // =========================================================================
  // Tool shape
  // =========================================================================

  describe('tool shape', () => {
    it('returns an ITool with correct id, name, description, and schemas', () => {
      const tool = createDiscoverCapabilitiesTool(mockEngine);

      expect(tool.id).toBe('agentos-discover-capabilities');
      expect(tool.name).toBe('discover_capabilities');
      expect(tool.displayName).toBe('Discover Capabilities');
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.properties).toHaveProperty('query');
      expect(tool.inputSchema.required).toContain('query');
      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema!.properties).toHaveProperty('capabilities');
      expect(tool.outputSchema!.properties).toHaveProperty('totalIndexed');
      expect(tool.category).toBe('meta');
      expect(tool.hasSideEffects).toBe(false);
    });
  });

  // =========================================================================
  // execute
  // =========================================================================

  describe('execute', () => {
    it('returns error when engine not initialized', async () => {
      const uninitEngine = createMockEngine({
        isInitialized: vi.fn().mockReturnValue(false),
      });
      const tool = createDiscoverCapabilitiesTool(uninitEngine);

      const result = await tool.execute({ query: 'search' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('calls discoveryEngine.discover with correct args', async () => {
      const tool = createDiscoverCapabilitiesTool(mockEngine);

      await tool.execute(
        { query: 'search the web', kind: 'tool', category: 'information' },
        mockContext,
      );

      expect(mockEngine.discover).toHaveBeenCalledWith('search the web', {
        kind: 'tool',
        category: 'information',
        onlyAvailable: false,
      });
    });

    it('uses "any" as default kind when not specified', async () => {
      const tool = createDiscoverCapabilitiesTool(mockEngine);

      await tool.execute({ query: 'search the web' }, mockContext);

      expect(mockEngine.discover).toHaveBeenCalledWith('search the web', {
        kind: 'any',
        category: undefined,
        onlyAvailable: false,
      });
    });

    it('maps tier1 results to output format', async () => {
      const tool = createDiscoverCapabilitiesTool(mockEngine);

      const result = await tool.execute({ query: 'search' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output!.capabilities).toHaveLength(1);

      const cap = result.output!.capabilities[0];
      expect(cap.id).toBe('tool:web-search');
      expect(cap.name).toBe('Web Search');
      expect(cap.kind).toBe('tool');
      expect(cap.description).toBe('Search the web for information');
      expect(cap.category).toBe('information');
      expect(cap.relevance).toBe(0.87);
      expect(cap.available).toBe(true);
    });

    it('includes totalIndexed count', async () => {
      const tool = createDiscoverCapabilitiesTool(mockEngine);

      const result = await tool.execute({ query: 'search' }, mockContext);

      expect(result.output!.totalIndexed).toBe(1);
      expect(mockEngine.listCapabilityIds).toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      const errorEngine = createMockEngine({
        discover: vi.fn().mockRejectedValue(new Error('Embedding API down')),
      });
      const tool = createDiscoverCapabilitiesTool(errorEngine);

      const result = await tool.execute({ query: 'search' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Discovery search failed');
      expect(result.error).toContain('Embedding API down');
    });

    it('handles non-Error thrown values', async () => {
      const errorEngine = createMockEngine({
        discover: vi.fn().mockRejectedValue('string error'),
      });
      const tool = createDiscoverCapabilitiesTool(errorEngine);

      const result = await tool.execute({ query: 'search' }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });

    it('rounds relevance scores to 2 decimal places', async () => {
      const preciseResult = makeMockResult();
      preciseResult.tier1[0].relevanceScore = 0.87654321;

      const preciseEngine = createMockEngine({
        discover: vi.fn().mockResolvedValue(preciseResult),
      });
      const tool = createDiscoverCapabilitiesTool(preciseEngine);

      const result = await tool.execute({ query: 'search' }, mockContext);

      expect(result.output!.capabilities[0].relevance).toBe(0.88);
    });

    it('returns empty capabilities when tier1 is empty', async () => {
      const emptyResult = makeMockResult({ tier1: [] });
      const emptyEngine = createMockEngine({
        discover: vi.fn().mockResolvedValue(emptyResult),
      });
      const tool = createDiscoverCapabilitiesTool(emptyEngine);

      const result = await tool.execute({ query: 'nothing' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output!.capabilities).toEqual([]);
    });
  });
});

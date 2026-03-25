/**
 * @fileoverview Integration tests: emergent tools indexed in CapabilityDiscoveryEngine.
 * @module @framers/agentos/emergent/__tests__/discovery-integration
 *
 * Verifies that {@link CapabilityDiscoveryEngine.indexEmergentTools} correctly
 * converts {@link EmergentTool} objects into {@link CapabilityDescriptor}s,
 * skips session-tier tools, and indexes agent/shared-tier tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityDiscoveryEngine } from '../../discovery/CapabilityDiscoveryEngine.js';
import type { EmergentTool, ToolUsageStats } from '../types.js';
import type { JSONSchemaObject } from '../../core/tools/ITool.js';
import type { IEmbeddingManager } from '../../rag/IEmbeddingManager.js';
import type { IVectorStore } from '../../rag/IVectorStore.js';

// ---------------------------------------------------------------------------
// Helpers — build valid objects without relying on runtime constructors
// ---------------------------------------------------------------------------

let idCounter = 0;

/**
 * Build a minimal valid {@link ToolUsageStats} with optional overrides.
 */
function makeUsageStats(
  overrides: Partial<ToolUsageStats> = {},
): ToolUsageStats {
  return {
    totalUses: 0,
    successCount: 0,
    failureCount: 0,
    avgExecutionTimeMs: 0,
    lastUsedAt: null,
    confidenceScore: 0,
    ...overrides,
  };
}

/**
 * Build a minimal valid {@link EmergentTool} with optional overrides.
 */
function makeTool(overrides: Partial<EmergentTool> = {}): EmergentTool {
  idCounter += 1;
  const inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
  };
  const outputSchema: JSONSchemaObject = {
    type: 'object',
    properties: { result: { type: 'number' } },
  };
  return {
    id: `emergent:test-${idCounter}`,
    name: `test_tool_${idCounter}`,
    description: `A test emergent tool #${idCounter}.`,
    inputSchema,
    outputSchema,
    implementation: {
      mode: 'compose',
      steps: [{ name: 'step1', tool: 'echo', inputMapping: { text: '$input.value' } }],
    },
    tier: 'session',
    createdBy: 'agent-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    judgeVerdicts: [],
    usageStats: makeUsageStats(),
    source: 'forged by agent agent-1 during session sess-abc',
    ...overrides,
  };
}

/**
 * Create a mock embedding manager that returns zero-vectors.
 */
function mockEmbeddingManager(): IEmbeddingManager {
  return {
    generateEmbeddings: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      model: 'mock',
      totalTokens: 10,
    }),
  } as unknown as IEmbeddingManager;
}

/**
 * Create a mock vector store that stores nothing but fulfils the interface.
 */
function mockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ documents: [] }),
    delete: vi.fn().mockResolvedValue(undefined),
    createCollection: vi.fn().mockResolvedValue(undefined),
    collectionExists: vi.fn().mockResolvedValue(true),
  } as unknown as IVectorStore;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CapabilityDiscoveryEngine.indexEmergentTools', () => {
  let engine: CapabilityDiscoveryEngine;
  let vectorStore: IVectorStore;

  beforeEach(async () => {
    idCounter = 0;
    vectorStore = mockVectorStore();
    engine = new CapabilityDiscoveryEngine(
      mockEmbeddingManager(),
      vectorStore,
    );
    // Initialize with empty sources so the engine is ready
    await engine.initialize({ tools: [], skills: [], extensions: [], channels: [] });
  });

  // -------------------------------------------------------------------------
  // 1. indexEmergentTools adds tools as CapabilityDescriptors
  // -------------------------------------------------------------------------
  it('adds agent-tier tools as CapabilityDescriptors to the index', async () => {
    const tool = makeTool({ tier: 'agent', name: 'fetch_summary' });

    const indexed = await engine.indexEmergentTools([tool]);

    expect(indexed).toBe(1);
    const desc = engine.getCapabilityDetail('emergent-tool:fetch_summary');
    expect(desc).toBeDefined();
    expect(desc!.kind).toBe('emergent-tool');
    expect(desc!.name).toBe('fetch_summary');
    expect(desc!.displayName).toBe('fetch_summary');
    expect(desc!.category).toBe('emergent');
    expect(desc!.available).toBe(true);
    expect(desc!.tags).toContain('runtime-created');
    expect(desc!.tags).toContain('agent-forged');
    expect(desc!.tags).toContain('compose');
  });

  // -------------------------------------------------------------------------
  // 2. Session-tier tools are skipped
  // -------------------------------------------------------------------------
  it('skips session-tier tools (too ephemeral for indexing)', async () => {
    const sessionTool = makeTool({ tier: 'session', name: 'ephemeral_tool' });

    const indexed = await engine.indexEmergentTools([sessionTool]);

    expect(indexed).toBe(0);
    expect(engine.getCapabilityDetail('emergent-tool:ephemeral_tool')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. Agent-tier tools are indexed
  // -------------------------------------------------------------------------
  it('indexes agent-tier tools with correct sourceRef', async () => {
    const agentTool = makeTool({
      tier: 'agent',
      id: 'emergent:agent-abc',
      name: 'agent_tool',
    });

    await engine.indexEmergentTools([agentTool]);

    const desc = engine.getCapabilityDetail('emergent-tool:agent_tool');
    expect(desc).toBeDefined();
    expect(desc!.sourceRef).toEqual({
      type: 'emergent-tool',
      emergentToolId: 'emergent:agent-abc',
      tier: 'agent',
    });
  });

  // -------------------------------------------------------------------------
  // 4. Shared-tier tools are indexed
  // -------------------------------------------------------------------------
  it('indexes shared-tier tools with correct sourceRef', async () => {
    const sharedTool = makeTool({
      tier: 'shared',
      id: 'emergent:shared-xyz',
      name: 'shared_tool',
    });

    await engine.indexEmergentTools([sharedTool]);

    const desc = engine.getCapabilityDetail('emergent-tool:shared_tool');
    expect(desc).toBeDefined();
    expect(desc!.sourceRef).toEqual({
      type: 'emergent-tool',
      emergentToolId: 'emergent:shared-xyz',
      tier: 'shared',
    });
  });

  // -------------------------------------------------------------------------
  // 5. Sandbox-mode tools have hasSideEffects = true
  // -------------------------------------------------------------------------
  it('sets hasSideEffects = true for sandbox-mode tools', async () => {
    const sandboxTool = makeTool({
      tier: 'agent',
      name: 'sandbox_tool',
      implementation: {
        mode: 'sandbox',
        code: 'async function run(input) { return input; }',
        allowlist: [],
      },
    });

    await engine.indexEmergentTools([sandboxTool]);

    const desc = engine.getCapabilityDetail('emergent-tool:sandbox_tool');
    expect(desc).toBeDefined();
    expect(desc!.hasSideEffects).toBe(true);
    expect(desc!.tags).toContain('sandbox');
  });

  // -------------------------------------------------------------------------
  // 6. Composable-mode tools have hasSideEffects = false
  // -------------------------------------------------------------------------
  it('sets hasSideEffects = false for compose-mode tools', async () => {
    const composeTool = makeTool({ tier: 'agent', name: 'compose_tool' });

    await engine.indexEmergentTools([composeTool]);

    const desc = engine.getCapabilityDetail('emergent-tool:compose_tool');
    expect(desc).toBeDefined();
    expect(desc!.hasSideEffects).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 7. Mixed batch: filters session, indexes agent + shared
  // -------------------------------------------------------------------------
  it('filters session tools from a mixed batch', async () => {
    const tools = [
      makeTool({ tier: 'session', name: 'session_a' }),
      makeTool({ tier: 'agent', name: 'agent_b' }),
      makeTool({ tier: 'shared', name: 'shared_c' }),
      makeTool({ tier: 'session', name: 'session_d' }),
    ];

    const indexed = await engine.indexEmergentTools(tools);

    expect(indexed).toBe(2);
    expect(engine.getCapabilityDetail('emergent-tool:session_a')).toBeUndefined();
    expect(engine.getCapabilityDetail('emergent-tool:agent_b')).toBeDefined();
    expect(engine.getCapabilityDetail('emergent-tool:shared_c')).toBeDefined();
    expect(engine.getCapabilityDetail('emergent-tool:session_d')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 8. Empty array returns 0
  // -------------------------------------------------------------------------
  it('returns 0 when given an empty array', async () => {
    const indexed = await engine.indexEmergentTools([]);
    expect(indexed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 9. Indexed tools appear in listCapabilityIds
  // -------------------------------------------------------------------------
  it('indexed emergent tools appear in listCapabilityIds()', async () => {
    await engine.indexEmergentTools([
      makeTool({ tier: 'agent', name: 'listed_tool' }),
    ]);

    const ids = engine.listCapabilityIds();
    expect(ids).toContain('emergent-tool:listed_tool');
  });
});

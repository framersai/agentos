/**
 * @fileoverview Integration tests for ToolOrchestrator + Emergent Capability Engine.
 *
 * Covers:
 *  1. When `emergent` is disabled (default), `forge_tool` is NOT in the tool list.
 *  2. When `emergent` is enabled, `forge_tool` IS in the tool list.
 *  3. The emergent engine is accessible via `getEmergentEngine()`.
 *  4. `cleanupEmergentSession()` delegates to the engine without throwing.
 *  5. `getEmergentEngine()` returns `undefined` when emergent is disabled.
 *
 * These tests mock the orchestrator's dependencies (ToolExecutor, PermissionManager)
 * rather than testing the full forge pipeline — that is already covered by
 * engine-integration.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolOrchestrator } from '../../core/tools/ToolOrchestrator';
import type { IToolPermissionManager } from '../../core/tools/permissions/IToolPermissionManager';
import { ToolExecutor } from '../../core/tools/ToolExecutor';
import type { ITool } from '../../core/tools/ITool';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock of the ToolPermissionManager.
 * Always allows execution so we can focus on tool list checks.
 */
function makeMockPermissionManager(): IToolPermissionManager {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    isExecutionAllowed: vi.fn().mockResolvedValue({ isAllowed: true }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as IToolPermissionManager;
}

/**
 * Build a minimal mock of the ToolExecutor.
 *
 * Maintains an internal registry map so `registerTool`, `getTool`, and
 * `listAvailableTools` work correctly during initialization.
 */
function makeMockToolExecutor(): ToolExecutor {
  const registry = new Map<string, ITool>();

  return {
    registerTool: vi.fn(async (tool: ITool) => {
      registry.set(tool.name, tool);
    }),
    unregisterTool: vi.fn(async (name: string) => {
      return registry.delete(name);
    }),
    getTool: vi.fn(async (name: string) => {
      return registry.get(name);
    }),
    listAvailableTools: vi.fn(() => {
      return Array.from(registry.values()).map((t) => ({
        name: t.name,
        description: t.description,
      }));
    }),
    executeTool: vi.fn().mockResolvedValue({ success: true, output: {} }),
    shutdownAllTools: vi.fn().mockResolvedValue(undefined),
  } as unknown as ToolExecutor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolOrchestrator — emergent engine integration', () => {
  let orchestrator: ToolOrchestrator;
  let permissionManager: IToolPermissionManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    orchestrator = new ToolOrchestrator();
    permissionManager = makeMockPermissionManager();
    toolExecutor = makeMockToolExecutor();
  });

  // -------------------------------------------------------------------------
  // 1. Emergent disabled (default behaviour)
  // -------------------------------------------------------------------------

  it('does NOT register forge_tool when emergent is disabled (default)', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
    );

    const tools = await orchestrator.listAvailableTools();
    const forgeToolDef = tools.find((t) => t.name === 'forge_tool');

    expect(forgeToolDef).toBeUndefined();
  });

  it('returns undefined from getEmergentEngine() when emergent is disabled', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
    );

    expect(orchestrator.getEmergentEngine()).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 2. Emergent enabled
  // -------------------------------------------------------------------------

  it('registers forge_tool when emergent is enabled', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
      undefined, // initialTools
      undefined, // hitlManager
      {
        enabled: true,
        generateText: vi.fn().mockResolvedValue('{}'),
      },
    );

    const tools = await orchestrator.listAvailableTools();
    const forgeToolDef = tools.find((t) => t.name === 'forge_tool');

    expect(forgeToolDef).toBeDefined();
    expect(forgeToolDef!.name).toBe('forge_tool');
    expect(forgeToolDef!.description).toContain('Create a new tool');
  });

  // -------------------------------------------------------------------------
  // 3. Engine is accessible
  // -------------------------------------------------------------------------

  it('returns the EmergentCapabilityEngine from getEmergentEngine()', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
      undefined,
      undefined,
      { enabled: true },
    );

    const engine = orchestrator.getEmergentEngine();
    expect(engine).toBeDefined();
    // Verify it has the expected public methods.
    expect(typeof engine!.forge).toBe('function');
    expect(typeof engine!.cleanupSession).toBe('function');
    expect(typeof engine!.getSessionTools).toBe('function');
  });

  // -------------------------------------------------------------------------
  // 4. Session cleanup delegates correctly
  // -------------------------------------------------------------------------

  it('cleanupEmergentSession is a no-op when emergent is disabled', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
    );

    // Should not throw.
    expect(() => orchestrator.cleanupEmergentSession('sess-abc')).not.toThrow();
  });

  it('cleanupEmergentSession delegates to engine when emergent is enabled', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
      undefined,
      undefined,
      { enabled: true },
    );

    const engine = orchestrator.getEmergentEngine()!;
    const cleanupSpy = vi.spyOn(engine, 'cleanupSession');

    orchestrator.cleanupEmergentSession('sess-xyz');

    expect(cleanupSpy).toHaveBeenCalledWith('sess-xyz');
  });

  // -------------------------------------------------------------------------
  // 5. Custom emergent config is merged with defaults
  // -------------------------------------------------------------------------

  it('merges custom emergentConfig with defaults', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
      undefined,
      undefined,
      {
        enabled: true,
        config: { maxSessionTools: 3, sandboxTimeoutMs: 1000 },
      },
    );

    const engine = orchestrator.getEmergentEngine();
    expect(engine).toBeDefined();
    // Engine exists and forge_tool is registered — config was accepted.
    const tools = await orchestrator.listAvailableTools();
    expect(tools.find((t) => t.name === 'forge_tool')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 6. No LLM fallback — judge rejects when no generateText is provided
  // -------------------------------------------------------------------------

  it('uses a reject-all judge stub when no generateText callback is provided', async () => {
    await orchestrator.initialize(
      undefined,
      permissionManager,
      toolExecutor,
      undefined,
      undefined,
      { enabled: true },
    );

    const engine = orchestrator.getEmergentEngine()!;

    // Attempt to forge a tool. Since no LLM is configured, the judge should
    // fail and the forge result should indicate failure.
    const result = await engine.forge(
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
        implementation: {
          mode: 'sandbox',
          code: 'function execute(input) { return {}; }',
          allowlist: [],
        },
        testCases: [{ input: {}, expectedOutput: {} }],
      },
      { agentId: 'agent-1', sessionId: 'sess-1' },
    );

    expect(result.success).toBe(false);
    // The error comes from the judge failing to call the LLM.
    expect(result.verdict?.approved).toBe(false);
  });
});

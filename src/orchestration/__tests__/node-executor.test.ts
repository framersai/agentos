/**
 * @file node-executor.test.ts
 * @description Unit tests for `NodeExecutor`.
 *
 * Covers:
 * 1. Tool node — successful invocation via `ToolOrchestrator`.
 * 2. Router node — function condition resolves to `routeTarget`.
 * 3. Guardrail node — passes when engine returns `passed: true`.
 * 4. Timeout — node that takes 5000 ms is aborted by a 50 ms timeout.
 * 5. Human node — always resolves with `interrupt: true`.
 * 6. No ToolOrchestrator — tool node returns `success: false` with error message.
 */

import { describe, it, expect, vi } from 'vitest';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import type { GraphNode, GraphState } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal `GraphNode` for a `tool` executor.
 *
 * @param toolName - Registered tool name.
 */
function makeToolNode(toolName: string): GraphNode {
  return {
    id: `node-${toolName}`,
    type: 'tool',
    executorConfig: { type: 'tool', toolName },
    executionMode: 'single_turn',
    effectClass: 'external',
    checkpoint: 'none',
  };
}

/**
 * Builds a minimal `GraphNode` for a `router` executor using a function condition.
 *
 * @param fn - Routing function receiving `GraphState` and returning the next node id.
 */
function makeRouterNode(fn: (state: GraphState) => string): GraphNode {
  return {
    id: 'node-router',
    type: 'router',
    executorConfig: { type: 'router', condition: { type: 'function', fn } },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

/**
 * Builds a minimal `GraphNode` for a `guardrail` executor.
 *
 * @param guardrailIds  - Guardrail identifiers to evaluate.
 * @param onViolation   - Action taken on violation.
 * @param rerouteTarget - Optional reroute destination.
 */
function makeGuardrailNode(
  guardrailIds: string[],
  onViolation: 'block' | 'reroute' | 'warn' | 'sanitize' = 'block',
  rerouteTarget?: string,
): GraphNode {
  return {
    id: 'node-guardrail',
    type: 'guardrail',
    executorConfig: { type: 'guardrail', guardrailIds, onViolation, rerouteTarget },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

/**
 * Builds a minimal `GraphNode` for a `human` executor.
 *
 * @param prompt - Message surfaced to the human operator.
 */
function makeHumanNode(prompt: string): GraphNode {
  return {
    id: 'node-human',
    type: 'human',
    executorConfig: { type: 'human', prompt },
    executionMode: 'single_turn',
    effectClass: 'human',
    checkpoint: 'none',
  };
}

/** Minimal stub of `GraphState` sufficient for routing and guardrail tests. */
const emptyState: Partial<GraphState> = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NodeExecutor', () => {
  // -------------------------------------------------------------------------
  // Test 1 — tool node executes via ToolOrchestrator
  // -------------------------------------------------------------------------

  it('executes a tool node via ToolOrchestrator and returns its output', async () => {
    const processToolCall = vi.fn().mockResolvedValue({
      success: true,
      output: { result: 'hello from tool' },
    });

    const executor = new NodeExecutor({ toolOrchestrator: { processToolCall } });
    const result = await executor.execute(makeToolNode('greet'), emptyState);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ result: 'hello from tool' });
    expect(processToolCall).toHaveBeenCalledOnce();
    expect(processToolCall).toHaveBeenCalledWith({
      toolCallRequest: { toolName: 'greet', arguments: {} },
    });
  });

  // -------------------------------------------------------------------------
  // Test 2 — router node with function condition resolves routeTarget
  // -------------------------------------------------------------------------

  it('executes a router node with a function condition and returns routeTarget', async () => {
    const routeFn = vi.fn().mockReturnValue('branch-approved');
    const executor = new NodeExecutor({});
    const result = await executor.execute(makeRouterNode(routeFn), emptyState);

    expect(result.success).toBe(true);
    expect(result.routeTarget).toBe('branch-approved');
    expect(routeFn).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Test 3 — guardrail node passes when engine returns passed: true
  // -------------------------------------------------------------------------

  it('executes a guardrail node and returns passed:true when engine passes', async () => {
    const evaluate = vi.fn().mockResolvedValue({ passed: true, results: [] });

    const executor = new NodeExecutor({
      guardrailEngine: { evaluate },
    });

    const result = await executor.execute(
      makeGuardrailNode(['safe-content', 'no-pii']),
      emptyState,
    );

    expect(result.success).toBe(true);
    expect((result.output as { passed: boolean }).passed).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(undefined, ['safe-content', 'no-pii']);
  });

  // -------------------------------------------------------------------------
  // Test 4 — timeout aborts a slow tool node
  // -------------------------------------------------------------------------

  it('aborts execution and returns success:false when node.timeout is exceeded', async () => {
    // Tool that never resolves within the test window (5 000 ms).
    const processToolCall = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 5_000)),
    );

    const executor = new NodeExecutor({ toolOrchestrator: { processToolCall } });

    // Clone makeToolNode and inject a 50 ms timeout.
    const node: GraphNode = { ...makeToolNode('slow-tool'), timeout: 50 };

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout after 50ms/);
  }, 2_000 /* test-level timeout: 2 s — well above the 50 ms node timeout */);

  // -------------------------------------------------------------------------
  // Test 5 — human node suspends execution with interrupt flag
  // -------------------------------------------------------------------------

  it('executes a human node and returns interrupt:true with the configured prompt', async () => {
    const executor = new NodeExecutor({});
    const result = await executor.execute(
      makeHumanNode('Please approve the generated content.'),
      emptyState,
    );

    expect(result.interrupt).toBe(true);
    expect(result.success).toBe(false);
    expect((result.output as { prompt: string }).prompt).toBe(
      'Please approve the generated content.',
    );
  });

  // -------------------------------------------------------------------------
  // Test 6 — tool node without ToolOrchestrator returns graceful error
  // -------------------------------------------------------------------------

  it('returns success:false when no ToolOrchestrator is configured', async () => {
    // Executor created with empty deps — no toolOrchestrator.
    const executor = new NodeExecutor({});
    const result = await executor.execute(makeToolNode('any-tool'), emptyState);

    expect(result.success).toBe(false);
    expect(result.error).toBe('No ToolOrchestrator configured');
  });
});

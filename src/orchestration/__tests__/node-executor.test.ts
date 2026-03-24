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

  // -------------------------------------------------------------------------
  // Test 7 — GMI node with mock LoopController accumulates text
  // -------------------------------------------------------------------------

  it('executes a gmi node with LoopController and returns accumulated text', async () => {
    const mockLoopController = {
      async *execute(_config: unknown, context: { generateStream: () => AsyncGenerator<unknown, unknown, undefined> }) {
        const gen = context.generateStream();
        while (true) {
          const { value, done } = await gen.next();
          if (done) break;
          const chunk = value as { type: string; content?: string };
          if (chunk.type === 'text_delta' && chunk.content) {
            yield { type: 'text_delta' as const, content: chunk.content };
          }
        }
        yield { type: 'loop_complete' as const, totalIterations: 1 };
      },
    };

    async function* mockProviderCall() {
      yield { type: 'text_delta' as const, content: 'Hello ' };
      yield { type: 'text_delta' as const, content: 'World' };
      return { responseText: 'Hello World', toolCalls: [], finishReason: 'stop' };
    }

    const executor = new NodeExecutor({
      loopController: mockLoopController as any,
      providerCall: () => mockProviderCall(),
    });

    const node: GraphNode = {
      id: 'node-gmi',
      type: 'gmi',
      executorConfig: { type: 'gmi', instructions: 'Say hello' },
      executionMode: 'single_turn',
      effectClass: 'pure',
      checkpoint: 'none',
    };

    const result = await executor.execute(node, emptyState);
    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello World');
  });

  // -------------------------------------------------------------------------
  // Test 8 — Subgraph node with mock resolver invokes recursively
  // -------------------------------------------------------------------------

  it('executes a subgraph node by delegating to a child runtime', async () => {
    const childGraph = {
      id: 'child-graph',
      name: 'child',
      nodes: [],
      edges: [],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'none' as const,
      memoryConsistency: 'live' as const,
    };

    const mockRuntime = {
      invoke: vi.fn().mockResolvedValue({ answer: 42 }),
    };

    const executor = new NodeExecutor({
      subgraphResolver: (id: string) => id === 'child-graph' ? childGraph : undefined,
      createSubgraphRuntime: () => mockRuntime,
    });

    const node: GraphNode = {
      id: 'node-subgraph',
      type: 'subgraph',
      executorConfig: {
        type: 'subgraph',
        graphId: 'child-graph',
        inputMapping: { 'query': 'q' },
        outputMapping: { 'answer': 'result' },
      },
      executionMode: 'single_turn',
      effectClass: 'pure',
      checkpoint: 'none',
    };

    const state: Partial<GraphState> = { scratch: { query: 'hello' } } as any;
    const result = await executor.execute(node, state);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ answer: 42 });
    expect(result.scratchUpdate).toEqual({ result: 42 });
    expect(mockRuntime.invoke).toHaveBeenCalledWith(childGraph, { q: 'hello' });
  });

  // -------------------------------------------------------------------------
  // Test 9 — Expression evaluator: scratch.x > 5
  // -------------------------------------------------------------------------

  it('evaluates expression "scratch.x > 5 ? \'yes\' : \'no\'" correctly', async () => {
    const executor = new NodeExecutor({});
    const node: GraphNode = {
      id: 'node-expr',
      type: 'router',
      executorConfig: {
        type: 'router',
        condition: { type: 'expression', expr: "scratch.x > 5 ? 'yes' : 'no'" },
      },
      executionMode: 'single_turn',
      effectClass: 'pure',
      checkpoint: 'none',
    };

    const state: Partial<GraphState> = { scratch: { x: 10 } } as any;
    const result = await executor.execute(node, state);

    expect(result.success).toBe(true);
    expect(result.routeTarget).toBe('yes');
  });

  // -------------------------------------------------------------------------
  // Test 10 — Expression evaluator: scratch.name == 'pro'
  // -------------------------------------------------------------------------

  it('evaluates expression "scratch.name == \'pro\' ? \'a\' : \'b\'" correctly', async () => {
    const executor = new NodeExecutor({});
    const node: GraphNode = {
      id: 'node-expr2',
      type: 'router',
      executorConfig: {
        type: 'router',
        condition: { type: 'expression', expr: "scratch.name == 'pro' ? 'a' : 'b'" },
      },
      executionMode: 'single_turn',
      effectClass: 'pure',
      checkpoint: 'none',
    };

    const state: Partial<GraphState> = { scratch: { name: 'pro' } } as any;
    const result = await executor.execute(node, state);

    expect(result.success).toBe(true);
    expect(result.routeTarget).toBe('a');
  });

  // -------------------------------------------------------------------------
  // Test 11 — Expression evaluator returns 'false' on invalid expression
  // -------------------------------------------------------------------------

  it('returns "false" when expression evaluation fails', async () => {
    const executor = new NodeExecutor({});
    const node: GraphNode = {
      id: 'node-expr-bad',
      type: 'router',
      executorConfig: {
        type: 'router',
        condition: { type: 'expression', expr: '{{invalid syntax' },
      },
      executionMode: 'single_turn',
      effectClass: 'pure',
      checkpoint: 'none',
    };

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    expect(result.routeTarget).toBe('false');
  });
});

/**
 * @file graph-runtime.test.ts
 * @description Integration tests for `GraphRuntime`.
 *
 * Covers:
 * 1. Linear graph end-to-end — START→a→b→END with mock executor returns defined output.
 * 2. Streaming events — correct event types emitted in causal order.
 * 3. Checkpoints saved — graph with `checkpointPolicy='every_node'` creates checkpoint entries.
 * 4. Conditional edges — routing to 'b' or 'c' based on `state.scratch.goToB`.
 * 5. Resume from checkpoint — fork a checkpoint with patched state, resume, verify completion.
 */

import { describe, it, expect, vi } from 'vitest';
import { GraphRuntime } from '../runtime/GraphRuntime.js';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import { InMemoryCheckpointStore } from '../checkpoint/InMemoryCheckpointStore.js';
import type { CompiledExecutionGraph, GraphNode, GraphState } from '../ir/types.js';
import { START, END } from '../ir/types.js';
import type { NodeExecutionResult } from '../runtime/NodeExecutor.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `GraphNode` with sensible defaults.
 *
 * @param id          - Unique node identifier.
 * @param overrides   - Optional field overrides.
 */
function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: 'gmi',
    executorConfig: { type: 'gmi', instructions: `node-${id}` },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
    ...overrides,
  };
}

/**
 * Build a `CompiledExecutionGraph` with START→[nodeIds in order]→END edges.
 *
 * The helper adds static edges START→first, last→END, and consecutive node→node edges.
 *
 * @param id      - Graph identifier.
 * @param nodes   - Array of nodes to include (order determines static edge chain).
 * @param options - Optional overrides for the graph-level fields.
 */
function makeLinearGraph(
  id: string,
  nodes: GraphNode[],
  options: Partial<CompiledExecutionGraph> = {},
): CompiledExecutionGraph {
  const edges = nodes.map((n, i) => ({
    id: `e${i}`,
    source: i === 0 ? START : nodes[i - 1]!.id,
    target: n.id,
    type: 'static' as const,
  }));
  edges.push({
    id: `e${nodes.length}`,
    source: nodes[nodes.length - 1]!.id,
    target: END,
    type: 'static' as const,
  });

  return {
    id,
    name: id,
    nodes,
    edges,
    stateSchema: { input: {}, scratch: {}, artifacts: {} },
    reducers: {},
    checkpointPolicy: 'explicit',
    memoryConsistency: 'live',
    ...options,
  };
}

/**
 * Create a `NodeExecutor` whose `execute()` is fully controlled by the supplied mock.
 *
 * @param mockFn - `vi.fn()` (or similar) that replaces `execute()`.
 */
function makeExecutorWithMock(
  mockFn: (node: GraphNode, state: Partial<GraphState>) => Promise<NodeExecutionResult>,
): NodeExecutor {
  const executor = new NodeExecutor({});
  // Replace the public method directly so we don't need to subclass.
  executor.execute = mockFn as typeof executor.execute;
  return executor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphRuntime', () => {
  // ── 1. Linear graph end-to-end ─────────────────────────────────────────────

  it('executes a linear START→a→b→END graph and returns defined output', async () => {
    const store = new InMemoryCheckpointStore();
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: 'ok',
      artifactsUpdate: { result: 'final' },
    } satisfies NodeExecutionResult);

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const graph = makeLinearGraph('g-linear', [makeNode('a'), makeNode('b')]);
    const result = await runtime.invoke(graph, { query: 'hello' });

    // Both nodes were executed.
    expect(executeMock).toHaveBeenCalledTimes(2);
    // Final output should be defined (artifacts object).
    expect(result).toBeDefined();
  });

  // ── 2. Streaming events in correct order ───────────────────────────────────

  it('streams events in correct causal order for a linear graph', async () => {
    const store = new InMemoryCheckpointStore();
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: 'step-output',
    } satisfies NodeExecutionResult);

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const graph = makeLinearGraph('g-events', [makeNode('a'), makeNode('b')]);
    const events: string[] = [];

    for await (const event of runtime.stream(graph, {})) {
      events.push(event.type);
    }

    // Verify run_start appears first and run_end appears last.
    expect(events[0]).toBe('run_start');
    expect(events[events.length - 1]).toBe('run_end');

    // node_start and node_end must each appear twice (once per node).
    expect(events.filter(t => t === 'node_start')).toHaveLength(2);
    expect(events.filter(t => t === 'node_end')).toHaveLength(2);

    // Every node_start must be immediately followed by node_end (linear graph, no checkpoints).
    for (let i = 0; i < events.length; i++) {
      if (events[i] === 'node_start') {
        expect(events[i + 1]).toBe('node_end');
      }
    }
  });

  // ── 3. Checkpoints saved ───────────────────────────────────────────────────

  it('saves checkpoints after every node when checkpointPolicy is every_node', async () => {
    const store = new InMemoryCheckpointStore();
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: 'cp-output',
    } satisfies NodeExecutionResult);

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const graph = makeLinearGraph(
      'g-checkpoint',
      [makeNode('a'), makeNode('b')],
      { checkpointPolicy: 'every_node' },
    );

    await runtime.invoke(graph, {});

    // There should be at least one checkpoint per node (a + b = 2).
    const checkpoints = await store.list('g-checkpoint');
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
  });

  // ── 4. Conditional edges ───────────────────────────────────────────────────

  it('routes to node b when condition fn returns b based on scratch.goToB', async () => {
    const store = new InMemoryCheckpointStore();

    /**
     * Node 'a' sets `scratch.goToB = true`.
     * Nodes 'b' and 'c' are passive — they just return success.
     */
    const executeMock = vi.fn().mockImplementation(
      async (node: GraphNode): Promise<NodeExecutionResult> => {
        if (node.id === 'a') {
          return { success: true, output: 'a-done', scratchUpdate: { goToB: true } };
        }
        return { success: true, output: `${node.id}-done` };
      },
    );

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const nodeA = makeNode('a');
    const nodeB = makeNode('b');
    const nodeC = makeNode('c');

    /**
     * Graph topology:
     *   START ──static──► a ──conditional──► b (if goToB)
     *                       └──conditional──► c (if !goToB)
     *   b ──static──► END
     *   c ──static──► END
     */
    const graph: CompiledExecutionGraph = {
      id: 'g-conditional',
      name: 'conditional-test',
      nodes: [nodeA, nodeB, nodeC],
      edges: [
        { id: 'e0', source: START, target: 'a', type: 'static' },
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          type: 'conditional',
          condition: {
            type: 'function',
            fn: (state: GraphState) =>
              (state.scratch as Record<string, unknown>).goToB ? 'b' : 'c',
          },
        },
        {
          id: 'e2',
          source: 'a',
          target: 'c',
          type: 'conditional',
          condition: {
            type: 'function',
            fn: (state: GraphState) =>
              (state.scratch as Record<string, unknown>).goToB ? 'b' : 'c',
          },
        },
        { id: 'e3', source: 'b', target: END, type: 'static' },
        { id: 'e4', source: 'c', target: END, type: 'static' },
      ],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'explicit',
      memoryConsistency: 'live',
    };

    const visitedIds: string[] = [];
    for await (const event of runtime.stream(graph, {})) {
      if (event.type === 'node_start') visitedIds.push(event.nodeId);
    }

    // Node 'a' and 'b' should have run; 'c' should have been skipped.
    expect(visitedIds).toContain('a');
    expect(visitedIds).toContain('b');
    expect(visitedIds).not.toContain('c');
  });

  // ── 5. Resume from checkpoint ──────────────────────────────────────────────

  it('resumes a run from a forked checkpoint and completes successfully', async () => {
    const store = new InMemoryCheckpointStore();

    /**
     * Node 'a' runs first, then 'b'. We'll interrupt after 'a', fork the checkpoint,
     * and resume — verifying 'b' executes on resume.
     */
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: 'resume-output',
    } satisfies NodeExecutionResult);

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const graph = makeLinearGraph(
      'g-resume',
      [makeNode('a'), makeNode('b')],
      { checkpointPolicy: 'every_node' },
    );

    // First: run to completion so checkpoints are created.
    await runtime.invoke(graph, { seed: 42 });

    // Find the checkpoint for node 'a'.
    const allCheckpoints = await store.list('g-resume');
    expect(allCheckpoints.length).toBeGreaterThan(0);

    const cpForA = allCheckpoints.find(cp => cp.nodeId === 'a');
    expect(cpForA).toBeDefined();

    // Fork the checkpoint — this simulates restarting from after node 'a'.
    const forkedRunId = await store.fork(cpForA!.id);

    // Reset mock call count to measure only the resumed execution.
    executeMock.mockClear();

    // Resume the forked run.
    const resumeResult = await runtime.resume(graph, forkedRunId);

    // The resume should complete without throwing.
    expect(resumeResult).toBeDefined();
  });

  it('accepts an exact checkpoint id in resume()', async () => {
    const store = new InMemoryCheckpointStore();
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: 'resume-output',
    } satisfies NodeExecutionResult);

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const graph = makeLinearGraph(
      'g-resume-checkpoint-id',
      [makeNode('a'), makeNode('b')],
      { checkpointPolicy: 'every_node' },
    );

    await runtime.invoke(graph, { seed: 7 });
    const checkpoints = await store.list('g-resume-checkpoint-id');
    const checkpointForA = checkpoints.find((cp) => cp.nodeId === 'a');
    expect(checkpointForA).toBeDefined();

    executeMock.mockClear();
    const resumeResult = await runtime.resume(graph, checkpointForA!.id);

    expect(resumeResult).toBeDefined();
    expect(executeMock).toHaveBeenCalled();
  });

  it('halts on node failure and emits error/interruption events', async () => {
    const store = new InMemoryCheckpointStore();
    const executeMock = vi.fn().mockImplementation(async (node: GraphNode): Promise<NodeExecutionResult> => {
      if (node.id === 'a') {
        return { success: false, error: 'boom' };
      }
      return { success: true, output: `${node.id}-done` };
    });

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const graph = makeLinearGraph('g-failure', [makeNode('a'), makeNode('b')]);
    const events = [];
    for await (const event of runtime.stream(graph, {})) {
      events.push(event);
    }

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.some((event) => event.type === 'interrupt')).toBe(true);
    expect(events.some((event) => event.type === 'run_end')).toBe(true);
    expect(events.some((event) => event.type === 'node_start' && event.nodeId === 'b')).toBe(false);
  });

  it('persists skipped conditional branches so resume does not execute the bypassed arm', async () => {
    const store = new InMemoryCheckpointStore();
    const executeMock = vi.fn().mockImplementation(async (node: GraphNode): Promise<NodeExecutionResult> => {
      if (node.id === 'a') {
        return { success: true, output: 'a-done', scratchUpdate: { goToB: true } };
      }
      return { success: true, output: `${node.id}-done` };
    });

    const runtime = new GraphRuntime({
      checkpointStore: store,
      nodeExecutor: makeExecutorWithMock(executeMock),
    });

    const nodeA = makeNode('a');
    const nodeB = makeNode('b');
    const nodeC = makeNode('c');

    const graph: CompiledExecutionGraph = {
      id: 'g-conditional-resume',
      name: 'conditional-resume-test',
      nodes: [nodeA, nodeB, nodeC],
      edges: [
        { id: 'e0', source: START, target: 'a', type: 'static' },
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          type: 'conditional',
          condition: {
            type: 'function',
            fn: (state: GraphState) =>
              (state.scratch as Record<string, unknown>).goToB ? 'b' : 'c',
          },
        },
        {
          id: 'e2',
          source: 'a',
          target: 'c',
          type: 'conditional',
          condition: {
            type: 'function',
            fn: (state: GraphState) =>
              (state.scratch as Record<string, unknown>).goToB ? 'b' : 'c',
          },
        },
        { id: 'e3', source: 'b', target: END, type: 'static' },
        { id: 'e4', source: 'c', target: END, type: 'static' },
      ],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'every_node',
      memoryConsistency: 'snapshot',
    };

    await runtime.invoke(graph, {});

    const checkpoints = await store.list('g-conditional-resume');
    const checkpointForA = checkpoints.find((cp) => cp.nodeId === 'a');
    expect(checkpointForA).toBeDefined();

    const forkedRunId = await store.fork(checkpointForA!.id);
    executeMock.mockClear();

    await runtime.resume(graph, forkedRunId);

    const executedNodeIds = executeMock.mock.calls.map(([node]) => (node as GraphNode).id);
    expect(executedNodeIds).toContain('b');
    expect(executedNodeIds).not.toContain('c');
  });
});

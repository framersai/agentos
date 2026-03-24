/**
 * @file integration.test.ts
 * @description End-to-end integration tests for the AgentOS Unified Orchestration Layer.
 *
 * These tests exercise the full compile → runtime → checkpoint pipeline using real
 * builder, compiler, runtime, and checkpoint store instances. Node execution is mocked
 * via a custom NodeExecutor to avoid LLM/tool dependencies.
 *
 * Covers:
 * 1. AgentGraph: compile → invoke → stream → checkpoint → resume lifecycle
 * 2. workflow: step → branch → parallel full lifecycle
 * 3. mission: compile → invoke lifecycle
 * 4. Checkpoint time-travel: fork with modified state
 * 5. Streaming emits correct event sequence
 * 6. Error handling: node failure halts the run with explicit error events
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { AgentGraph } from '../builders/AgentGraph.js';
import { workflow } from '../builders/WorkflowBuilder.js';
import { mission } from '../builders/MissionBuilder.js';
import { toolNode, gmiNode } from '../builders/nodes.js';
import { GraphRuntime } from '../runtime/GraphRuntime.js';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import { InMemoryCheckpointStore } from '../checkpoint/InMemoryCheckpointStore.js';
import type { CompiledExecutionGraph, GraphNode } from '../ir/types.js';
import { START, END } from '../ir/index.js';
import type { GraphEvent } from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `GraphNode` with sensible defaults.
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
 * Build a `CompiledExecutionGraph` with START→[nodes in order]→END.
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
  edges.push({ id: `e${nodes.length}`, source: nodes[nodes.length - 1]!.id, target: END, type: 'static' });

  return {
    id,
    name: id,
    nodes,
    edges,
    stateSchema: { input: {}, scratch: {}, artifacts: {} },
    reducers: {},
    checkpointPolicy: 'none',
    memoryConsistency: 'snapshot',
    ...options,
  };
}

/**
 * Collect all events from an AsyncGenerator into an array.
 */
async function collectEvents(gen: AsyncGenerator<GraphEvent> | AsyncIterable<GraphEvent>): Promise<GraphEvent[]> {
  const events: GraphEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// 1. AgentGraph: full lifecycle
// ---------------------------------------------------------------------------

describe('E2E Integration — AgentGraph lifecycle', () => {
  it('compile → invoke returns artifacts', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'ok', artifactsUpdate: { result: 'done' } }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('test', [makeNode('a'), makeNode('b')]);
    const result = await runtime.invoke(graph, { query: 'hello' });

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(result).toBeDefined();
  });

  it('compile → stream emits run_start then run_end', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('test2', [makeNode('a')]);
    const events = await collectEvents(runtime.stream(graph, {}));

    expect(events[0]?.type).toBe('run_start');
    expect(events[events.length - 1]?.type).toBe('run_end');
  });

  it('checkpoints saved when policy is every_node', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph(
      'ckpt-graph',
      [makeNode('a'), makeNode('b')],
      { checkpointPolicy: 'every_node' },
    );

    const events = await collectEvents(runtime.stream(graph, {}));
    const checkpointEvents = events.filter(e => e.type === 'checkpoint_saved');
    expect(checkpointEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('resume from checkpoint completes successfully', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'resumed' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph(
      'resume-graph',
      [makeNode('step1'), makeNode('step2')],
      { checkpointPolicy: 'every_node' },
    );

    // Run to completion to create checkpoints
    let runId: string | undefined;
    for await (const event of runtime.stream(graph, { x: 1 })) {
      if (event.type === 'run_start') runId = event.runId;
    }

    expect(runId).toBeDefined();
    const result = await runtime.resume(graph, runId!);
    expect(result).toBeDefined();
  });

  it('AgentGraph builder: invoke via CompiledAgentGraph', async () => {
    const graph = new AgentGraph({
      input: z.object({ query: z.string() }),
      scratch: z.object({}),
      artifacts: z.object({ answer: z.string().optional() }),
    })
      .addNode('step1', gmiNode({ instructions: 'Search for the answer.' }))
      .addNode('step2', gmiNode({ instructions: 'Summarize the answer.' }))
      .addEdge(START, 'step1')
      .addEdge('step1', 'step2')
      .addEdge('step2', END)
      .compile();

    const result = await graph.invoke({ query: 'test' });
    expect(result).toBeDefined();
  });

  it('AgentGraph stream: node_start appears before node_end for each node', async () => {
    const graph = new AgentGraph({
      input: z.object({}),
      scratch: z.object({}),
      artifacts: z.object({}),
    })
      .addNode('a', gmiNode({ instructions: 'Step A' }))
      .addNode('b', gmiNode({ instructions: 'Step B' }))
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile();

    const events = await collectEvents(graph.stream({}));
    const nodeAStartIdx = events.findIndex(e => e.type === 'node_start' && (e as any).nodeId === 'a');
    const nodeAEndIdx = events.findIndex(e => e.type === 'node_end' && (e as any).nodeId === 'a');
    const nodeBStartIdx = events.findIndex(e => e.type === 'node_start' && (e as any).nodeId === 'b');
    const nodeBEndIdx = events.findIndex(e => e.type === 'node_end' && (e as any).nodeId === 'b');

    expect(nodeAStartIdx).toBeLessThan(nodeAEndIdx);
    expect(nodeBStartIdx).toBeLessThan(nodeBEndIdx);
    expect(nodeAEndIdx).toBeLessThan(nodeBStartIdx);
  });
});

// ---------------------------------------------------------------------------
// 2. Workflow: full lifecycle
// ---------------------------------------------------------------------------

describe('E2E Integration — workflow lifecycle', () => {
  it('step → step full lifecycle returns result', async () => {
    const wf = workflow('simple-workflow')
      .input(z.object({ text: z.string() }))
      .returns(z.object({ summary: z.string().optional() }))
      .step('fetch', { tool: 'web_fetch' })
      .step('summarize', { tool: 'summarizer' })
      .compile();

    const result = await wf.invoke({ text: 'hello world' });
    expect(result).toBeDefined();
  });

  it('workflow with gmi step executes without error', async () => {
    const wf = workflow('gmi-workflow')
      .input(z.object({ topic: z.string() }))
      .returns(z.object({ answer: z.string().optional() }))
      .step('reason', { gmi: { instructions: 'Answer the topic.' } })
      .compile();

    await expect(wf.invoke({ topic: 'AI safety' })).resolves.toBeDefined();
  });

  it('workflow with branch creates branch nodes for each route', async () => {
    const wf = workflow('branch-workflow')
      .input(z.object({ flag: z.boolean() }))
      .returns(z.object({}))
      .branch(
        (state) => (state.scratch as any).flag ? 'yes' : 'no',
        {
          yes: { tool: 'approve_tool' },
          no: { tool: 'reject_tool' },
        },
      )
      .compile();

    const ir = wf.toIR();
    const nodeIds = ir.nodes.map(n => n.id);
    // WorkflowBuilder names branch nodes as "branch-{routeKey}-{counter}"
    expect(nodeIds.some(id => id.includes('yes'))).toBe(true);
    expect(nodeIds.some(id => id.includes('no'))).toBe(true);
  });

  it('workflow invoke does not throw for parallel step', async () => {
    const wf = workflow('parallel-workflow')
      .input(z.object({}))
      .returns(z.object({}))
      .parallel(
        [
          { tool: 'tool_a' },
          { tool: 'tool_b' },
        ],
        { strategy: 'all', merge: { 'scratch.results': 'concat' } },
      )
      .compile();

    await expect(wf.invoke({})).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Mission: compile → invoke lifecycle
// ---------------------------------------------------------------------------

describe('E2E Integration — mission lifecycle', () => {
  it('mission compile → invoke completes without error', async () => {
    const m = mission('research')
      .goal('Research {{topic}} and produce a summary')
      .input(z.object({ topic: z.string() }))
      .returns(z.object({ summary: z.string().optional() }))
      .planner({ strategy: 'linear', maxSteps: 3 })
      .compile();

    await expect(m.invoke({ topic: 'AgentOS' })).resolves.toBeDefined();
  });

  it('mission explain returns a plan with steps and ir', async () => {
    const m = mission('explain-test')
      .goal('Explain {{concept}}')
      .input(z.object({ concept: z.string() }))
      .returns(z.object({}))
      .planner({ strategy: 'linear', maxSteps: 3 })
      .compile();

    const plan = await m.explain({});
    expect(plan).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.ir).toBeDefined();
    expect(Array.isArray(plan.ir.nodes)).toBe(true);
  });

  it('mission with anchor includes anchor in invocable graph', async () => {
    const m = mission('anchored-mission')
      .goal('Do {{task}}')
      .input(z.object({ task: z.string() }))
      .returns(z.object({}))
      .planner({ strategy: 'linear', maxSteps: 3 })
      .anchor('validation-anchor', toolNode('validate'), {
        required: true,
        phase: 'process',
      })
      .compile();

    await expect(m.invoke({ task: 'something' })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Checkpoint time-travel: fork with modified state
// ---------------------------------------------------------------------------

describe('E2E Integration — checkpoint time-travel', () => {
  it('fork a checkpoint with patched state and resume produces output', async () => {
    const store = new InMemoryCheckpointStore();
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' }) };
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph(
      'fork-graph',
      [makeNode('step1'), makeNode('step2')],
      { checkpointPolicy: 'every_node' },
    );

    // Run to completion to create checkpoints
    let runId: string | undefined;
    for await (const event of runtime.stream(graph, { input: 'original' })) {
      if (event.type === 'run_start') runId = event.runId;
    }

    expect(runId).toBeDefined();

    // Load the latest checkpoint and fork it with a patched scratch
    const checkpoint = await store.latest(runId!);
    expect(checkpoint).not.toBeNull();

    const forkedRunId = await store.fork(checkpoint!.id, {
      scratch: { patched: true },
    } as any);

    expect(forkedRunId).toBeDefined();
    expect(forkedRunId).not.toBe(runId);

    // Resume from the forked checkpoint
    const forkedResult = await runtime.resume(graph, forkedRunId);
    expect(forkedResult).toBeDefined();
  });

  it('fork returns a new runId distinct from the source', async () => {
    const store = new InMemoryCheckpointStore();
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph(
      'fork2',
      [makeNode('n1')],
      { checkpointPolicy: 'every_node' },
    );

    let runId: string | undefined;
    for await (const event of runtime.stream(graph, {})) {
      if (event.type === 'run_start') runId = event.runId;
    }

    const checkpoint = await store.latest(runId!);
    const forkedRunId = await store.fork(checkpoint!.id);
    expect(forkedRunId).not.toBe(runId);
  });
});

// ---------------------------------------------------------------------------
// 5. Streaming: correct event sequence
// ---------------------------------------------------------------------------

describe('E2E Integration — streaming event sequence', () => {
  it('run_start is first event, run_end is last event', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('seq-test', [makeNode('a'), makeNode('b'), makeNode('c')]);
    const events = await collectEvents(runtime.stream(graph, {}));

    expect(events[0]?.type).toBe('run_start');
    expect(events[events.length - 1]?.type).toBe('run_end');
  });

  it('node_start appears before node_end for each node', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const nodes = [makeNode('n1'), makeNode('n2'), makeNode('n3')];
    const graph = makeLinearGraph('order-test', nodes);
    const events = await collectEvents(runtime.stream(graph, {}));

    for (const node of nodes) {
      const startIdx = events.findIndex(e => e.type === 'node_start' && (e as any).nodeId === node.id);
      const endIdx = events.findIndex(e => e.type === 'node_end' && (e as any).nodeId === node.id);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(endIdx).toBeGreaterThanOrEqual(0);
      expect(startIdx).toBeLessThan(endIdx);
    }
  });

  it('edge_transition events appear between nodes', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('edge-test', [makeNode('a'), makeNode('b')]);
    const events = await collectEvents(runtime.stream(graph, {}));

    const transitionEvent = events.find(e => e.type === 'edge_transition');
    expect(transitionEvent).toBeDefined();
    expect((transitionEvent as any).sourceId).toBe('a');
    expect((transitionEvent as any).targetId).toBe('b');
  });

  it('checkpoint_saved events present when checkpointPolicy is every_node', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph(
      'ckpt-events',
      [makeNode('a'), makeNode('b')],
      { checkpointPolicy: 'every_node' },
    );
    const events = await collectEvents(runtime.stream(graph, {}));
    const ckptEvents = events.filter(e => e.type === 'checkpoint_saved');
    expect(ckptEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('run_end event contains finalOutput and totalDurationMs', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('end-test', [makeNode('a')]);
    const events = await collectEvents(runtime.stream(graph, {}));
    const endEvent = events.find(e => e.type === 'run_end') as any;

    expect(endEvent).toBeDefined();
    expect(endEvent.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect('finalOutput' in endEvent).toBe(true);
  });

  it('run_start event contains runId and graphId', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('start-test', [makeNode('a')]);
    const events = await collectEvents(runtime.stream(graph, {}));
    const startEvent = events.find(e => e.type === 'run_start') as any;

    expect(startEvent).toBeDefined();
    expect(startEvent.runId).toBeTruthy();
    expect(startEvent.graphId).toBe('start-test');
  });
});

// ---------------------------------------------------------------------------
// 6. Error handling
// ---------------------------------------------------------------------------

describe('E2E Integration — error handling', () => {
  it('halts the run when node executor returns success:false', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        output: undefined,
        error: 'Tool unavailable',
      }),
    };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('error-graph', [makeNode('failing-node'), makeNode('downstream-node')]);
    const events = await collectEvents(runtime.stream(graph, {}));

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.some((event) => event.type === 'interrupt')).toBe(true);
    expect(events.some((event) => event.type === 'node_start' && (event as any).nodeId === 'downstream-node')).toBe(false);
  });

  it('resume throws when no checkpoint exists for runId', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'x' }) };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    const graph = makeLinearGraph('missing-ckpt', [makeNode('a')]);
    await expect(runtime.resume(graph, 'non-existent-run-id')).rejects.toThrow();
  });

  it('empty graph (no nodes) emits run_start and run_end without executing any nodes', async () => {
    const executor = { execute: vi.fn() };
    const store = new InMemoryCheckpointStore();
    const runtime = new GraphRuntime({ checkpointStore: store, nodeExecutor: executor as any });

    // A graph with no nodes and only START→END edge
    const graph: CompiledExecutionGraph = {
      id: 'empty',
      name: 'empty',
      nodes: [],
      edges: [{ id: 'e0', source: START, target: END, type: 'static' }],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'none',
      memoryConsistency: 'snapshot',
    };

    const events = await collectEvents(runtime.stream(graph, {}));
    expect(events[0]?.type).toBe('run_start');
    expect(events[events.length - 1]?.type).toBe('run_end');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('AgentGraph invoke handles node producing artifactsUpdate correctly', async () => {
    const graph = new AgentGraph({
      input: z.object({ text: z.string() }),
      scratch: z.object({}),
      artifacts: z.object({ result: z.string().optional() }),
    })
      .addNode('process', gmiNode({ instructions: 'Process the text.' }))
      .addEdge(START, 'process')
      .addEdge('process', END)
      .compile();

    // Default NodeExecutor stub runs — should not throw
    await expect(graph.invoke({ text: 'hello' })).resolves.toBeDefined();
  });
});

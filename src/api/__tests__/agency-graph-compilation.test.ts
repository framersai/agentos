/**
 * @file agency-graph-compilation.test.ts
 * Tests for the agency-to-graph compilation bridge and the agent graph builder.
 *
 * Verifies that each agency strategy (sequential, parallel, debate,
 * review-loop, hierarchical) compiles into the correct CompiledExecutionGraph
 * topology, and that the agentGraph() builder produces correct IR.
 *
 * Also tests parallel node execution in GraphRuntime by constructing
 * fan-out graphs and verifying concurrent dispatch.
 */

import { describe, expect, it, vi } from 'vitest';
import { START, END } from '../../orchestration/ir/types.js';
import type {
  CompiledExecutionGraph,
  GraphNode,
  GraphEdge,
  GraphState,
} from '../../orchestration/ir/types.js';
import {
  compileAgencyToGraph,
  mapGraphResultToAgencyResult,
  mapGraphEventToAgencyEvent,
} from '../strategies/graphCompiler.js';
import { agentGraph, AgentGraphBuilder } from '../strategies/agentGraphBuilder.js';
import type { AgencyOptions, BaseAgentConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal AgencyOptions config for testing.
 * The model/provider are set to avoid validation errors in strategies
 * that require an agency-level model (parallel, debate).
 */
function makeConfig(
  overrides: Partial<AgencyOptions> & { agents: AgencyOptions['agents'] }
): AgencyOptions {
  return {
    model: 'test:mock',
    ...overrides,
  };
}

/**
 * Counts edges from a given source node in the compiled graph.
 */
function edgesFrom(graph: CompiledExecutionGraph, source: string): GraphEdge[] {
  return graph.edges.filter((e) => e.source === source);
}

/**
 * Counts edges to a given target node in the compiled graph.
 */
function edgesTo(graph: CompiledExecutionGraph, target: string): GraphEdge[] {
  return graph.edges.filter((e) => e.target === target);
}

/**
 * Returns all node IDs in the graph (excluding START/END sentinels).
 */
function nodeIds(graph: CompiledExecutionGraph): string[] {
  return graph.nodes.map((n) => n.id);
}

// ---------------------------------------------------------------------------
// compileAgencyToGraph — strategy compilation tests
// ---------------------------------------------------------------------------

describe('compileAgencyToGraph', () => {
  describe('sequential strategy', () => {
    it('compiles to a linear chain of GMI nodes', () => {
      const config = makeConfig({
        strategy: 'sequential',
        agents: {
          researcher: { instructions: 'Find info.' },
          writer: { instructions: 'Write summary.' },
          reviewer: { instructions: 'Review output.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Test prompt');

      // Should have 3 agent nodes.
      expect(graph.nodes).toHaveLength(3);
      expect(nodeIds(graph)).toContain('agent_researcher');
      expect(nodeIds(graph)).toContain('agent_writer');
      expect(nodeIds(graph)).toContain('agent_reviewer');

      // All nodes should be GMI type.
      for (const node of graph.nodes) {
        expect(node.type).toBe('gmi');
        expect(node.executorConfig.type).toBe('gmi');
      }

      // Should have linear chain: START -> researcher -> writer -> reviewer -> END.
      expect(edgesFrom(graph, START)).toHaveLength(1);
      expect(edgesFrom(graph, START)[0].target).toBe('agent_researcher');

      expect(edgesFrom(graph, 'agent_researcher')).toHaveLength(1);
      expect(edgesFrom(graph, 'agent_researcher')[0].target).toBe('agent_writer');

      expect(edgesFrom(graph, 'agent_writer')).toHaveLength(1);
      expect(edgesFrom(graph, 'agent_writer')[0].target).toBe('agent_reviewer');

      expect(edgesFrom(graph, 'agent_reviewer')).toHaveLength(1);
      expect(edgesFrom(graph, 'agent_reviewer')[0].target).toBe(END);
    });

    it('includes proper state reducers for output keys', () => {
      const config = makeConfig({
        strategy: 'sequential',
        agents: {
          a: { instructions: 'Do A.' },
          b: { instructions: 'Do B.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Prompt');

      expect(graph.reducers['scratch.output_a']).toBe('last');
      expect(graph.reducers['scratch.output_b']).toBe('last');
    });

    it('sets graph metadata correctly', () => {
      const config = makeConfig({
        strategy: 'sequential',
        agents: { a: { instructions: 'Go.' } },
      });

      const graph = compileAgencyToGraph(config, 'Prompt');

      expect(graph.name).toBe('Agency (sequential)');
      expect(graph.id).toMatch(/^agency-sequential-/);
      expect(graph.checkpointPolicy).toBe('explicit');
      expect(graph.memoryConsistency).toBe('live');
    });
  });

  describe('parallel strategy', () => {
    it('compiles to fan-out/fan-in with synthesizer', () => {
      const config = makeConfig({
        strategy: 'parallel',
        agents: {
          factChecker: { instructions: 'Check facts.' },
          writer: { instructions: 'Write content.' },
          designer: { instructions: 'Design layout.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Test prompt');

      // 3 agent nodes + 1 synthesizer = 4 nodes.
      expect(graph.nodes).toHaveLength(4);
      expect(nodeIds(graph)).toContain('agent_factChecker');
      expect(nodeIds(graph)).toContain('agent_writer');
      expect(nodeIds(graph)).toContain('agent_designer');
      expect(nodeIds(graph)).toContain('synthesizer');

      // START should fan out to all 3 agents.
      const startEdges = edgesFrom(graph, START);
      expect(startEdges).toHaveLength(3);
      const startTargets = startEdges.map((e) => e.target).sort();
      expect(startTargets).toEqual(['agent_designer', 'agent_factChecker', 'agent_writer']);

      // All 3 agents should connect to the synthesizer.
      const synthInEdges = edgesTo(graph, 'synthesizer');
      expect(synthInEdges).toHaveLength(3);

      // Synthesizer should connect to END.
      const synthOutEdges = edgesFrom(graph, 'synthesizer');
      expect(synthOutEdges).toHaveLength(1);
      expect(synthOutEdges[0].target).toBe(END);
    });

    it('includes concat reducer for agentOutputs', () => {
      const config = makeConfig({
        strategy: 'parallel',
        agents: {
          a: { instructions: 'Go.' },
          b: { instructions: 'Go.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Prompt');

      expect(graph.reducers['scratch.agentOutputs']).toBe('concat');
    });
  });

  describe('debate strategy', () => {
    it('compiles to round-based chain with synthesizer', () => {
      const config = makeConfig({
        strategy: 'debate',
        maxRounds: 2,
        agents: {
          optimist: { instructions: 'Argue positively.' },
          pessimist: { instructions: 'Argue risks.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Test prompt');

      // 2 agents x 2 rounds = 4 debate nodes + 1 synthesizer = 5.
      expect(graph.nodes).toHaveLength(5);

      // Check round-based node IDs exist.
      expect(nodeIds(graph)).toContain('agent_optimist_r0');
      expect(nodeIds(graph)).toContain('agent_pessimist_r0');
      expect(nodeIds(graph)).toContain('agent_optimist_r1');
      expect(nodeIds(graph)).toContain('agent_pessimist_r1');
      expect(nodeIds(graph)).toContain('synthesizer');

      // Chain: START -> optimist_r0 -> pessimist_r0 -> optimist_r1 -> pessimist_r1 -> synthesizer -> END
      expect(edgesFrom(graph, START)[0].target).toBe('agent_optimist_r0');
      expect(edgesFrom(graph, 'agent_optimist_r0')[0].target).toBe('agent_pessimist_r0');
      expect(edgesFrom(graph, 'agent_pessimist_r0')[0].target).toBe('agent_optimist_r1');
      expect(edgesFrom(graph, 'agent_optimist_r1')[0].target).toBe('agent_pessimist_r1');
      expect(edgesFrom(graph, 'agent_pessimist_r1')[0].target).toBe('synthesizer');
      expect(edgesFrom(graph, 'synthesizer')[0].target).toBe(END);

      // Debate history uses concat reducer.
      expect(graph.reducers['scratch.debateHistory']).toBe('concat');
    });

    it('defaults to 3 rounds when maxRounds is not specified', () => {
      const config = makeConfig({
        strategy: 'debate',
        agents: {
          a: { instructions: 'Go.' },
          b: { instructions: 'Go.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Prompt');

      // 2 agents x 3 rounds = 6 debate nodes + 1 synthesizer = 7.
      expect(graph.nodes).toHaveLength(7);
    });
  });

  describe('review-loop strategy', () => {
    it('compiles with conditional back-edge for revision', () => {
      const config = makeConfig({
        strategy: 'review-loop',
        maxRounds: 3,
        agents: {
          writer: { instructions: 'Write a draft.' },
          editor: { instructions: 'Review the draft.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Test prompt');

      // Producer + reviewer + router = 3 nodes.
      expect(graph.nodes).toHaveLength(3);
      expect(nodeIds(graph)).toContain('agent_writer');
      expect(nodeIds(graph)).toContain('agent_editor');
      expect(nodeIds(graph)).toContain('review_router');

      // The router node should be a 'router' type.
      const routerNode = graph.nodes.find((n) => n.id === 'review_router');
      expect(routerNode?.type).toBe('router');
      expect(routerNode?.executorConfig.type).toBe('router');

      // START -> producer -> reviewer -> router
      expect(edgesFrom(graph, START)[0].target).toBe('agent_writer');
      expect(edgesFrom(graph, 'agent_writer')[0].target).toBe('agent_editor');
      expect(edgesFrom(graph, 'agent_editor')[0].target).toBe('review_router');

      // Router should have conditional edges: one to END, one back to producer.
      const routerEdges = edgesFrom(graph, 'review_router');
      expect(routerEdges).toHaveLength(2);

      const targets = routerEdges.map((e) => e.target).sort();
      expect(targets).toContain(END);
      expect(targets).toContain('agent_writer');

      // Both should be conditional edges.
      for (const edge of routerEdges) {
        expect(edge.type).toBe('conditional');
      }

      // Review state uses proper reducers.
      expect(graph.reducers['scratch.draft']).toBe('last');
      expect(graph.reducers['scratch.reviewApproved']).toBe('last');
      expect(graph.reducers['scratch.reviewFeedback']).toBe('last');
    });
  });

  describe('hierarchical strategy', () => {
    it('compiles to a single manager node', () => {
      const config = makeConfig({
        strategy: 'hierarchical',
        agents: {
          researcher: { instructions: 'Find sources.' },
          writer: { instructions: 'Write content.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Test prompt');

      // Single manager node.
      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0].id).toBe('manager');
      expect(graph.nodes[0].executionMode).toBe('react_bounded');

      // START -> manager -> END
      expect(edgesFrom(graph, START)).toHaveLength(1);
      expect(edgesFrom(graph, START)[0].target).toBe('manager');
      expect(edgesFrom(graph, 'manager')).toHaveLength(1);
      expect(edgesFrom(graph, 'manager')[0].target).toBe(END);

      // Manager instructions should mention the team roster.
      const managerConfig = graph.nodes[0].executorConfig;
      if (managerConfig.type === 'gmi') {
        expect(managerConfig.instructions).toContain('delegate_to_researcher');
        expect(managerConfig.instructions).toContain('delegate_to_writer');
      }
    });
  });

  describe('defaults', () => {
    it('defaults to sequential when no strategy specified', () => {
      const config = makeConfig({
        agents: {
          a: { instructions: 'A.' },
          b: { instructions: 'B.' },
        },
      });

      const graph = compileAgencyToGraph(config, 'Prompt');

      // Sequential: START -> a -> b -> END = 2 nodes
      expect(graph.nodes).toHaveLength(2);
      expect(graph.name).toBe('Agency (sequential)');
    });
  });
});

// ---------------------------------------------------------------------------
// mapGraphResultToAgencyResult
// ---------------------------------------------------------------------------

describe('mapGraphResultToAgencyResult', () => {
  it('extracts text from finalOutput', () => {
    const result = mapGraphResultToAgencyResult(
      { finalOutput: 'Hello world' },
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(result.text).toBe('Hello world');
    expect(result.agentCalls).toEqual([]);
  });

  it('falls back to draft field', () => {
    const result = mapGraphResultToAgencyResult(
      { draft: 'A draft' },
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(result.text).toBe('A draft');
  });

  it('returns empty string when no text found', () => {
    const result = mapGraphResultToAgencyResult(
      {},
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(result.text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mapGraphEventToAgencyEvent
// ---------------------------------------------------------------------------

describe('mapGraphEventToAgencyEvent', () => {
  it('maps node_start to agent-start', () => {
    const event = mapGraphEventToAgencyEvent(
      { type: 'node_start', nodeId: 'agent_writer', state: {} },
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(event).toEqual({
      type: 'agent-start',
      agent: 'agent_writer',
      input: '',
    });
  });

  it('maps node_end to agent-end', () => {
    const event = mapGraphEventToAgencyEvent(
      { type: 'node_end', nodeId: 'agent_writer', output: 'Done', durationMs: 42 },
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(event).toEqual({
      type: 'agent-end',
      agent: 'agent_writer',
      output: 'Done',
      durationMs: 42,
    });
  });

  it('maps text_delta to text', () => {
    const event = mapGraphEventToAgencyEvent(
      { type: 'text_delta', nodeId: 'agent_writer', content: 'chunk' },
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(event).toEqual({
      type: 'text',
      text: 'chunk',
      agent: 'agent_writer',
    });
  });

  it('returns null for unknown events', () => {
    const event = mapGraphEventToAgencyEvent(
      { type: 'checkpoint_saved', checkpointId: '123', nodeId: 'x' },
      makeConfig({ agents: { a: { instructions: 'Go.' } } })
    );

    expect(event).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// agentGraph() builder
// ---------------------------------------------------------------------------

describe('agentGraph builder', () => {
  it('creates a simple linear graph', () => {
    const graph = agentGraph()
      .agent('a', { instructions: 'Do A' })
      .agent('b', { instructions: 'Do B', dependsOn: ['a'] })
      .agent('c', { instructions: 'Do C', dependsOn: ['b'] })
      .compile();

    expect(graph.nodes).toHaveLength(3);

    // a is a root: START -> a
    expect(edgesFrom(graph, START).map((e) => e.target)).toContain('agent_a');

    // a -> b
    const aEdges = edgesFrom(graph, 'agent_a');
    expect(aEdges.some((e) => e.target === 'agent_b')).toBe(true);

    // b -> c
    const bEdges = edgesFrom(graph, 'agent_b');
    expect(bEdges.some((e) => e.target === 'agent_c')).toBe(true);

    // c is a leaf: c -> END
    const cEdges = edgesFrom(graph, 'agent_c');
    expect(cEdges.some((e) => e.target === END)).toBe(true);
  });

  it('creates a diamond dependency graph', () => {
    const graph = agentGraph()
      .agent('researcher', { instructions: 'Research' })
      .agent('writer', { instructions: 'Write', dependsOn: ['researcher'] })
      .agent('illustrator', { instructions: 'Illustrate', dependsOn: ['researcher'] })
      .agent('reviewer', { instructions: 'Review', dependsOn: ['writer', 'illustrator'] })
      .compile();

    expect(graph.nodes).toHaveLength(4);

    // researcher is root: START -> researcher
    expect(edgesFrom(graph, START).map((e) => e.target)).toEqual(['agent_researcher']);

    // researcher -> writer and researcher -> illustrator
    const researcherEdges = edgesFrom(graph, 'agent_researcher');
    const researcherTargets = researcherEdges.map((e) => e.target).sort();
    expect(researcherTargets).toEqual(['agent_illustrator', 'agent_writer']);

    // writer -> reviewer and illustrator -> reviewer
    expect(
      edgesTo(graph, 'agent_reviewer')
        .map((e) => e.source)
        .sort()
    ).toEqual(['agent_illustrator', 'agent_writer']);

    // reviewer is leaf: reviewer -> END
    expect(edgesFrom(graph, 'agent_reviewer').some((e) => e.target === END)).toBe(true);
  });

  it('creates multiple root nodes for independent agents', () => {
    const graph = agentGraph()
      .agent('a', { instructions: 'A' })
      .agent('b', { instructions: 'B' })
      .agent('c', { instructions: 'C', dependsOn: ['a', 'b'] })
      .compile();

    // Both a and b are roots: START -> a and START -> b.
    const startTargets = edgesFrom(graph, START)
      .map((e) => e.target)
      .sort();
    expect(startTargets).toEqual(['agent_a', 'agent_b']);

    // c is the only leaf.
    expect(edgesFrom(graph, 'agent_c').some((e) => e.target === END)).toBe(true);
  });

  it('throws on duplicate agent names', () => {
    expect(() => {
      agentGraph().agent('a', { instructions: 'A' }).agent('a', { instructions: 'A again' });
    }).toThrow('already registered');
  });

  it('throws on unknown dependency', () => {
    expect(() => {
      agentGraph()
        .agent('a', { instructions: 'A', dependsOn: ['nonexistent'] })
        .compile();
    }).toThrow('not registered');
  });

  it('throws on cycle detection', () => {
    expect(() => {
      agentGraph()
        .agent('a', { instructions: 'A', dependsOn: ['b'] })
        .agent('b', { instructions: 'B', dependsOn: ['a'] })
        .compile();
    }).toThrow(/[Cc]ycle/);
  });

  it('throws on empty graph', () => {
    expect(() => {
      agentGraph().compile();
    }).toThrow('empty');
  });

  it('sets up proper reducers for each agent output', () => {
    const graph = agentGraph()
      .agent('a', { instructions: 'A' })
      .agent('b', { instructions: 'B', dependsOn: ['a'] })
      .compile();

    expect(graph.reducers['scratch.output_a']).toBe('last');
    expect(graph.reducers['scratch.output_b']).toBe('last');
    expect(graph.reducers['scratch.agentOutputs']).toBe('concat');
  });

  it('sets graph metadata correctly', () => {
    const graph = agentGraph().agent('a', { instructions: 'A' }).compile();

    expect(graph.name).toBe('Agent Graph');
    expect(graph.id).toMatch(/^agent-graph-/);
    expect(graph.checkpointPolicy).toBe('explicit');
    expect(graph.memoryConsistency).toBe('live');
    expect(graph.stateSchema.input).toBeDefined();
    expect(graph.stateSchema.scratch).toBeDefined();
    expect(graph.stateSchema.artifacts).toBeDefined();
  });

  it('supports react_bounded mode for agents with maxIterations > 1', () => {
    const graph = agentGraph().agent('a', { instructions: 'A', maxIterations: 5 }).compile();

    expect(graph.nodes[0].executionMode).toBe('react_bounded');
  });

  it('uses single_turn mode by default', () => {
    const graph = agentGraph().agent('a', { instructions: 'A' }).compile();

    expect(graph.nodes[0].executionMode).toBe('single_turn');
  });

  it('rejects sentinel names', () => {
    expect(() => {
      agentGraph().agent(START, { instructions: 'bad' });
    }).toThrow('reserved sentinel');

    expect(() => {
      agentGraph().agent(END, { instructions: 'bad' });
    }).toThrow('reserved sentinel');
  });
});

// ---------------------------------------------------------------------------
// Parallel execution in GraphRuntime
// ---------------------------------------------------------------------------

describe('parallel node execution via GraphRuntime', () => {
  it('executes fan-out nodes concurrently', async () => {
    // Import the real runtime components for this integration-level test.
    const { GraphRuntime } = await import('../../orchestration/runtime/GraphRuntime.js');
    const { NodeExecutor } = await import('../../orchestration/runtime/NodeExecutor.js');
    const { InMemoryCheckpointStore } = await import(
      '../../orchestration/checkpoint/InMemoryCheckpointStore.js'
    );

    // Track execution order to verify parallelism.
    const executionLog: string[] = [];

    // Mock executor that records when each node starts and completes.
    // All nodes succeed immediately.
    const mockExecutor = {
      async execute(node: GraphNode, _state: unknown) {
        executionLog.push(`start:${node.id}`);
        // Small async tick to allow parallel nodes to interleave.
        await new Promise((resolve) => setTimeout(resolve, 1));
        executionLog.push(`end:${node.id}`);
        return {
          success: true,
          output: `output-of-${node.id}`,
          scratchUpdate: { [`output_${node.id}`]: `output-of-${node.id}` },
        };
      },
    } as unknown as InstanceType<typeof NodeExecutor>;

    const runtime = new GraphRuntime({
      checkpointStore: new InMemoryCheckpointStore(),
      nodeExecutor: mockExecutor,
    });

    // Build a fan-out graph: START -> [a, b, c] -> d -> END
    // a, b, c should run in parallel; d waits for all three.
    const graph: CompiledExecutionGraph = {
      id: 'parallel-test',
      name: 'Parallel Test',
      nodes: [
        {
          id: 'a',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'A' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
        {
          id: 'b',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'B' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
        {
          id: 'c',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'C' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
        {
          id: 'd',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'D' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
      ],
      edges: [
        { id: 'e0', source: START, target: 'a', type: 'static' },
        { id: 'e1', source: START, target: 'b', type: 'static' },
        { id: 'e2', source: START, target: 'c', type: 'static' },
        { id: 'e3', source: 'a', target: 'd', type: 'static' },
        { id: 'e4', source: 'b', target: 'd', type: 'static' },
        { id: 'e5', source: 'c', target: 'd', type: 'static' },
        { id: 'e6', source: 'd', target: END, type: 'static' },
      ],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'none',
      memoryConsistency: 'live',
    };

    const result = await runtime.invoke(graph, { prompt: 'test' });

    // Verify all nodes executed.
    expect(executionLog).toContain('start:a');
    expect(executionLog).toContain('start:b');
    expect(executionLog).toContain('start:c');
    expect(executionLog).toContain('start:d');
    expect(executionLog).toContain('end:a');
    expect(executionLog).toContain('end:b');
    expect(executionLog).toContain('end:c');
    expect(executionLog).toContain('end:d');

    // Verify parallel nodes started before any of them ended.
    // In a truly parallel execution, all three starts appear before
    // any of the three ends (they interleave via Promise.all).
    const aStart = executionLog.indexOf('start:a');
    const bStart = executionLog.indexOf('start:b');
    const cStart = executionLog.indexOf('start:c');
    const aEnd = executionLog.indexOf('end:a');
    const bEnd = executionLog.indexOf('end:b');
    const cEnd = executionLog.indexOf('end:c');

    // All three should start before any of them finish, proving concurrency.
    expect(aStart).toBeLessThan(aEnd);
    expect(bStart).toBeLessThan(bEnd);
    expect(cStart).toBeLessThan(cEnd);

    // d must start after all parallel nodes finish.
    const dStart = executionLog.indexOf('start:d');
    expect(dStart).toBeGreaterThan(aEnd);
    expect(dStart).toBeGreaterThan(bEnd);
    expect(dStart).toBeGreaterThan(cEnd);
  });

  it('merges scratch from parallel branches using StateManager', async () => {
    const { GraphRuntime } = await import('../../orchestration/runtime/GraphRuntime.js');
    const { NodeExecutor } = await import('../../orchestration/runtime/NodeExecutor.js');
    const { InMemoryCheckpointStore } = await import(
      '../../orchestration/checkpoint/InMemoryCheckpointStore.js'
    );

    // Each parallel node writes to a different scratch key.
    const mockExecutor = {
      async execute(node: GraphNode, _state: unknown) {
        return {
          success: true,
          output: `result-${node.id}`,
          scratchUpdate: { [`key_${node.id}`]: `value_${node.id}` },
        };
      },
    } as unknown as InstanceType<typeof NodeExecutor>;

    const runtime = new GraphRuntime({
      checkpointStore: new InMemoryCheckpointStore(),
      nodeExecutor: mockExecutor,
    });

    // Fan-out: START -> [a, b] -> c -> END
    // c should see scratch keys from both a and b.
    const graph: CompiledExecutionGraph = {
      id: 'merge-test',
      name: 'Merge Test',
      nodes: [
        {
          id: 'a',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'A' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
        {
          id: 'b',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'B' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
        {
          id: 'c',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'C' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
      ],
      edges: [
        { id: 'e0', source: START, target: 'a', type: 'static' },
        { id: 'e1', source: START, target: 'b', type: 'static' },
        { id: 'e2', source: 'a', target: 'c', type: 'static' },
        { id: 'e3', source: 'b', target: 'c', type: 'static' },
        { id: 'e4', source: 'c', target: END, type: 'static' },
      ],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'none',
      memoryConsistency: 'live',
    };

    // Capture the state seen by node c to verify merge.
    let cScratch: Record<string, unknown> | undefined;
    const originalExecute = mockExecutor.execute;
    mockExecutor.execute = async (node: GraphNode, state: Partial<GraphState>) => {
      if (node.id === 'c') {
        cScratch = state.scratch as Record<string, unknown> | undefined;
      }
      return originalExecute(node, state);
    };

    await runtime.invoke(graph, { prompt: 'test' });

    // Node c should see both parallel branches' scratch updates.
    expect(cScratch?.key_a).toBe('value_a');
    expect(cScratch?.key_b).toBe('value_b');
  });

  it('streams correct events for parallel execution', async () => {
    const { GraphRuntime } = await import('../../orchestration/runtime/GraphRuntime.js');
    const { NodeExecutor } = await import('../../orchestration/runtime/NodeExecutor.js');
    const { InMemoryCheckpointStore } = await import(
      '../../orchestration/checkpoint/InMemoryCheckpointStore.js'
    );

    const mockExecutor = {
      async execute(node: GraphNode, _state: unknown) {
        return { success: true, output: `out-${node.id}` };
      },
    } as unknown as InstanceType<typeof NodeExecutor>;

    const runtime = new GraphRuntime({
      checkpointStore: new InMemoryCheckpointStore(),
      nodeExecutor: mockExecutor,
    });

    // Simple fan-out: START -> [a, b] -> END
    const graph: CompiledExecutionGraph = {
      id: 'stream-test',
      name: 'Stream Test',
      nodes: [
        {
          id: 'a',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'A' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
        {
          id: 'b',
          type: 'gmi',
          executorConfig: { type: 'gmi', instructions: 'B' },
          executionMode: 'single_turn',
          effectClass: 'pure',
          checkpoint: 'none',
        },
      ],
      edges: [
        { id: 'e0', source: START, target: 'a', type: 'static' },
        { id: 'e1', source: START, target: 'b', type: 'static' },
        { id: 'e2', source: 'a', target: END, type: 'static' },
        { id: 'e3', source: 'b', target: END, type: 'static' },
      ],
      stateSchema: { input: {}, scratch: {}, artifacts: {} },
      reducers: {},
      checkpointPolicy: 'none',
      memoryConsistency: 'live',
    };

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runtime.stream(graph, { prompt: 'test' })) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    // Should have run_start, node_start(a), node_end(a), node_start(b), node_end(b), run_end.
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('run_start');
    expect(types[types.length - 1]).toBe('run_end');

    // Both nodes should appear in the events.
    const nodeStarts = events.filter((e) => e.type === 'node_start').map((e) => e.nodeId);
    expect(nodeStarts).toContain('a');
    expect(nodeStarts).toContain('b');

    const nodeEnds = events.filter((e) => e.type === 'node_end').map((e) => e.nodeId);
    expect(nodeEnds).toContain('a');
    expect(nodeEnds).toContain('b');
  });
});

// ---------------------------------------------------------------------------
// Compiled graph structural invariants
// ---------------------------------------------------------------------------

describe('compiled graph structural invariants', () => {
  it('all edges reference valid node IDs or sentinels', () => {
    const config = makeConfig({
      strategy: 'parallel',
      agents: {
        a: { instructions: 'A.' },
        b: { instructions: 'B.' },
      },
    });

    const graph = compileAgencyToGraph(config, 'Prompt');
    const validIds = new Set([START, END, ...graph.nodes.map((n) => n.id)]);

    for (const edge of graph.edges) {
      expect(validIds.has(edge.source)).toBe(true);
      expect(validIds.has(edge.target)).toBe(true);
    }
  });

  it('all edge IDs are unique', () => {
    const config = makeConfig({
      strategy: 'debate',
      maxRounds: 2,
      agents: {
        a: { instructions: 'A.' },
        b: { instructions: 'B.' },
      },
    });

    const graph = compileAgencyToGraph(config, 'Prompt');
    const edgeIds = graph.edges.map((e) => e.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it('all node IDs are unique', () => {
    const config = makeConfig({
      strategy: 'debate',
      maxRounds: 2,
      agents: {
        a: { instructions: 'A.' },
        b: { instructions: 'B.' },
        c: { instructions: 'C.' },
      },
    });

    const graph = compileAgencyToGraph(config, 'Prompt');
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

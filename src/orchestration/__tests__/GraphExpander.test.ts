import { describe, it, expect } from 'vitest';
import { GraphExpander } from '../planning/GraphExpander.js';
import type { CompiledExecutionGraph, GraphNode, GraphEdge } from '../ir/types.js';
import type { GraphPatch } from '../planning/types.js';
import { DEFAULT_THRESHOLDS } from '../planning/types.js';

function makeNode(id: string): GraphNode {
  return {
    id,
    type: 'gmi',
    executorConfig: { type: 'gmi' as const, instructions: `Do ${id}` },
    executionMode: 'single_turn',
    effectClass: 'read',
    checkpoint: true,
  };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, type: 'static' };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): CompiledExecutionGraph {
  return {
    id: 'test',
    name: 'test',
    nodes,
    edges,
    stateSchema: { input: {}, scratch: {}, artifacts: {} },
    reducers: {},
    checkpointPolicy: 'every_node',
    memoryConsistency: 'live',
  };
}

describe('GraphExpander', () => {
  describe('applyPatch', () => {
    it('adds a node and edge', () => {
      const graph = makeGraph(
        [makeNode('a')],
        [makeEdge('e1', '__START__', 'a'), makeEdge('e2', 'a', '__END__')],
      );

      const patch: GraphPatch = {
        addNodes: [makeNode('b')],
        addEdges: [makeEdge('e3', 'a', 'b')],
        reason: 'Need agent B after A',
        estimatedCostDelta: 0.5,
        estimatedLatencyDelta: 30000,
      };

      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      const result = expander.applyPatch(graph, patch);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.find((n) => n.id === 'b')).toBeDefined();
      expect(result.edges.find((e) => e.source === 'a' && e.target === 'b')).toBeDefined();
    });

    it('removes a node and its edges', () => {
      const graph = makeGraph(
        [makeNode('a'), makeNode('b'), makeNode('c')],
        [
          makeEdge('e1', '__START__', 'a'),
          makeEdge('e2', 'a', 'b'),
          makeEdge('e3', 'b', 'c'),
          makeEdge('e4', 'c', '__END__'),
        ],
      );

      const patch: GraphPatch = {
        addNodes: [],
        addEdges: [],
        removeNodes: ['b'],
        reason: 'Node B is redundant',
        estimatedCostDelta: -0.3,
        estimatedLatencyDelta: -15000,
      };

      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      const result = expander.applyPatch(graph, patch);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.find((n) => n.id === 'b')).toBeUndefined();
      // Edges touching b should be removed
      expect(result.edges.find((e) => e.source === 'b' || e.target === 'b')).toBeUndefined();
    });

    it('rewires an edge', () => {
      const graph = makeGraph(
        [makeNode('a'), makeNode('b')],
        [
          makeEdge('e1', '__START__', 'a'),
          makeEdge('e2', 'a', '__END__'),
        ],
      );

      const patch: GraphPatch = {
        addNodes: [makeNode('b')],
        addEdges: [makeEdge('e3', 'b', '__END__')],
        rewireEdges: [{ from: 'a', to: '__END__', newTarget: 'b' }],
        reason: 'Insert B between A and END',
        estimatedCostDelta: 0.5,
        estimatedLatencyDelta: 30000,
      };

      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      const result = expander.applyPatch(graph, patch);

      // e2 should now point to b instead of __END__
      const rewired = result.edges.find((e) => e.id === 'e2');
      expect(rewired?.target).toBe('b');
      // New edge from b to __END__
      expect(result.edges.find((e) => e.source === 'b' && e.target === '__END__')).toBeDefined();
    });

    it('does not mutate the original graph', () => {
      const graph = makeGraph([makeNode('a')], [makeEdge('e1', '__START__', 'a')]);
      const patch: GraphPatch = {
        addNodes: [makeNode('b')],
        addEdges: [],
        reason: 'Test immutability',
        estimatedCostDelta: 0,
        estimatedLatencyDelta: 0,
      };

      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      expander.applyPatch(graph, patch);

      expect(graph.nodes).toHaveLength(1); // Original unchanged
    });
  });

  describe('shouldAutoApprove', () => {
    it('always approves in autonomous mode', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS, maxAgentCount: 1 });
      const approved = expander.shouldAutoApprove('autonomous', {
        currentCost: 999,
        currentAgentCount: 999,
        currentExpansions: 999,
        currentToolForges: 999,
        patchCostDelta: 999,
        patchAgentDelta: 999,
      });
      expect(approved).toBe(true);
    });

    it('never auto-approves in guided mode', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      const approved = expander.shouldAutoApprove('guided', {
        currentCost: 0,
        currentAgentCount: 0,
        currentExpansions: 0,
        currentToolForges: 0,
        patchCostDelta: 0.01,
        patchAgentDelta: 1,
      });
      expect(approved).toBe(false);
    });

    it('approves in guardrailed mode when below thresholds', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      const approved = expander.shouldAutoApprove('guardrailed', {
        currentCost: 1.0,
        currentAgentCount: 3,
        currentExpansions: 2,
        currentToolForges: 0,
        patchCostDelta: 0.5,
        patchAgentDelta: 1,
      });
      expect(approved).toBe(true);
    });

    it('blocks in guardrailed mode when cost cap exceeded', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS, maxTotalCost: 5.0 });
      const approved = expander.shouldAutoApprove('guardrailed', {
        currentCost: 4.8,
        currentAgentCount: 3,
        currentExpansions: 0,
        currentToolForges: 0,
        patchCostDelta: 0.5,
        patchAgentDelta: 1,
      });
      expect(approved).toBe(false);
    });

    it('blocks in guardrailed mode when agent count exceeded', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS, maxAgentCount: 5 });
      const approved = expander.shouldAutoApprove('guardrailed', {
        currentCost: 1.0,
        currentAgentCount: 5,
        currentExpansions: 0,
        currentToolForges: 0,
        patchCostDelta: 0.5,
        patchAgentDelta: 1,
      });
      expect(approved).toBe(false);
    });
  });

  describe('getExceededThreshold', () => {
    it('returns null when no threshold exceeded', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS });
      const result = expander.getExceededThreshold({
        currentCost: 1.0,
        currentAgentCount: 3,
        currentExpansions: 0,
        currentToolForges: 0,
        patchCostDelta: 0.5,
        patchAgentDelta: 1,
      });
      expect(result).toBeNull();
    });

    it('identifies the specific exceeded threshold', () => {
      const expander = new GraphExpander({ ...DEFAULT_THRESHOLDS, maxAgentCount: 5 });
      const result = expander.getExceededThreshold({
        currentCost: 1.0,
        currentAgentCount: 5,
        currentExpansions: 0,
        currentToolForges: 0,
        patchCostDelta: 0.5,
        patchAgentDelta: 1,
      });
      expect(result).toEqual({ threshold: 'maxAgentCount', value: 6, cap: 5 });
    });
  });
});

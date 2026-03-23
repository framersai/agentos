/**
 * @file node-scheduler.test.ts
 * @description Unit tests for NodeScheduler — topological ordering, cycle detection,
 * ready-node detection, and reachability analysis.
 */

import { describe, it, expect } from 'vitest';
import { NodeScheduler } from '../runtime/NodeScheduler.js';
import { START, END } from '../ir/types.js';
import type { GraphNode, GraphEdge } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: GraphNode['type'] = 'tool'): GraphNode {
  return {
    id,
    type,
    executorConfig: { type: 'tool', toolName: 'test' },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

function makeEdge(source: string, target: string, id?: string): GraphEdge {
  return { id: id ?? `${source}->${target}`, source, target, type: 'static' };
}

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe('NodeScheduler.topologicalSort', () => {
  it('returns nodes in topological order for a linear graph (START→a→b→c→END)', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', 'b'),
      makeEdge('b', 'c'),
      makeEdge('c', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    const order = scheduler.topologicalSort();

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('places a join node after both parallel branches (START→a, START→b, a→c, b→c)', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge(START, 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', 'c'),
      makeEdge('c', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    const order = scheduler.topologicalSort();

    // a and b must both appear before c
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'));
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('b'));
    expect(order).toHaveLength(3);
  });

  it('returns all nodes even when some have no edges to/from sentinels (standalone real edges)', () => {
    // a→b with no START/END wiring — both should still appear in topological order
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    const scheduler = new NodeScheduler(nodes, edges);
    const order = scheduler.topologicalSort();

    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('returns empty array for a graph with no real nodes', () => {
    const scheduler = new NodeScheduler([], [makeEdge(START, END)]);
    expect(scheduler.topologicalSort()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasCycles
// ---------------------------------------------------------------------------

describe('NodeScheduler.hasCycles', () => {
  it('detects a simple cycle (a→b→a)', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', 'b'),
      makeEdge('b', 'a'), // cycle
      makeEdge('b', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    expect(scheduler.hasCycles()).toBe(true);
  });

  it('detects a self-loop (a→a)', () => {
    const nodes = [makeNode('a')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', 'a'), // self-loop
      makeEdge('a', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    expect(scheduler.hasCycles()).toBe(true);
  });

  it('reports no cycles for a valid DAG', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', END),
      makeEdge('c', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    expect(scheduler.hasCycles()).toBe(false);
  });

  it('reports no cycles for a linear graph', () => {
    const nodes = [makeNode('x'), makeNode('y')];
    const edges = [makeEdge(START, 'x'), makeEdge('x', 'y'), makeEdge('y', END)];
    const scheduler = new NodeScheduler(nodes, edges);
    expect(scheduler.hasCycles()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getReadyNodes
// ---------------------------------------------------------------------------

describe('NodeScheduler.getReadyNodes', () => {
  it('returns nodes directly connected from START when nothing is completed', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge(START, 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', 'c'),
      makeEdge('c', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    const ready = scheduler.getReadyNodes([]);

    expect(ready.sort()).toEqual(['a', 'b']);
  });

  it('unlocks a join node only after ALL its predecessors complete', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge(START, 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', 'c'),
      makeEdge('c', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);

    // After only 'a' completes, 'c' is still blocked by 'b'.
    expect(scheduler.getReadyNodes(['a'])).not.toContain('c');

    // After both complete, 'c' becomes ready.
    expect(scheduler.getReadyNodes(['a', 'b'])).toContain('c');
  });

  it('excludes already-completed nodes from the ready set', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge(START, 'a'), makeEdge('a', 'b'), makeEdge('b', END)];
    const scheduler = new NodeScheduler(nodes, edges);

    const ready = scheduler.getReadyNodes(['a']);
    expect(ready).toContain('b');
    expect(ready).not.toContain('a');
  });

  it('treats skipped nodes as satisfied for dependency purposes', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', END),
      makeEdge('c', END),
    ];
    const scheduler = new NodeScheduler(nodes, edges);

    // 'a' completed, 'b' skipped → 'c' should be ready
    const ready = scheduler.getReadyNodes(['a'], ['b']);
    expect(ready).toContain('c');
    expect(ready).not.toContain('b');
    expect(ready).not.toContain('a');
  });
});

// ---------------------------------------------------------------------------
// getUnreachableNodes
// ---------------------------------------------------------------------------

describe('NodeScheduler.getUnreachableNodes', () => {
  it('returns empty array when all nodes are reachable from START', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge(START, 'a'), makeEdge('a', 'b'), makeEdge('b', END)];
    const scheduler = new NodeScheduler(nodes, edges);
    expect(scheduler.getUnreachableNodes()).toEqual([]);
  });

  it('detects orphan nodes with no incoming edges from the reachable subgraph', () => {
    const nodes = [makeNode('a'), makeNode('orphan')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', END),
      // 'orphan' has no edge from START or any reachable node
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    expect(scheduler.getUnreachableNodes()).toContain('orphan');
  });

  it('detects a node reachable only from another orphan (transitive unreachability)', () => {
    const nodes = [makeNode('a'), makeNode('orphan1'), makeNode('orphan2')];
    const edges = [
      makeEdge(START, 'a'),
      makeEdge('a', END),
      makeEdge('orphan1', 'orphan2'), // orphan2 reachable from orphan1, not from START
    ];
    const scheduler = new NodeScheduler(nodes, edges);
    const unreachable = scheduler.getUnreachableNodes();
    expect(unreachable).toContain('orphan1');
    expect(unreachable).toContain('orphan2');
  });
});

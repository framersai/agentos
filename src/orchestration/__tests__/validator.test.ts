/**
 * @file validator.test.ts
 * @description Unit tests for GraphValidator — static structural analysis of CompiledExecutionGraph.
 */

import { describe, it, expect } from 'vitest';
import { GraphValidator } from '../compiler/Validator.js';
import type { CompiledExecutionGraph, GraphNode, GraphEdge } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** Creates a minimal but valid GraphNode. */
function makeNode(id: string): GraphNode {
  return {
    id,
    type: 'tool',
    executorConfig: { type: 'tool', toolName: 'noop' },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

/** Creates a minimal GraphEdge. */
function makeEdge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, type: 'static' };
}

/**
 * Builds a valid single-node graph (START → a → END) with optional overrides.
 * This is the baseline "happy path" graph used across multiple tests.
 */
function makeGraph(overrides: Partial<CompiledExecutionGraph> = {}): CompiledExecutionGraph {
  return {
    id: 'g1',
    name: 'test-graph',
    nodes: [makeNode('a')],
    edges: [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', '__END__'),
    ],
    stateSchema: { input: {}, scratch: {}, artifacts: {} },
    reducers: {},
    checkpointPolicy: 'none',
    memoryConsistency: 'live',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphValidator', () => {
  // 1. Happy path ---------------------------------------------------------------
  it('passes a valid single-node DAG', () => {
    const result = GraphValidator.validate(makeGraph());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // 2. Cycle detection (requireAcyclic = true) -----------------------------------
  it('rejects a cycle when requireAcyclic is true (default)', () => {
    // Graph: START → a → b → a (cycle between a and b) → END
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', 'b'),
      makeEdge('e3', 'b', 'a'),   // cycle
      makeEdge('e4', 'b', '__END__'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cycle'))).toBe(true);
  });

  it('rejects a cycle even when requireAcyclic is explicitly true', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', 'b'),
      makeEdge('e3', 'b', 'a'),
      makeEdge('e4', 'b', '__END__'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }), { requireAcyclic: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cycle'))).toBe(true);
  });

  // 3. Cycle allowed when requireAcyclic = false ---------------------------------
  it('allows a cycle when requireAcyclic is false', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', 'b'),
      makeEdge('e3', 'b', 'a'),   // cycle — allowed
      makeEdge('e4', 'b', '__END__'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }), { requireAcyclic: false });
    // No cycle error; may still have warnings
    expect(result.errors.some(e => e.includes('cycle'))).toBe(false);
  });

  // 4. Unreachable nodes ---------------------------------------------------------
  it('warns on unreachable nodes', () => {
    // Node 'orphan' has no incoming edges from START or any other node.
    const nodes = [makeNode('a'), makeNode('orphan')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', '__END__'),
      // 'orphan' has an outgoing edge but nothing reaches it
      makeEdge('e3', 'orphan', '__END__'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.warnings.some(w => w.includes('orphan'))).toBe(true);
  });

  // 5. Missing START edges -------------------------------------------------------
  it('errors when there are no edges from START', () => {
    const nodes = [makeNode('a')];
    const edges = [
      // No __START__ source — only an exit edge
      makeEdge('e1', 'a', '__END__'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('entry point') || e.includes('START'))).toBe(true);
  });

  // 6. Missing END edges ---------------------------------------------------------
  it('errors when there are no edges to END', () => {
    const nodes = [makeNode('a')];
    const edges = [
      // No __END__ target — only an entry edge
      makeEdge('e1', '__START__', 'a'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exit point') || e.includes('END'))).toBe(true);
  });

  // 7. Invalid edge references ---------------------------------------------------
  it('errors on an edge referencing an unknown source node', () => {
    const nodes = [makeNode('a')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', '__END__'),
      makeEdge('e3', 'ghost', 'a'),  // 'ghost' not in nodes
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ghost'))).toBe(true);
  });

  it('errors on an edge referencing an unknown target node', () => {
    const nodes = [makeNode('a')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', '__END__'),
      makeEdge('e3', 'a', 'missing'),  // 'missing' not in nodes
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('missing'))).toBe(true);
  });

  // 8. Multi-node DAG passes cleanly ---------------------------------------------
  it('passes a valid two-node sequential DAG', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', '__START__', 'a'),
      makeEdge('e2', 'a', 'b'),
      makeEdge('e3', 'b', '__END__'),
    ];
    const result = GraphValidator.validate(makeGraph({ nodes, edges }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

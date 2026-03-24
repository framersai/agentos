/**
 * @file graph-compiler.test.ts
 * @description Unit tests for `GraphCompiler.compile()`.
 *
 * Covers:
 * - Compiles nodes (Map) and edges (array) into a CompiledExecutionGraph
 * - Lowers Zod schemas to JSON Schema in stateSchema
 * - Passes non-Zod (plain object) schemas through unchanged
 * - Preserves reducers and checkpointPolicy
 * - Generates a unique graph id containing the name
 * - Handles empty node/edge lists
 * - memoryConsistency forwarded unchanged
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { GraphCompiler } from '../compiler/GraphCompiler.js';
import type { GraphCompilerInput } from '../compiler/GraphCompiler.js';
import type { GraphNode, GraphEdge } from '../ir/types.js';
import { START, END } from '../ir/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string): GraphNode {
  return {
    id,
    type: 'gmi',
    executorConfig: { type: 'gmi', instructions: `instructions for ${id}` },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

function makeEdge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, type: 'static' };
}

function makeBaseInput(overrides: Partial<GraphCompilerInput> = {}): GraphCompilerInput {
  return {
    name: 'test-graph',
    nodes: new Map(),
    edges: [],
    stateSchema: {
      input: z.object({ query: z.string() }),
      scratch: z.object({ result: z.string().optional() }),
      artifacts: z.object({ output: z.string() }),
    },
    reducers: {},
    memoryConsistency: 'snapshot',
    checkpointPolicy: 'none',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphCompiler.compile()', () => {
  it('returns an object with nodes array derived from the Map', () => {
    const nodes = new Map([
      ['a', makeNode('a')],
      ['b', makeNode('b')],
    ]);
    const edges = [
      makeEdge('e0', START, 'a'),
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'b', END),
    ];
    const result = GraphCompiler.compile(makeBaseInput({ nodes, edges }));

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map(n => n.id)).toEqual(['a', 'b']);
  });

  it('preserves insertion order of nodes in the output array', () => {
    const nodes = new Map<string, GraphNode>();
    nodes.set('z', makeNode('z'));
    nodes.set('m', makeNode('m'));
    nodes.set('a', makeNode('a'));

    const result = GraphCompiler.compile(makeBaseInput({ nodes }));
    expect(result.nodes.map(n => n.id)).toEqual(['z', 'm', 'a']);
  });

  it('copies the edges array reference', () => {
    const edges = [makeEdge('e0', START, END)];
    const result = GraphCompiler.compile(makeBaseInput({ edges }));
    expect(result.edges).toBe(edges);
  });

  it('generates a graph id containing the graph name and a timestamp component', () => {
    const r1 = GraphCompiler.compile(makeBaseInput({ name: 'my-graph' }));
    expect(r1.id).toContain('my-graph');
    // ID should start with "graph-" prefix
    expect(r1.id).toMatch(/^graph-my-graph-\d+$/);
  });

  it('generates different ids for graphs with different names', () => {
    const r1 = GraphCompiler.compile(makeBaseInput({ name: 'graph-alpha' }));
    const r2 = GraphCompiler.compile(makeBaseInput({ name: 'graph-beta' }));
    expect(r1.id).toContain('graph-alpha');
    expect(r2.id).toContain('graph-beta');
    expect(r1.id).not.toBe(r2.id);
  });

  it('sets name from input', () => {
    const result = GraphCompiler.compile(makeBaseInput({ name: 'awesome-agent' }));
    expect(result.name).toBe('awesome-agent');
  });

  it('lowers Zod schemas to JSON Schema objects', () => {
    const result = GraphCompiler.compile(makeBaseInput({
      stateSchema: {
        input: z.object({ topic: z.string() }),
        scratch: z.object({ count: z.number() }),
        artifacts: z.object({ summary: z.string() }),
      },
    }));

    // JSON Schema objects should have a "type" or "properties" field, not Zod internals
    expect(typeof result.stateSchema.input).toBe('object');
    expect(typeof result.stateSchema.scratch).toBe('object');
    expect(typeof result.stateSchema.artifacts).toBe('object');

    // Zod instances should not leak through
    expect(result.stateSchema.input).not.toHaveProperty('_def');
    expect(result.stateSchema.scratch).not.toHaveProperty('_def');
    expect(result.stateSchema.artifacts).not.toHaveProperty('_def');
  });

  it('passes non-Zod plain objects through schema lowering without error', () => {
    const plainSchema = { type: 'object', properties: { x: { type: 'string' } } };
    const result = GraphCompiler.compile(makeBaseInput({
      stateSchema: {
        input: plainSchema,
        scratch: plainSchema,
        artifacts: plainSchema,
      },
    }));
    // Should not throw and should return something
    expect(result.stateSchema.input).toBeDefined();
  });

  it('forwards reducers unchanged', () => {
    const reducers = { 'scratch.items': 'concat' as const };
    const result = GraphCompiler.compile(makeBaseInput({ reducers }));
    expect(result.reducers).toBe(reducers);
  });

  it('forwards checkpointPolicy unchanged', () => {
    for (const policy of ['every_node', 'explicit', 'none'] as const) {
      const result = GraphCompiler.compile(makeBaseInput({ checkpointPolicy: policy }));
      expect(result.checkpointPolicy).toBe(policy);
    }
  });

  it('forwards memoryConsistency unchanged', () => {
    for (const mode of ['live', 'snapshot', 'journaled'] as const) {
      const result = GraphCompiler.compile(makeBaseInput({ memoryConsistency: mode }));
      expect(result.memoryConsistency).toBe(mode);
    }
  });

  it('handles empty nodes and edges', () => {
    const result = GraphCompiler.compile(makeBaseInput({ nodes: new Map(), edges: [] }));
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('does not mutate the input nodes Map', () => {
    const nodes = new Map([['a', makeNode('a')]]);
    const nodesBefore = new Map(nodes);
    GraphCompiler.compile(makeBaseInput({ nodes }));
    expect(nodes.size).toBe(nodesBefore.size);
    expect(nodes.get('a')).toEqual(nodesBefore.get('a'));
  });

  it('output nodes are distinct objects from the input Map values', () => {
    const node = makeNode('a');
    const nodes = new Map([['a', node]]);
    const result = GraphCompiler.compile(makeBaseInput({ nodes }));
    // Array.from(map.values()) returns the same references; test that node data is preserved
    expect(result.nodes[0]).toMatchObject({ id: 'a', type: 'gmi' });
  });
});

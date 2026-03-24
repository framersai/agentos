/**
 * @file node-builders.test.ts
 * @description Unit tests for the node builder factory functions in `builders/nodes.ts`.
 *
 * Covers:
 * - gmiNode: defaults, unique id generation, policy passthrough
 * - toolNode: defaults, effectClass, args forwarding
 * - humanNode: effectClass='human', checkpoint defaults to 'after'
 * - routerNode: function routing vs. string expression routing
 * - guardrailNode: guardrailIds and onViolation stored correctly
 * - subgraphNode: graphId derived from compiled graph
 * - Policy fields passed through correctly on all builders
 */

import { describe, it, expect } from 'vitest';
import {
  gmiNode,
  toolNode,
  humanNode,
  routerNode,
  guardrailNode,
  subgraphNode,
} from '../builders/nodes.js';
import type { CompiledExecutionGraph } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake CompiledExecutionGraph for subgraphNode tests. */
function fakeCompiledGraph(id: string): CompiledExecutionGraph {
  return {
    id,
    name: 'fake-graph',
    nodes: [],
    edges: [],
    stateSchema: { input: {}, scratch: {}, artifacts: {} },
    reducers: {},
    checkpointPolicy: 'none',
    memoryConsistency: 'snapshot',
  };
}

// ---------------------------------------------------------------------------
// gmiNode
// ---------------------------------------------------------------------------

describe('gmiNode', () => {
  it('returns a node with type "gmi"', () => {
    const node = gmiNode({ instructions: 'Do something.' });
    expect(node.type).toBe('gmi');
  });

  it('defaults executionMode to react_bounded', () => {
    const node = gmiNode({ instructions: 'Do something.' });
    expect(node.executionMode).toBe('react_bounded');
  });

  it('defaults effectClass to "read"', () => {
    const node = gmiNode({ instructions: 'Do something.' });
    expect(node.effectClass).toBe('read');
  });

  it('defaults checkpoint to "none"', () => {
    const node = gmiNode({ instructions: 'Do something.' });
    expect(node.checkpoint).toBe('none');
  });

  it('generates a unique id with "gmi-" prefix', () => {
    const a = gmiNode({ instructions: 'A' });
    const b = gmiNode({ instructions: 'B' });
    expect(a.id).toMatch(/^gmi-\d+$/);
    expect(b.id).toMatch(/^gmi-\d+$/);
    expect(a.id).not.toBe(b.id);
  });

  it('stores executorConfig instructions', () => {
    const node = gmiNode({ instructions: 'Analyse this.' });
    expect(node.executorConfig).toMatchObject({
      type: 'gmi',
      instructions: 'Analyse this.',
    });
  });

  it('forwards optional config fields to executorConfig', () => {
    const node = gmiNode({
      instructions: 'x',
      maxInternalIterations: 5,
      parallelTools: true,
      temperature: 0.7,
      maxTokens: 1024,
    });
    const cfg = node.executorConfig as any;
    expect(cfg.maxInternalIterations).toBe(5);
    expect(cfg.parallelTools).toBe(true);
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.maxTokens).toBe(1024);
  });

  it('respects executionMode override', () => {
    const node = gmiNode({ instructions: 'x', executionMode: 'planner_controlled' });
    expect(node.executionMode).toBe('planner_controlled');
  });

  it('applies memory policy from policies arg', () => {
    const node = gmiNode({ instructions: 'x' }, {
      memory: { consistency: 'live' },
    });
    expect(node.memoryPolicy).toMatchObject({ consistency: 'live' });
  });

  it('applies discovery policy from policies arg', () => {
    const node = gmiNode({ instructions: 'x' }, {
      discovery: { enabled: true, query: 'search tools' },
    });
    expect(node.discoveryPolicy).toMatchObject({ enabled: true, query: 'search tools' });
  });

  it('applies persona policy from policies arg', () => {
    const node = gmiNode({ instructions: 'x' }, {
      persona: { mood: 'excited', adaptStyle: true },
    });
    expect(node.personaPolicy).toMatchObject({ mood: 'excited', adaptStyle: true });
  });

  it('applies guardrail policy from policies arg', () => {
    const node = gmiNode({ instructions: 'x' }, {
      guardrails: { output: ['safety-v1'], onViolation: 'block' },
    });
    expect(node.guardrailPolicy).toMatchObject({ output: ['safety-v1'], onViolation: 'block' });
  });

  it('allows effectClass override via policies', () => {
    const node = gmiNode({ instructions: 'x' }, { effectClass: 'write' });
    expect(node.effectClass).toBe('write');
  });

  it('allows checkpoint override via policies', () => {
    const node = gmiNode({ instructions: 'x' }, { checkpoint: 'after' });
    expect(node.checkpoint).toBe('after');
  });
});

// ---------------------------------------------------------------------------
// toolNode
// ---------------------------------------------------------------------------

describe('toolNode', () => {
  it('returns a node with type "tool"', () => {
    const node = toolNode('web_search');
    expect(node.type).toBe('tool');
  });

  it('defaults executionMode to single_turn', () => {
    const node = toolNode('web_search');
    expect(node.executionMode).toBe('single_turn');
  });

  it('defaults effectClass to "external"', () => {
    const node = toolNode('web_search');
    expect(node.effectClass).toBe('external');
  });

  it('defaults checkpoint to "none"', () => {
    const node = toolNode('web_search');
    expect(node.checkpoint).toBe('none');
  });

  it('generates a unique id with "tool-" prefix', () => {
    const a = toolNode('tool_a');
    const b = toolNode('tool_b');
    expect(a.id).toMatch(/^tool-\d+$/);
    expect(b.id).toMatch(/^tool-\d+$/);
    expect(a.id).not.toBe(b.id);
  });

  it('stores toolName in executorConfig', () => {
    const node = toolNode('my_tool');
    expect(node.executorConfig).toMatchObject({ type: 'tool', toolName: 'my_tool' });
  });

  it('forwards static args to executorConfig', () => {
    const node = toolNode('my_tool', { args: { limit: 10 } });
    const cfg = node.executorConfig as any;
    expect(cfg.args).toEqual({ limit: 10 });
  });

  it('stores timeout from config', () => {
    const node = toolNode('my_tool', { timeout: 5000 });
    expect(node.timeout).toBe(5000);
  });

  it('stores retryPolicy from config', () => {
    const node = toolNode('my_tool', {
      retryPolicy: { maxAttempts: 3, backoff: 'exponential', backoffMs: 200 },
    });
    expect(node.retryPolicy).toMatchObject({ maxAttempts: 3, backoff: 'exponential' });
  });

  it('allows effectClass override via policies', () => {
    const node = toolNode('my_tool', {}, { effectClass: 'write' });
    expect(node.effectClass).toBe('write');
  });

  it('applies memory/discovery/guardrail policies', () => {
    const node = toolNode('my_tool', {}, {
      memory: { consistency: 'journaled' },
      guardrails: { output: ['g1'], onViolation: 'warn' },
    });
    expect(node.memoryPolicy).toMatchObject({ consistency: 'journaled' });
    expect(node.guardrailPolicy).toMatchObject({ onViolation: 'warn' });
  });
});

// ---------------------------------------------------------------------------
// humanNode
// ---------------------------------------------------------------------------

describe('humanNode', () => {
  it('returns a node with type "human"', () => {
    const node = humanNode({ prompt: 'Approve this action?' });
    expect(node.type).toBe('human');
  });

  it('sets effectClass to "human"', () => {
    const node = humanNode({ prompt: 'Approve?' });
    expect(node.effectClass).toBe('human');
  });

  it('defaults checkpoint to "after"', () => {
    const node = humanNode({ prompt: 'Approve?' });
    expect(node.checkpoint).toBe('after');
  });

  it('allows checkpoint override', () => {
    const node = humanNode({ prompt: 'Approve?' }, { checkpoint: 'both' });
    expect(node.checkpoint).toBe('both');
  });

  it('stores prompt in executorConfig', () => {
    const node = humanNode({ prompt: 'Please review.' });
    expect(node.executorConfig).toMatchObject({ type: 'human', prompt: 'Please review.' });
  });

  it('stores optional timeout', () => {
    const node = humanNode({ prompt: 'Approve?', timeout: 3600000 });
    expect(node.timeout).toBe(3600000);
  });

  it('generates a unique id with "human-" prefix', () => {
    const a = humanNode({ prompt: 'A' });
    const b = humanNode({ prompt: 'B' });
    expect(a.id).toMatch(/^human-\d+$/);
    expect(b.id).toMatch(/^human-\d+$/);
    expect(a.id).not.toBe(b.id);
  });

  it('sets executionMode to single_turn', () => {
    const node = humanNode({ prompt: 'Approve?' });
    expect(node.executionMode).toBe('single_turn');
  });
});

// ---------------------------------------------------------------------------
// routerNode
// ---------------------------------------------------------------------------

describe('routerNode', () => {
  it('returns a node with type "router"', () => {
    const node = routerNode('state.scratch.next');
    expect(node.type).toBe('router');
  });

  it('stores string route as expression condition', () => {
    const node = routerNode('state.scratch.branch');
    const cfg = node.executorConfig as any;
    expect(cfg.condition).toMatchObject({
      type: 'expression',
      expr: 'state.scratch.branch',
    });
  });

  it('stores function route as function condition', () => {
    const fn = (state: any) => state.scratch.flag ? 'yes' : 'no';
    const node = routerNode(fn);
    const cfg = node.executorConfig as any;
    expect(cfg.condition.type).toBe('function');
    expect(cfg.condition.fn).toBe(fn);
  });

  it('sets effectClass to "pure"', () => {
    const node = routerNode('x');
    expect(node.effectClass).toBe('pure');
  });

  it('sets checkpoint to "none"', () => {
    const node = routerNode('x');
    expect(node.checkpoint).toBe('none');
  });

  it('generates a unique id with "router-" prefix', () => {
    const a = routerNode('a');
    const b = routerNode('b');
    expect(a.id).toMatch(/^router-\d+$/);
    expect(b.id).toMatch(/^router-\d+$/);
    expect(a.id).not.toBe(b.id);
  });

  it('sets executionMode to single_turn', () => {
    const node = routerNode('x');
    expect(node.executionMode).toBe('single_turn');
  });
});

// ---------------------------------------------------------------------------
// guardrailNode
// ---------------------------------------------------------------------------

describe('guardrailNode', () => {
  it('returns a node with type "guardrail"', () => {
    const node = guardrailNode(['safety-v1'], { onViolation: 'block' });
    expect(node.type).toBe('guardrail');
  });

  it('stores guardrailIds in executorConfig', () => {
    const ids = ['safety-v1', 'pii-v2'];
    const node = guardrailNode(ids, { onViolation: 'warn' });
    const cfg = node.executorConfig as any;
    expect(cfg.guardrailIds).toEqual(ids);
  });

  it('stores onViolation in executorConfig', () => {
    const node = guardrailNode(['g1'], { onViolation: 'reroute', rerouteTarget: 'fallback' });
    const cfg = node.executorConfig as any;
    expect(cfg.onViolation).toBe('reroute');
    expect(cfg.rerouteTarget).toBe('fallback');
  });

  it('supports all onViolation modes', () => {
    for (const mode of ['block', 'reroute', 'warn', 'sanitize'] as const) {
      const node = guardrailNode(['g1'], { onViolation: mode });
      const cfg = node.executorConfig as any;
      expect(cfg.onViolation).toBe(mode);
    }
  });

  it('sets effectClass to "pure"', () => {
    const node = guardrailNode(['g1'], { onViolation: 'warn' });
    expect(node.effectClass).toBe('pure');
  });

  it('sets checkpoint to "none"', () => {
    const node = guardrailNode(['g1'], { onViolation: 'warn' });
    expect(node.checkpoint).toBe('none');
  });

  it('generates a unique id with "guardrail-" prefix', () => {
    const a = guardrailNode(['g1'], { onViolation: 'warn' });
    const b = guardrailNode(['g2'], { onViolation: 'block' });
    expect(a.id).toMatch(/^guardrail-\d+$/);
    expect(b.id).toMatch(/^guardrail-\d+$/);
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// subgraphNode
// ---------------------------------------------------------------------------

describe('subgraphNode', () => {
  it('returns a node with type "subgraph"', () => {
    const graph = fakeCompiledGraph('child-graph-1');
    const node = subgraphNode(graph);
    expect(node.type).toBe('subgraph');
  });

  it('stores graphId from compiled graph', () => {
    const graph = fakeCompiledGraph('my-child-graph');
    const node = subgraphNode(graph);
    const cfg = node.executorConfig as any;
    expect(cfg.graphId).toBe('my-child-graph');
  });

  it('stores inputMapping and outputMapping when provided', () => {
    const graph = fakeCompiledGraph('child');
    const node = subgraphNode(graph, {
      inputMapping: { 'scratch.query': 'input.q' },
      outputMapping: { 'artifacts.result': 'scratch.childResult' },
    });
    const cfg = node.executorConfig as any;
    expect(cfg.inputMapping).toEqual({ 'scratch.query': 'input.q' });
    expect(cfg.outputMapping).toEqual({ 'artifacts.result': 'scratch.childResult' });
  });

  it('sets effectClass to "read"', () => {
    const graph = fakeCompiledGraph('c');
    const node = subgraphNode(graph);
    expect(node.effectClass).toBe('read');
  });

  it('sets checkpoint to "none"', () => {
    const graph = fakeCompiledGraph('c');
    const node = subgraphNode(graph);
    expect(node.checkpoint).toBe('none');
  });

  it('generates a unique id with "subgraph-" prefix', () => {
    const a = subgraphNode(fakeCompiledGraph('c1'));
    const b = subgraphNode(fakeCompiledGraph('c2'));
    expect(a.id).toMatch(/^subgraph-\d+$/);
    expect(b.id).toMatch(/^subgraph-\d+$/);
    expect(a.id).not.toBe(b.id);
  });
});

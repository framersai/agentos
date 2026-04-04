/**
 * @file agent-graph.test.ts
 * @description Unit tests for the AgentGraph builder and CompiledAgentGraph execution wrapper.
 *
 * Covers:
 * - Linear graph construction and compilation
 * - Conditional edge support
 * - Personality edge support
 * - Discovery edge support
 * - Duplicate node id rejection
 * - Unreachable-node detection at compile time
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AgentGraph } from '../builders/AgentGraph.js';
import { toolNode, gmiNode } from '../builders/nodes.js';
import { START, END } from '../ir/index.js';

describe('AgentGraph', () => {
  it('builds and compiles a simple linear graph', () => {
    const graph = new AgentGraph({
      input: z.object({ topic: z.string() }),
      scratch: z.object({}),
      artifacts: z.object({ result: z.string() }),
    })
      .addNode('search', toolNode('web_search'))
      .addNode('summarize', toolNode('summarize'))
      .addEdge(START, 'search')
      .addEdge('search', 'summarize')
      .addEdge('summarize', END)
      .compile();

    const ir = graph.toIR();
    expect(ir.nodes).toHaveLength(2);
    expect(ir.edges).toHaveLength(3);
  });

  it('supports conditional edges', () => {
    const graph = new AgentGraph({
      input: z.object({}),
      scratch: z.object({ confidence: z.number().default(0) }),
      artifacts: z.object({}),
    })
      .addNode('eval', toolNode('evaluate'))
      .addNode('retry', toolNode('search'))
      .addNode('done', toolNode('finish'))
      .addEdge(START, 'eval')
      .addConditionalEdge('eval', (state) =>
        (state.scratch as any).confidence > 0.8 ? 'done' : 'retry')
      .addEdge('retry', 'eval')
      .addEdge('done', END)
      .compile();

    const ir = graph.toIR();
    expect(ir.edges.some(e => e.type === 'conditional')).toBe(true);
  });

  it('supports personality edges', () => {
    const graph = new AgentGraph({
      input: z.object({}),
      scratch: z.object({}),
      artifacts: z.object({}),
    })
      .addNode('decide', toolNode('decide'))
      .addNode('careful', toolNode('review'))
      .addNode('fast', toolNode('ship'))
      .addEdge(START, 'decide')
      .addPersonalityEdge('decide', {
        trait: 'conscientiousness', threshold: 0.7,
        above: 'careful', below: 'fast',
      })
      .addEdge('careful', END)
      .addEdge('fast', END)
      .compile();

    const ir = graph.toIR();
    expect(ir.edges.some(e => e.type === 'personality')).toBe(true);
  });

  it('supports discovery edges', () => {
    const graph = new AgentGraph({
      input: z.object({ query: z.string() }),
      scratch: z.object({}),
      artifacts: z.object({}),
    })
      .addNode('start', toolNode('init'))
      .addNode('fallback', toolNode('default_search'))
      .addEdge(START, 'start')
      .addDiscoveryEdge('start', {
        query: 'best tool for {input.query}',
        kind: 'tool',
        fallbackTarget: 'fallback',
      })
      .addEdge('fallback', END)
      .compile();

    const ir = graph.toIR();
    expect(ir.edges.some(e => e.type === 'discovery')).toBe(true);
  });

  it('rejects duplicate node IDs', () => {
    expect(() => {
      new AgentGraph({ input: z.object({}), scratch: z.object({}), artifacts: z.object({}) })
        .addNode('a', toolNode('t1'))
        .addNode('a', toolNode('t2'));
    }).toThrow(/duplicate/i);
  });

  it('validates unreachable nodes on compile', () => {
    expect(() => {
      new AgentGraph({ input: z.object({}), scratch: z.object({}), artifacts: z.object({}) })
        .addNode('a', toolNode('t1'))
        .addNode('orphan', toolNode('t2'))
        .addEdge(START, 'a')
        .addEdge('a', END)
        .compile({ validate: true });
    }).toThrow(/unreachable|orphan/i);
  });
});

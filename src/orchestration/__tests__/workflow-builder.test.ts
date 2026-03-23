/**
 * @file workflow-builder.test.ts
 * @description Unit tests for the workflow() DSL and WorkflowBuilder.
 *
 * Covers:
 * 1. Linear workflow — correct node and edge counts in the IR.
 * 2. Branch step — router node + per-route branch nodes created.
 * 3. Parallel step — correct node count including parallel branches.
 * 4. GMI steps default to `executionMode: 'single_turn'`.
 * 5. Compile throws when `.input()` is missing.
 * 6. Compile throws when `.returns()` is missing.
 * 7. Graph is always acyclic — validator enforces it (sanity test via validation path).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { workflow } from '../builders/WorkflowBuilder.js';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const inputSchema = z.object({ query: z.string() });
const outputSchema = z.object({ answer: z.string() });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workflow() DSL', () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  it('builds a linear workflow with two steps — IR has correct node count', () => {
    const wf = workflow('linear-test')
      .input(inputSchema)
      .returns(outputSchema)
      .step('fetch', { tool: 'web_fetch' })
      .step('summarize', { tool: 'summarizer' })
      .compile();

    const ir = wf.toIR();

    // Expect exactly 2 user-declared nodes.
    expect(ir.nodes).toHaveLength(2);
    expect(ir.nodes.map((n) => n.id)).toContain('fetch');
    expect(ir.nodes.map((n) => n.id)).toContain('summarize');

    // Edges: START→fetch, fetch→summarize, summarize→END = 3.
    expect(ir.edges).toHaveLength(3);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it('builds a workflow with a branch — creates router + branch nodes', () => {
    const wf = workflow('branch-test')
      .input(inputSchema)
      .returns(outputSchema)
      .step('classify', { tool: 'classifier' })
      .branch(
        (state) => (state.scratch as any).label === 'yes' ? 'approve' : 'reject',
        {
          approve: { tool: 'approve_tool' },
          reject: { tool: 'reject_tool' },
        },
      )
      .compile();

    const ir = wf.toIR();

    // Nodes: classify + router + 2 branch nodes = 4.
    expect(ir.nodes).toHaveLength(4);

    // There must be at least one router-type node.
    const routerNodes = ir.nodes.filter((n) => n.type === 'router');
    expect(routerNodes).toHaveLength(1);

    // There must be two conditional edges (one per branch arm).
    const conditionalEdges = ir.edges.filter((e) => e.type === 'conditional');
    expect(conditionalEdges).toHaveLength(2);
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it('builds a workflow with parallel steps — correct node count', () => {
    const wf = workflow('parallel-test')
      .input(inputSchema)
      .returns(outputSchema)
      .step('prepare', { tool: 'prepare_tool' })
      .parallel(
        [
          { tool: 'tool_a' },
          { tool: 'tool_b' },
          { tool: 'tool_c' },
        ],
        {
          strategy: 'all',
          merge: { 'scratch.results': 'concat' },
        },
      )
      .compile();

    const ir = wf.toIR();

    // Nodes: prepare + 3 parallel branches = 4.
    expect(ir.nodes).toHaveLength(4);

    // Reducers should include the merge field from join config.
    expect(ir.reducers['scratch.results']).toBe('concat');
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it('defaults GMI steps to executionMode single_turn', () => {
    const wf = workflow('gmi-mode-test')
      .input(inputSchema)
      .returns(outputSchema)
      .step('think', {
        gmi: { instructions: 'Think about the query.' },
      })
      .compile();

    const ir = wf.toIR();
    const gmiStepNode = ir.nodes.find((n) => n.id === 'think');

    expect(gmiStepNode).toBeDefined();
    expect(gmiStepNode!.executionMode).toBe('single_turn');
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  it('throws when .input() schema is not declared', () => {
    expect(() => {
      workflow('missing-input')
        .returns(outputSchema)
        .step('s1', { tool: 'tool_a' })
        .compile();
    }).toThrow(/requires .input\(\) schema/);
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  it('throws when .returns() schema is not declared', () => {
    expect(() => {
      workflow('missing-returns')
        .input(inputSchema)
        .step('s1', { tool: 'tool_a' })
        .compile();
    }).toThrow(/requires .returns\(\) schema/);
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  it('produces an acyclic DAG — compiled graph passes the acyclicity validator', () => {
    // The workflow API structurally cannot produce cycles, but we verify that
    // the compiled IR passes the validator's requireAcyclic check (it does
    // because compile() throws if validation fails).
    const wf = workflow('acyclic-test')
      .input(inputSchema)
      .returns(outputSchema)
      .step('a', { tool: 'tool_a' })
      .step('b', { tool: 'tool_b' })
      .step('c', { tool: 'tool_c' })
      .compile();

    const ir = wf.toIR();
    // The graph must have a well-formed START entry and END exit.
    expect(ir.edges.some((e) => e.source === '__START__')).toBe(true);
    expect(ir.edges.some((e) => e.target === '__END__')).toBe(true);
  });
});

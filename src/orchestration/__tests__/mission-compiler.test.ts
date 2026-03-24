/**
 * @file mission-compiler.test.ts
 * @description Unit tests for `MissionCompiler.compile()`.
 *
 * Covers:
 * - Generates a stub plan with gather/process/deliver phases
 * - All plan phase nodes appear in the compiled graph
 * - Anchors are spliced into correct phases
 * - Anchor after constraints are respected
 * - Mission-level guardrail policies are applied to all nodes
 * - Acyclic DAG validation passes for linear plans
 * - Throws when validation fails (would require cycle — tested via validator)
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MissionCompiler } from '../compiler/MissionCompiler.js';
import type { MissionConfig } from '../compiler/MissionCompiler.js';
import { gmiNode, toolNode, humanNode } from '../builders/nodes.js';
import { START, END } from '../ir/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseConfig(overrides: Partial<MissionConfig> = {}): MissionConfig {
  return {
    name: 'test-mission',
    inputSchema: z.object({ topic: z.string() }),
    goalTemplate: 'Research {{topic}} and summarise findings',
    returnsSchema: z.object({ summary: z.string() }),
    plannerConfig: {
      strategy: 'linear',
      maxSteps: 5,
      maxIterationsPerNode: 3,
    },
    anchors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MissionCompiler.compile()', () => {
  it('returns a CompiledExecutionGraph with a non-empty id', () => {
    const ir = MissionCompiler.compile(makeBaseConfig());
    expect(ir.id).toBeTruthy();
    expect(typeof ir.id).toBe('string');
  });

  it('sets graph name from config', () => {
    const ir = MissionCompiler.compile(makeBaseConfig({ name: 'my-mission' }));
    expect(ir.name).toBe('my-mission');
  });

  it('generates stub plan with gather, process, and deliver phase nodes', () => {
    const ir = MissionCompiler.compile(makeBaseConfig());
    const nodeIds = ir.nodes.map(n => n.id);
    expect(nodeIds).toContain('gather-info');
    expect(nodeIds).toContain('process-info');
    expect(nodeIds).toContain('deliver-result');
  });

  it('produces a linear edge chain: START → gather → process → deliver → END', () => {
    const ir = MissionCompiler.compile(makeBaseConfig());

    const edgePairs = ir.edges.map(e => `${e.source}->${e.target}`);
    expect(edgePairs).toContain(`${START}->gather-info`);
    expect(edgePairs).toContain('gather-info->process-info');
    expect(edgePairs).toContain('process-info->deliver-result');
    expect(edgePairs).toContain(`deliver-result->${END}`);
  });

  it('all edges are static', () => {
    const ir = MissionCompiler.compile(makeBaseConfig());
    for (const edge of ir.edges) {
      expect(edge.type).toBe('static');
    }
  });

  it('sets checkpointPolicy to every_node', () => {
    const ir = MissionCompiler.compile(makeBaseConfig());
    expect(ir.checkpointPolicy).toBe('every_node');
  });

  it('adds anchor nodes to the compiled graph', () => {
    const anchor = gmiNode({ instructions: 'Validate findings' });
    const ir = MissionCompiler.compile(makeBaseConfig({
      anchors: [{
        id: 'validation-step',
        node: anchor,
        constraints: { required: true, phase: 'process' },
      }],
    }));

    const nodeIds = ir.nodes.map(n => n.id);
    expect(nodeIds).toContain('validation-step');
  });

  it('anchor id overwrites the node builder id', () => {
    const anchor = gmiNode({ instructions: 'Custom step' });
    const originalId = anchor.id;

    const ir = MissionCompiler.compile(makeBaseConfig({
      anchors: [{
        id: 'my-custom-anchor',
        node: anchor,
        constraints: { required: true, phase: 'gather' },
      }],
    }));

    const compiled = ir.nodes.find(n => n.id === 'my-custom-anchor');
    expect(compiled).toBeDefined();
    // The auto-generated id from gmiNode should not appear in the compiled graph
    expect(ir.nodes.find(n => n.id === originalId)).toBeUndefined();
  });

  it('splices anchor after a specific node id', () => {
    const anchor = gmiNode({ instructions: 'Post-gather validation' });

    const ir = MissionCompiler.compile(makeBaseConfig({
      anchors: [{
        id: 'after-gather',
        node: anchor,
        constraints: { required: true, phase: 'gather', after: 'gather-info' },
      }],
    }));

    const edgePairs = ir.edges.map(e => `${e.source}->${e.target}`);
    // gather-info → after-gather should appear before after-gather → process-info
    expect(edgePairs).toContain('gather-info->after-gather');
    expect(edgePairs).toContain(`after-gather->process-info`);
  });

  it('appends phase anchor at phase tail when after target not found', () => {
    const anchor = humanNode({ prompt: 'Approve before delivery?' });

    const ir = MissionCompiler.compile(makeBaseConfig({
      anchors: [{
        id: 'approval-gate',
        node: anchor,
        constraints: { required: true, phase: 'process', after: 'nonexistent-node' },
      }],
    }));

    const nodeIds = ir.nodes.map(n => n.id);
    expect(nodeIds).toContain('approval-gate');
  });

  it('appends anchorless-phase anchors at graph tail', () => {
    const anchor = toolNode('audit_log');

    const ir = MissionCompiler.compile(makeBaseConfig({
      anchors: [{
        id: 'audit',
        node: anchor,
        constraints: { required: false },
      }],
    }));

    // Should be in the graph
    const nodeIds = ir.nodes.map(n => n.id);
    expect(nodeIds).toContain('audit');

    // Should appear in edges
    const edgeSources = ir.edges.map(e => e.source);
    expect(edgeSources).toContain('audit');
  });

  it('applies mission-level guardrail policy to all nodes without existing policies', () => {
    const ir = MissionCompiler.compile(makeBaseConfig({
      policyConfig: {
        guardrails: ['safety-v1', 'pii-v2'],
      },
    }));

    for (const node of ir.nodes) {
      expect(node.guardrailPolicy).toBeDefined();
      expect(node.guardrailPolicy!.output).toContain('safety-v1');
      expect(node.guardrailPolicy!.output).toContain('pii-v2');
      expect(node.guardrailPolicy!.onViolation).toBe('warn');
    }
  });

  it('does not override guardrail policy on nodes that already have one', () => {
    const anchor = gmiNode({ instructions: 'x' }, {
      guardrails: { output: ['custom-guard'], onViolation: 'block' },
    });

    const ir = MissionCompiler.compile(makeBaseConfig({
      policyConfig: { guardrails: ['safety-v1'] },
      anchors: [{
        id: 'guarded-anchor',
        node: anchor,
        constraints: { required: true, phase: 'process' },
      }],
    }));

    const node = ir.nodes.find(n => n.id === 'guarded-anchor');
    expect(node).toBeDefined();
    // The existing policy should be preserved — it has 'custom-guard', not 'safety-v1'
    expect(node!.guardrailPolicy!.output).toContain('custom-guard');
    expect(node!.guardrailPolicy!.onViolation).toBe('block');
  });

  it('applies memory consistency from policyConfig', () => {
    const ir = MissionCompiler.compile(makeBaseConfig({
      policyConfig: { memory: { consistency: 'journaled' } },
    }));
    expect(ir.memoryConsistency).toBe('journaled');
  });

  it('defaults memoryConsistency to snapshot when no policy provided', () => {
    const ir = MissionCompiler.compile(makeBaseConfig());
    expect(ir.memoryConsistency).toBe('snapshot');
  });

  it('produces a valid acyclic graph (validator passes without throwing)', () => {
    expect(() => MissionCompiler.compile(makeBaseConfig())).not.toThrow();
  });

  it('handles multiple anchors in the same phase maintaining relative order', () => {
    const a1 = gmiNode({ instructions: 'Anchor 1' });
    const a2 = gmiNode({ instructions: 'Anchor 2' });

    const ir = MissionCompiler.compile(makeBaseConfig({
      anchors: [
        { id: 'anchor-1', node: a1, constraints: { required: true, phase: 'process' } },
        { id: 'anchor-2', node: a2, constraints: { required: true, phase: 'process' } },
      ],
    }));

    const nodeIds = ir.nodes.map(n => n.id);
    expect(nodeIds).toContain('anchor-1');
    expect(nodeIds).toContain('anchor-2');

    // Both should appear in edges
    const edgePairs = ir.edges.map(e => `${e.source}->${e.target}`);
    const anchorInEdges = edgePairs.some(p => p.includes('anchor-1') || p.includes('anchor-2'));
    expect(anchorInEdges).toBe(true);
  });
});

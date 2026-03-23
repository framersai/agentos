/**
 * @file mission-builder.test.ts
 * @description Unit tests for the mission() API, MissionBuilder, and MissionCompiler.
 *
 * Covers:
 * 1. Builds a mission with goal and returns — compiles without error, exposes toIR and explain.
 * 2. Interpolates goal template — goalTemplate is stored in compiled IR metadata.
 * 3. Supports anchors with phase constraints — anchor nodes appear in compiled IR.
 * 4. Supports policy configuration — guardrailPolicy applied to nodes.
 * 5. Throws when input schema is missing.
 * 6. Throws when goal template is missing.
 * 7. Throws when planner config is missing.
 * 8. explain() returns steps array and IR.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { mission } from '../builders/MissionBuilder.js';
import { toolNode } from '../builders/nodes.js';

// ---------------------------------------------------------------------------
// Shared schemas and planner config
// ---------------------------------------------------------------------------

const inputSchema = z.object({ topic: z.string() });
const outputSchema = z.object({ summary: z.string() });

const defaultPlanner = {
  strategy: 'linear',
  maxSteps: 6,
  maxIterationsPerNode: 3,
  parallelTools: false,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mission() API', () => {
  // -------------------------------------------------------------------------
  // Test 1: basic compile
  // -------------------------------------------------------------------------
  it('builds a mission with goal and returns — compiles without error', () => {
    const m = mission('research')
      .input(inputSchema)
      .goal('Research {{topic}} and summarise findings')
      .returns(outputSchema)
      .planner(defaultPlanner)
      .compile();

    // toIR() must return a CompiledExecutionGraph with nodes and edges
    const ir = m.toIR();
    expect(ir).toBeDefined();
    expect(typeof ir.id).toBe('string');
    expect(ir.name).toBe('research');
    expect(Array.isArray(ir.nodes)).toBe(true);
    expect(Array.isArray(ir.edges)).toBe(true);
    expect(ir.nodes.length).toBeGreaterThan(0);
    expect(ir.edges.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: goal template stored in IR
  // -------------------------------------------------------------------------
  it('goal template is reflected in gmi node instructions within the IR', () => {
    const goalTemplate = 'Research {{topic}} and produce a bullet-point summary';
    const m = mission('template-test')
      .input(inputSchema)
      .goal(goalTemplate)
      .returns(outputSchema)
      .planner(defaultPlanner)
      .compile();

    const ir = m.toIR();

    // At least one gmi node should have the goal template embedded in its instructions
    const gmiNodes = ir.nodes.filter(n => n.type === 'gmi');
    expect(gmiNodes.length).toBeGreaterThan(0);

    const hasGoalInInstructions = gmiNodes.some(n => {
      const cfg = n.executorConfig;
      return cfg.type === 'gmi' && cfg.instructions.includes('Research {{topic}}');
    });
    expect(hasGoalInInstructions).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: anchors with phase constraints appear in IR
  // -------------------------------------------------------------------------
  it('anchor nodes appear in the compiled IR at the declared phase', () => {
    const humanCheckpoint = toolNode('audit-logger');
    const m = mission('anchored-mission')
      .input(inputSchema)
      .goal('Audit-logged research on {{topic}}')
      .returns(outputSchema)
      .planner(defaultPlanner)
      .anchor('audit-node', humanCheckpoint, { required: true, phase: 'validate' })
      .compile();

    const ir = m.toIR();
    const anchorInIR = ir.nodes.find(n => n.id === 'audit-node');
    expect(anchorInIR).toBeDefined();
    expect(anchorInIR!.type).toBe('tool');
  });

  // -------------------------------------------------------------------------
  // Test 4: policy configuration — guardrailPolicy applied to nodes
  // -------------------------------------------------------------------------
  it('guardrail policy is applied to all nodes that lack an explicit guardrail', () => {
    const m = mission('guarded-mission')
      .input(inputSchema)
      .goal('Safe research on {{topic}}')
      .returns(outputSchema)
      .planner(defaultPlanner)
      .policy({ guardrails: ['content-safety', 'pii-filter'] })
      .compile();

    const ir = m.toIR();

    // Every node in the compiled graph should carry the mission-level guardrail policy
    for (const node of ir.nodes) {
      expect(node.guardrailPolicy).toBeDefined();
      expect(node.guardrailPolicy!.output).toEqual(['content-safety', 'pii-filter']);
      expect(node.guardrailPolicy!.onViolation).toBe('warn');
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: missing input schema throws
  // -------------------------------------------------------------------------
  it('throws when .input() is not called', () => {
    expect(() =>
      mission('no-input')
        .goal('Do something')
        .returns(outputSchema)
        .planner(defaultPlanner)
        .compile(),
    ).toThrow(/input/i);
  });

  // -------------------------------------------------------------------------
  // Test 6: missing goal throws
  // -------------------------------------------------------------------------
  it('throws when .goal() is not called', () => {
    expect(() =>
      mission('no-goal')
        .input(inputSchema)
        .returns(outputSchema)
        .planner(defaultPlanner)
        .compile(),
    ).toThrow(/goal/i);
  });

  // -------------------------------------------------------------------------
  // Test 7: missing planner config throws
  // -------------------------------------------------------------------------
  it('throws when .planner() is not called', () => {
    expect(() =>
      mission('no-planner')
        .input(inputSchema)
        .goal('Do something useful')
        .returns(outputSchema)
        .compile(),
    ).toThrow(/planner/i);
  });

  // -------------------------------------------------------------------------
  // Test 8: explain() returns steps and IR
  // -------------------------------------------------------------------------
  it('explain() returns a steps array and the compiled IR', async () => {
    const m = mission('explain-test')
      .input(inputSchema)
      .goal('Explain {{topic}} at a beginner level')
      .returns(outputSchema)
      .planner(defaultPlanner)
      .compile();

    const result = await m.explain({ topic: 'recursion' });

    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);

    // Each step must have id, type, and config
    for (const step of result.steps) {
      expect(typeof step.id).toBe('string');
      expect(typeof step.type).toBe('string');
      expect(step.config).toBeDefined();
    }

    // IR must be a valid CompiledExecutionGraph
    expect(result.ir).toBeDefined();
    expect(Array.isArray(result.ir.nodes)).toBe(true);
    expect(Array.isArray(result.ir.edges)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 9: multiple anchors at different phases maintain phase ordering
  // -------------------------------------------------------------------------
  it('multiple anchors at different phases are ordered correctly (gather before validate)', () => {
    const gatherAnchor = toolNode('gather-tool');
    const validateAnchor = toolNode('validate-tool');

    const m = mission('multi-anchor')
      .input(inputSchema)
      .goal('Multi-phase research on {{topic}}')
      .returns(outputSchema)
      .planner(defaultPlanner)
      .anchor('g-anchor', gatherAnchor, { required: true, phase: 'gather' })
      .anchor('v-anchor', validateAnchor, { required: true, phase: 'validate' })
      .compile();

    const ir = m.toIR();
    const nodeIds = ir.nodes.map(n => n.id);
    const gIdx = nodeIds.indexOf('g-anchor');
    const vIdx = nodeIds.indexOf('v-anchor');

    // Both must be present
    expect(gIdx).toBeGreaterThanOrEqual(0);
    expect(vIdx).toBeGreaterThanOrEqual(0);

    // gather anchor must appear before validate anchor
    expect(gIdx).toBeLessThan(vIdx);
  });

  // -------------------------------------------------------------------------
  // Test 10: toWorkflow() is equivalent to toIR()
  // -------------------------------------------------------------------------
  it('toWorkflow() returns the same structure as toIR()', () => {
    const m = mission('workflow-alias')
      .input(inputSchema)
      .goal('Test {{topic}}')
      .returns(outputSchema)
      .planner(defaultPlanner)
      .compile();

    const ir = m.toIR();
    const wf = m.toWorkflow();

    // Both calls produce fresh compilations — compare structural equality
    expect(wf.name).toBe(ir.name);
    expect(wf.nodes.length).toBe(ir.nodes.length);
    expect(wf.edges.length).toBe(ir.edges.length);
    expect(wf.checkpointPolicy).toBe(ir.checkpointPolicy);
    expect(wf.memoryConsistency).toBe(ir.memoryConsistency);
  });
});

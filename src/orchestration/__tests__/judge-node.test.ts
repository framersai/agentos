import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { judgeNode } from '../builders/nodes.js';

describe('judgeNode', () => {
  it('creates a gmi node with judge instructions', () => {
    const node = judgeNode({
      rubric: 'Score accuracy (1-10) and credibility (1-10)',
      schema: z.object({ accuracy: z.number(), credibility: z.number() }),
    });
    expect(node.type).toBe('gmi');
    expect(node.executionMode).toBe('single_turn');
    expect(node.executorConfig.type).toBe('gmi');
    if (node.executorConfig.type === 'gmi') {
      expect(node.executorConfig.instructions).toContain('evaluation judge');
      expect(node.executorConfig.instructions).toContain('Score accuracy');
    }
  });

  it('includes threshold in instructions', () => {
    const node = judgeNode({
      rubric: 'Score quality 1-10',
      schema: z.object({ quality: z.number() }),
      threshold: 7,
    });
    if (node.executorConfig.type === 'gmi') {
      expect(node.executorConfig.instructions).toContain('7');
      expect(node.executorConfig.instructions).toContain('Pass Threshold');
    }
  });

  it('sets outputSchema from Zod schema', () => {
    const node = judgeNode({
      rubric: 'Rate it',
      schema: z.object({ score: z.number() }),
    });
    expect(node.outputSchema).toBeDefined();
  });

  it('generates unique ID with judge prefix', () => {
    const a = judgeNode({ rubric: 'r', schema: z.object({}) });
    const b = judgeNode({ rubric: 'r', schema: z.object({}) });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/judge/);
  });
});

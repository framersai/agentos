/**
 * @file humanNode-guardrail.test.ts
 * @description Unit tests for humanNode guardrail override integration.
 *
 * Covers:
 * 1. humanNode with autoAccept + guardrailOverride blocks via guardrail engine.
 * 2. humanNode with guardrailOverride: false allows everything (no engine call).
 * 3. humanNode with autoAccept passes when guardrail engine says passed.
 * 4. humanNode without guardrail engine passes even with guardrailOverride: true.
 */

import { describe, it, expect, vi } from 'vitest';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import type { GraphNode, GraphState } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Mock generateText for timeout-accept tests that need a slow judge path
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();

vi.mock('../../api/generateText.js', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal empty graph state stub. */
const emptyState: Partial<GraphState> = {};

/**
 * Builds a `GraphNode` for a `human` executor with guardrailOverride config.
 */
function makeHumanNode(config: {
  prompt: string;
  autoAccept?: boolean;
  autoReject?: boolean | string;
  judge?: {
    model?: string;
  };
  guardrailOverride?: boolean;
  timeout?: number;
  onTimeout?: 'accept' | 'reject' | 'error';
}): GraphNode {
  return {
    id: 'node-human-guardrail-test',
    type: 'human',
    executorConfig: {
      type: 'human',
      prompt: config.prompt,
      autoAccept: config.autoAccept,
      autoReject: config.autoReject,
      judge: config.judge,
      guardrailOverride: config.guardrailOverride,
      onTimeout: config.onTimeout,
    },
    executionMode: 'single_turn',
    effectClass: 'human',
    timeout: config.timeout,
    checkpoint: 'after',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('humanNode guardrail override', () => {
  // -------------------------------------------------------------------------
  // 1. autoAccept + guardrailOverride blocks via guardrail engine
  // -------------------------------------------------------------------------

  it('blocks auto-accepted node when guardrail engine fails evaluation', async () => {
    const mockGuardrailEngine = {
      evaluate: vi.fn().mockResolvedValue({
        passed: false,
        results: [{ reason: 'detected destructive shell pattern' }],
      }),
    };

    const executor = new NodeExecutor({ guardrailEngine: mockGuardrailEngine });
    const node = makeHumanNode({
      prompt: 'Execute rm -rf /?',
      autoAccept: true,
      guardrailOverride: true,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(false);
    expect(output.decidedBy).toBe('guardrail-override');
    expect(output.reason).toContain('Guardrail override');
    expect(mockGuardrailEngine.evaluate).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 2. guardrailOverride: false allows everything (no engine call)
  // -------------------------------------------------------------------------

  it('allows auto-accepted node when guardrailOverride is false', async () => {
    const mockGuardrailEngine = {
      evaluate: vi.fn().mockResolvedValue({ passed: false, results: [] }),
    };

    const executor = new NodeExecutor({ guardrailEngine: mockGuardrailEngine });
    const node = makeHumanNode({
      prompt: 'Execute rm -rf /?',
      autoAccept: true,
      guardrailOverride: false,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('auto-accept');
    // Guardrail engine should NOT have been called.
    expect(mockGuardrailEngine.evaluate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. autoAccept passes when guardrail engine passes
  // -------------------------------------------------------------------------

  it('allows auto-accepted node when guardrail engine passes', async () => {
    const mockGuardrailEngine = {
      evaluate: vi.fn().mockResolvedValue({ passed: true, results: [] }),
    };

    const executor = new NodeExecutor({ guardrailEngine: mockGuardrailEngine });
    const node = makeHumanNode({
      prompt: 'Read the file?',
      autoAccept: true,
      guardrailOverride: true,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('auto-accept');
    expect(mockGuardrailEngine.evaluate).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 4. No guardrail engine — passes even with guardrailOverride: true
  // -------------------------------------------------------------------------

  it('allows auto-accepted node when no guardrail engine is configured', async () => {
    const executor = new NodeExecutor({});
    const node = makeHumanNode({
      prompt: 'Execute rm -rf /?',
      autoAccept: true,
      guardrailOverride: true,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('auto-accept');
  });

  // -------------------------------------------------------------------------
  // 5. Default guardrailOverride (omitted) is treated as true
  // -------------------------------------------------------------------------

  it('defaults to guardrailOverride: true when not specified', async () => {
    const mockGuardrailEngine = {
      evaluate: vi.fn().mockResolvedValue({
        passed: false,
        results: [{ reason: 'blocked' }],
      }),
    };

    const executor = new NodeExecutor({ guardrailEngine: mockGuardrailEngine });
    const node = makeHumanNode({
      prompt: 'Drop the database?',
      autoAccept: true,
      // guardrailOverride not specified — defaults to true
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(false);
    expect(output.decidedBy).toBe('guardrail-override');
    expect(mockGuardrailEngine.evaluate).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 6. Guardrail override includes events
  // -------------------------------------------------------------------------

  it('emits guardrail:hitl-override event when blocking', async () => {
    const mockGuardrailEngine = {
      evaluate: vi.fn().mockResolvedValue({
        passed: false,
        results: [{ reason: 'dangerous command' }],
      }),
    };

    const executor = new NodeExecutor({ guardrailEngine: mockGuardrailEngine });
    const node = makeHumanNode({
      prompt: 'Format drive C:?',
      autoAccept: true,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.events).toBeDefined();
    expect(result.events!.length).toBeGreaterThan(0);
    const event = result.events![0] as Record<string, unknown>;
    expect(event.type).toBe('guardrail:hitl-override');
    expect(event.reason).toContain('dangerous command');
  });

  it('blocks timeout auto-accept when the post-approval guardrail fails', async () => {
    mockGenerateText.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        text: '{}',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        toolCalls: [],
        finishReason: 'stop',
      }), 5_000)),
    );

    const mockGuardrailEngine = {
      evaluate: vi.fn().mockResolvedValue({
        passed: false,
        results: [{ reason: 'timeout approval still unsafe' }],
      }),
    };

    const executor = new NodeExecutor({ guardrailEngine: mockGuardrailEngine });
    const node = makeHumanNode({
      prompt: 'Approve dangerous timeout action?',
      judge: { model: 'gpt-4o-mini' },
      onTimeout: 'accept',
      timeout: 50,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(false);
    expect(output.decidedBy).toBe('guardrail-override');
    expect(output.reason).toContain('timeout approval still unsafe');
    expect(mockGuardrailEngine.evaluate).toHaveBeenCalledOnce();
  }, 5_000);
});

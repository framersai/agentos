/**
 * @file humanNode-options.test.ts
 * @description Unit tests for the expanded `humanNode` options: autoAccept,
 * autoReject, judge delegation, and onTimeout behaviour.
 *
 * Covers:
 * 1. humanNode with autoAccept returns immediately with approved:true.
 * 2. humanNode with autoReject returns immediately with approved:false.
 * 3. humanNode with autoReject string returns the reason.
 * 4. humanNode with judge delegates to LLM.
 * 5. humanNode with judge falls through to interrupt when confidence is low.
 * 6. humanNode onTimeout:'accept' auto-accepts on timeout.
 * 7. humanNode onTimeout:'reject' auto-rejects on timeout.
 * 8. humanNode default (no options) still interrupts.
 */

import { describe, it, expect, vi } from 'vitest';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import type { GraphNode, GraphState } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Mock generateText for LLM judge tests
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
 * Builds a `GraphNode` for a `human` executor with the extended config.
 */
function makeHumanNode(config: {
  prompt: string;
  autoAccept?: boolean;
  autoReject?: boolean | string;
  judge?: {
    model?: string;
    provider?: string;
    criteria?: string;
    confidenceThreshold?: number;
  };
  onTimeout?: 'accept' | 'reject' | 'error';
  timeout?: number;
}): GraphNode {
  return {
    id: 'node-human-test',
    type: 'human',
    executorConfig: {
      type: 'human',
      prompt: config.prompt,
      autoAccept: config.autoAccept,
      autoReject: config.autoReject,
      judge: config.judge,
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

describe('humanNode options', () => {
  // -------------------------------------------------------------------------
  // 1. autoAccept returns approved:true immediately
  // -------------------------------------------------------------------------

  it('autoAccept returns immediately with approved:true', async () => {
    const executor = new NodeExecutor({});
    const node = makeHumanNode({ prompt: 'Approve?', autoAccept: true });
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    expect(result.interrupt).toBeUndefined();
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('auto-accept');
  });

  // -------------------------------------------------------------------------
  // 2. autoReject (boolean) returns approved:false immediately
  // -------------------------------------------------------------------------

  it('autoReject (boolean) returns immediately with approved:false', async () => {
    const executor = new NodeExecutor({});
    const node = makeHumanNode({ prompt: 'Approve?', autoReject: true });
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    expect(result.interrupt).toBeUndefined();
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(false);
    expect(output.reason).toBe('Auto-rejected');
    expect(output.decidedBy).toBe('auto-reject');
  });

  // -------------------------------------------------------------------------
  // 3. autoReject with string returns the reason
  // -------------------------------------------------------------------------

  it('autoReject with string returns the rejection reason', async () => {
    const executor = new NodeExecutor({});
    const node = makeHumanNode({ prompt: 'Approve?', autoReject: 'Policy violation' });
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(false);
    expect(output.reason).toBe('Policy violation');
    expect(output.decidedBy).toBe('auto-reject');
  });

  // -------------------------------------------------------------------------
  // 4. judge delegates to LLM and returns decision
  // -------------------------------------------------------------------------

  it('judge delegates to LLM and returns approved decision', async () => {
    mockGenerateText.mockResolvedValue({
      text: '{ "approved": true, "confidence": 0.95, "reasoning": "Looks safe" }',
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      toolCalls: [],
      finishReason: 'stop',
    });

    const executor = new NodeExecutor({});
    const node = makeHumanNode({
      prompt: 'Should we proceed?',
      judge: { model: 'gpt-4o-mini', criteria: 'Is this safe?' },
    });
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    expect(result.interrupt).toBeUndefined();
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('llm-judge');
  });

  // -------------------------------------------------------------------------
  // 5. judge falls through to interrupt when confidence is low
  // -------------------------------------------------------------------------

  it('judge falls through to interrupt when confidence is below threshold', async () => {
    mockGenerateText.mockResolvedValue({
      text: '{ "approved": true, "confidence": 0.3, "reasoning": "Not sure" }',
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      toolCalls: [],
      finishReason: 'stop',
    });

    const executor = new NodeExecutor({});
    const node = makeHumanNode({
      prompt: 'Should we proceed?',
      judge: { model: 'gpt-4o-mini', confidenceThreshold: 0.8 },
    });
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(false);
    expect(result.interrupt).toBe(true);
    expect(result.error).toBe('Awaiting human input');
  });

  // -------------------------------------------------------------------------
  // 6. onTimeout:'accept' auto-accepts on timeout
  // -------------------------------------------------------------------------

  it('onTimeout accept auto-accepts when node times out', async () => {
    // Tool orchestrator that never resolves (simulates a hanging human interrupt).
    // The human node itself resolves with interrupt:true, but we need a real
    // timeout race. Use a custom executor that takes longer than the timeout.
    const executor = new NodeExecutor({});
    const node = makeHumanNode({
      prompt: 'Approve?',
      onTimeout: 'accept',
      timeout: 50,
    });

    // The default human node returns interrupt:true synchronously, which wins
    // the race before timeout fires. To test onTimeout properly, we need the
    // executeNode to take longer than the timeout. We'll test via the
    // judge path that we make slow.
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

    const slowNode = makeHumanNode({
      prompt: 'Approve?',
      judge: { model: 'gpt-4o-mini' },
      onTimeout: 'accept',
      timeout: 50,
    });

    const result = await executor.execute(slowNode, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('timeout-accept');
  }, 5_000);

  // -------------------------------------------------------------------------
  // 7. onTimeout:'reject' auto-rejects on timeout
  // -------------------------------------------------------------------------

  it('onTimeout reject auto-rejects when node times out', async () => {
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

    const executor = new NodeExecutor({});
    const node = makeHumanNode({
      prompt: 'Approve?',
      judge: { model: 'gpt-4o-mini' },
      onTimeout: 'reject',
      timeout: 50,
    });

    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(false);
    expect(output.reason).toBe('Timed out');
    expect(output.decidedBy).toBe('timeout-reject');
  }, 5_000);

  // -------------------------------------------------------------------------
  // 8. Default (no options) still interrupts
  // -------------------------------------------------------------------------

  it('default humanNode with no options still interrupts', async () => {
    const executor = new NodeExecutor({});
    const node = makeHumanNode({ prompt: 'Please review this content.' });
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(false);
    expect(result.interrupt).toBe(true);
    expect(result.error).toBe('Awaiting human input');
    const output = result.output as Record<string, unknown>;
    expect(output.prompt).toBe('Please review this content.');
  });
});

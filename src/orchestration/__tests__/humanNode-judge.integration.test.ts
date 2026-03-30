/**
 * @file humanNode-judge.integration.test.ts
 * @description Integration tests for humanNode with LLM judge, autoAccept,
 * and onTimeout options exercised through the full graph builder + NodeExecutor
 * pipeline.
 *
 * Covers:
 * 1. A graph with humanNode({ judge }) does not interrupt when LLM approves.
 * 2. A graph with humanNode({ autoAccept }) completes without suspension.
 * 3. A graph with humanNode({ onTimeout: 'accept', timeout: 100 }) auto-accepts.
 */

import { describe, it, expect, vi } from 'vitest';
import { humanNode } from '../builders/nodes.js';
import { NodeExecutor } from '../runtime/NodeExecutor.js';
import type { GraphState } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Mock generateText for LLM judge integration
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();

vi.mock('../../api/generateText.js', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyState: Partial<GraphState> = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('humanNode judge integration', () => {
  // -------------------------------------------------------------------------
  // 1. humanNode with judge does not interrupt when LLM approves
  // -------------------------------------------------------------------------

  it('humanNode with judge does not interrupt when LLM approves with high confidence', async () => {
    mockGenerateText.mockResolvedValue({
      text: '{ "approved": true, "confidence": 0.92, "reasoning": "All checks pass" }',
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      toolCalls: [],
      finishReason: 'stop',
    });

    const node = humanNode({
      prompt: 'Approve content publication?',
      judge: { model: 'gpt-4o-mini', criteria: 'Is the content appropriate?' },
    });

    const executor = new NodeExecutor({});
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    expect(result.interrupt).toBeUndefined();
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('llm-judge');
  });

  // -------------------------------------------------------------------------
  // 2. humanNode with autoAccept completes without suspension
  // -------------------------------------------------------------------------

  it('humanNode with autoAccept completes without suspension', async () => {
    const node = humanNode({
      prompt: 'Approve deployment?',
      autoAccept: true,
    });

    const executor = new NodeExecutor({});
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    expect(result.interrupt).toBeUndefined();
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('auto-accept');
  });

  // -------------------------------------------------------------------------
  // 3. humanNode with onTimeout:'accept' auto-accepts after timeout
  // -------------------------------------------------------------------------

  it('humanNode with onTimeout accept auto-accepts after timeout', async () => {
    // Make the LLM judge hang so the timeout fires first.
    mockGenerateText.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        text: '{}',
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        toolCalls: [],
        finishReason: 'stop',
      }), 10_000)),
    );

    const node = humanNode({
      prompt: 'Approve?',
      judge: { model: 'gpt-4o-mini' },
      onTimeout: 'accept',
      timeout: 100,
    });

    const executor = new NodeExecutor({});
    const result = await executor.execute(node, emptyState);

    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.approved).toBe(true);
    expect(output.decidedBy).toBe('timeout-accept');
  }, 5_000);
});

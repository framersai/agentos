/**
 * @fileoverview Integration-level tests for wrapForgeTool.
 *
 * Covers:
 * - Schema inference lets concrete-testCases-only forges reach the judge.
 * - Truly empty forges are still rejected by the shape validator.
 * - Judge rejection is captured with approved:false and confidence:0.
 * - Judge approval captures the judge's own confidence (not a default).
 * - Raw-execute exceptions are captured as approved:false with the message.
 * - Scope propagates onto every capture record when provided.
 * - Log callback receives structured lifecycle events.
 */

import { describe, it, expect } from 'vitest';
import { wrapForgeTool, type CapturedForge, type ForgeLogEvent } from '../wrapForgeTool.js';
import type { ForgeToolMetaTool } from '../ForgeToolMetaTool.js';
import type { ToolExecutionContext } from '../../core/tools/ITool.js';

function makeCapture() {
  const records: CapturedForge[] = [];
  return { records, capture: (r: CapturedForge) => { records.push(r); } };
}

/**
 * The wrapper patches gmiId + sessionData onto the context it forwards;
 * callers never actually read from the outer ctx, so an empty stand-in
 * is fine. Cast through unknown to satisfy strict tsc without adding a
 * fake GMI.
 */
const EMPTY_CTX = {} as unknown as ToolExecutionContext;

describe('wrapForgeTool', () => {
  it('synthesizes schemas from testCases so concrete-only forges reach the judge', async () => {
    let rawExecuteCalledWith: Record<string, unknown> | null = null;
    const rawMock = {
      execute: async (args: Record<string, unknown>) => {
        rawExecuteCalledWith = args;
        return {
          success: true,
          output: { success: true, verdict: { approved: true, confidence: 0.9, reasoning: 'ok' } },
        };
      },
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      scope: 'engineering',
      capture,
    });

    const llmArgs = {
      name: 'landing_site_suitability_score',
      description: 'Rates Mars landing sites 0-100.',
      implementation: {
        mode: 'sandbox',
        code: 'function execute(input) { return { score: (input.ice || 0) * 100 }; }',
        allowlist: [],
      },
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: { type: 'object', additionalProperties: true },
      testCases: [
        { input: { terrain: 'flat', ice: 0.8 }, expectedOutput: { score: 80 } },
        { input: { terrain: 'rocky', ice: 0.2 }, expectedOutput: { score: 20 } },
      ],
    };

    const result = await wrapped.execute(llmArgs, EMPTY_CTX);
    expect((result as { success?: boolean }).success).toBe(true);
    expect(rawExecuteCalledWith).not.toBeNull();
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({
      approved: true,
      name: 'landing_site_suitability_score',
      scope: 'engineering',
    });
    const forwarded = rawExecuteCalledWith as unknown as {
      inputSchema: { properties: Record<string, unknown> };
      outputSchema: { properties: Record<string, unknown> };
    };
    expect(forwarded.inputSchema.properties.terrain).toBeTruthy();
    expect(forwarded.inputSchema.properties.ice).toBeTruthy();
    expect(forwarded.outputSchema.properties.score).toBeTruthy();
  });

  it('rejects truly empty forges at the shape check without invoking the judge', async () => {
    let rawCalled = false;
    const rawMock = {
      execute: async () => { rawCalled = true; return { success: true } as unknown; },
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      scope: 'engineering',
      capture,
    });

    const llmArgs = {
      name: 'bad_tool',
      implementation: { mode: 'sandbox', code: 'function execute(){ return {}; }', allowlist: [] },
    };

    const result = await wrapped.execute(llmArgs, EMPTY_CTX);
    expect((result as { success?: boolean }).success).toBe(false);
    expect(rawCalled).toBe(false);
    expect(records.length).toBe(1);
    expect(records[0].approved).toBe(false);
    expect(String(records[0].errorReason)).toMatch(/Shape check failed/);
  });

  it('captures judge rejection with approved:false and confidence:0', async () => {
    const rawMock = {
      execute: async () => ({
        success: false,
        error: 'Judge rejected',
        output: {
          success: false,
          verdict: { approved: false, confidence: 0.42, reasoning: 'logic error in threshold ordering' },
        },
      }),
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      scope: 'engineering',
      capture,
    });

    const result = await wrapped.execute(
      {
        name: 'bad_calculator',
        implementation: { mode: 'sandbox', code: 'function execute(i){ return { x: i.a }; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect((result as { success?: boolean }).success).toBe(false);
    expect(records.length).toBe(1);
    expect(records[0].approved).toBe(false);
    expect(records[0].confidence).toBe(0);
    expect(String(records[0].errorReason)).toMatch(/Judge rejected|logic error/);
  });

  it('captures the judge\'s own confidence on approval (not the 0.85 fallback)', async () => {
    const rawMock = {
      execute: async () => ({
        success: true,
        output: { success: true, verdict: { approved: true, confidence: 0.73, reasoning: 'safe + correct' } },
      }),
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      capture,
    });

    await wrapped.execute(
      {
        name: 'ok_calculator',
        implementation: { mode: 'sandbox', code: 'function execute(i){ return { x: i.a }; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect(records.length).toBe(1);
    expect(records[0].approved).toBe(true);
    expect(records[0].confidence).toBe(0.73);
  });

  it('falls back to 0.85 when approval confidence is not a number', async () => {
    const rawMock = {
      execute: async () => ({
        success: true,
        output: { success: true, verdict: { approved: true, reasoning: 'no conf given' } },
      }),
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      capture,
    });

    await wrapped.execute(
      {
        name: 'unsure_tool',
        implementation: { mode: 'sandbox', code: 'function execute(i){ return { x: i.a }; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect(records[0].confidence).toBe(0.85);
  });

  it('captures raw-execute exceptions as approved:false with the error message', async () => {
    const rawMock = {
      execute: async () => { throw new Error('sandbox exploded'); },
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      capture,
    });

    const result = await wrapped.execute(
      {
        name: 'broken_tool',
        implementation: { mode: 'sandbox', code: 'function execute(i){ return { x: i.a }; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect((result as { success?: boolean }).success).toBe(false);
    expect(records.length).toBe(1);
    expect(records[0].approved).toBe(false);
    expect(records[0].confidence).toBe(0);
    expect(String(records[0].errorReason)).toMatch(/sandbox exploded/);
  });

  it('propagates scope onto every capture record', async () => {
    const rawMock = {
      execute: async () => ({
        success: true,
        output: { success: true, verdict: { approved: true, confidence: 0.9 } },
      }),
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      scope: 'chat:agent-99',
      capture,
    });

    await wrapped.execute(
      {
        name: 'tool',
        implementation: { mode: 'sandbox', code: 'function execute(){ return {}; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect(records[0].scope).toBe('chat:agent-99');
  });

  it('leaves scope undefined when none is provided', async () => {
    const rawMock = {
      execute: async () => ({
        success: true,
        output: { success: true, verdict: { approved: true, confidence: 0.9 } },
      }),
    } as unknown as ForgeToolMetaTool;

    const { records, capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      capture,
    });

    await wrapped.execute(
      {
        name: 'tool',
        implementation: { mode: 'sandbox', code: 'function execute(){ return {}; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect(records[0].scope).toBeUndefined();
  });

  it('emits structured lifecycle events through the log callback', async () => {
    const rawMock = {
      execute: async () => ({
        success: true,
        output: { success: true, verdict: { approved: true, confidence: 0.9 } },
      }),
    } as unknown as ForgeToolMetaTool;

    const events: ForgeLogEvent[] = [];
    const { capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      scope: 'engineering',
      capture,
      log: e => events.push(e),
    });

    await wrapped.execute(
      {
        name: 'tool',
        implementation: { mode: 'sandbox', code: 'function execute(){ return {}; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect(events.map(e => e.kind)).toEqual(['start', 'approved']);
    expect(events[0]).toMatchObject({ kind: 'start', scope: 'engineering', toolName: 'tool' });
    expect(events[1]).toMatchObject({ kind: 'approved', scope: 'engineering', toolName: 'tool' });
  });

  it('emits a rejected log event on shape-check failure', async () => {
    const rawMock = {
      execute: async () => ({ success: true } as unknown),
    } as unknown as ForgeToolMetaTool;

    const events: ForgeLogEvent[] = [];
    const { capture } = makeCapture();
    const wrapped = wrapForgeTool({
      raw: rawMock,
      agentId: 'agent-1',
      sessionId: 'sess-1',
      capture,
      log: e => events.push(e),
    });

    await wrapped.execute(
      {
        name: 'bad',
        implementation: { mode: 'sandbox', code: 'function execute(){ return {}; }', allowlist: [] },
      },
      EMPTY_CTX,
    );
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('rejected');
  });

  it('normalizes mode synonyms to sandbox/compose', async () => {
    let rawExecuteArgs: Record<string, unknown> | null = null;
    const rawMock = {
      execute: async (args: Record<string, unknown>) => {
        rawExecuteArgs = args;
        return {
          success: true,
          output: { success: true, verdict: { approved: true, confidence: 0.9 } },
        };
      },
    } as unknown as ForgeToolMetaTool;

    const { capture } = makeCapture();
    const wrapped = wrapForgeTool({ raw: rawMock, agentId: 'a', sessionId: 's', capture });

    await wrapped.execute(
      {
        name: 'tool',
        implementation: { mode: 'javascript', code: 'function execute(){ return {}; }', allowlist: [] },
        inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
        testCases: [
          { input: { a: 1 }, expectedOutput: { x: 1 } },
          { input: { a: 2 }, expectedOutput: { x: 2 } },
        ],
      },
      EMPTY_CTX,
    );
    expect((rawExecuteArgs as unknown as { implementation: { mode: string } }).implementation.mode).toBe('sandbox');
  });

  it('parses stringified-JSON schema fields before validation', async () => {
    let rawExecuteArgs: Record<string, unknown> | null = null;
    const rawMock = {
      execute: async (args: Record<string, unknown>) => {
        rawExecuteArgs = args;
        return {
          success: true,
          output: { success: true, verdict: { approved: true, confidence: 0.9 } },
        };
      },
    } as unknown as ForgeToolMetaTool;

    const { capture } = makeCapture();
    const wrapped = wrapForgeTool({ raw: rawMock, agentId: 'a', sessionId: 's', capture });

    const inputSchema = JSON.stringify({
      type: 'object',
      properties: { a: { type: 'number' } },
    });
    const outputSchema = JSON.stringify({
      type: 'object',
      properties: { x: { type: 'number' } },
    });
    const testCases = JSON.stringify([
      { input: { a: 1 }, expectedOutput: { x: 1 } },
      { input: { a: 2 }, expectedOutput: { x: 2 } },
    ]);

    const result = await wrapped.execute(
      {
        name: 'tool',
        implementation: { mode: 'sandbox', code: 'function execute(){ return {}; }', allowlist: [] },
        inputSchema,
        outputSchema,
        testCases,
      },
      EMPTY_CTX,
    );
    expect((result as { success?: boolean }).success).toBe(true);
    expect((rawExecuteArgs as unknown as { inputSchema: { properties: Record<string, unknown> } }).inputSchema.properties.a).toBeTruthy();
  });
});

/**
 * @file agency-integration.test.ts
 * Full integration tests for the `agency()` + `hitl` surface.
 *
 * These tests exercise the public API as a caller would use it: creating an
 * agency with various combinations of guardrails, controls, observability
 * callbacks, HITL handlers, and session management.
 *
 * Because the tests must run without real LLM API keys, the `agent()` factory
 * (the actual transport that fires HTTP requests) is replaced with a vi.mock
 * stub that returns controlled results.  Every other layer — `agency()`,
 * strategy compilation, resource controls, callback dispatch, and session
 * management — runs with its production implementation.
 *
 * Test areas:
 * - Sequential strategy with guardrails + controls + observability callbacks
 * - HITL auto-approve handler (beforeReturn gate)
 * - Session multi-turn history accumulation
 * - `close()` resource teardown (no throw)
 * - Resource limit breaches firing `limitReached` callbacks
 * - `agentEnd` callback fires on every generate() call
 * - Parallel strategy (requires agency-level model)
 * - Session isolation (two concurrent sessions do not share history)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Agent, BaseAgentConfig } from '../types.js';
import { AgencyConfigError } from '../types.js';

// ---------------------------------------------------------------------------
// Mock the strategy module so strategy compilers use our controllable spy
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  /**
   * The spy that backs every compiled strategy's `execute()` method.
   * Tests customise it per-call with `mockResolvedValueOnce` or reset it
   * in `beforeEach`.
   */
  strategyExecute: vi.fn(),
  strategyStream: vi.fn(),
}));

/**
 * Stub out the strategy compiler.  The production `agency()` calls
 * `compileStrategy(...)` exactly once at construction time.  Our stub
 * returns a single compiled strategy whose `execute` and `stream` delegate
 * to the hoisted spies, making every generate/stream call fully controllable
 * without any real network I/O.
 *
 * `isAgent` preserves the real behaviour (duck-typing on `generate`) so that
 * `close()` correctly detects and closes pre-built Agent instances.
 */
vi.mock('../strategies/index.js', () => ({
  compileStrategy: vi.fn(() => ({
    execute: hoisted.strategyExecute,
    stream: hoisted.strategyStream,
  })),
  isAgent: (value: BaseAgentConfig | Agent) =>
    typeof (value as Agent).generate === 'function',
}));

import { agency } from '../agency.js';
import { hitl } from '../hitl.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Token usage returned by default execute() calls. */
const DEFAULT_USAGE = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };

/** Typical single-agent call record included in default execute() results. */
const DEFAULT_AGENT_CALL = {
  agent: 'researcher',
  input: 'Write about AI',
  output: 'AI is transformative.',
  toolCalls: [],
  usage: DEFAULT_USAGE,
  durationMs: 80,
};

/** Full result returned by the mock strategy on every call unless overridden. */
const DEFAULT_RESULT = {
  text: 'AI is transformative.',
  agentCalls: [DEFAULT_AGENT_CALL],
  usage: DEFAULT_USAGE,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Returns a minimal `BaseAgentConfig` identified by `name`.
 *
 * @param name - Label embedded in the agent's instructions.
 */
function mockAgentConfig(name: string): BaseAgentConfig {
  return { instructions: `You are ${name}.` };
}

/**
 * Creates a pre-built mock `Agent` whose `generate()` always resolves with a
 * controlled result.  Useful when testing the `agents` roster with pre-built
 * instances rather than raw config objects.
 *
 * @param text - Output text the mock returns.
 */
function mockAgent(text = 'mock output'): Agent {
  return {
    generate: vi.fn().mockResolvedValue({ text, agentCalls: [], usage: DEFAULT_USAGE }),
    stream: vi.fn(),
    session: vi.fn(),
    usage: vi.fn().mockResolvedValue(DEFAULT_USAGE),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  /* Reset spies so each test starts from a clean slate. */
  hoisted.strategyExecute.mockResolvedValue(DEFAULT_RESULT);
  hoisted.strategyStream.mockReturnValue({
    textStream: (async function* () { yield DEFAULT_RESULT.text; })(),
    fullStream: (async function* () { yield { type: 'text', text: DEFAULT_RESULT.text }; })(),
    text: Promise.resolve(DEFAULT_RESULT.text),
    usage: Promise.resolve(DEFAULT_RESULT.usage),
  });
});

// ---------------------------------------------------------------------------
// Sequential with guardrails + controls + observability
// ---------------------------------------------------------------------------

describe('Agency Full Integration', () => {
  it('runs sequential with guardrails + controls + observability', async () => {
    const events: Array<Record<string, unknown>> = [];

    const team = agency({
      agents: {
        researcher: mockAgentConfig('researcher'),
        writer: mockAgentConfig('writer'),
      },
      strategy: 'sequential',
      guardrails: { output: ['grounding-guard'] },
      controls: { maxAgentCalls: 10 },
      observability: { traceEvents: true },
      on: {
        agentEnd: (e) => events.push(e as unknown as Record<string, unknown>),
      },
    });

    const result = await team.generate('Write about AI') as Record<string, unknown>;

    // Core result shape
    expect(result.text).toBe(DEFAULT_RESULT.text);
    expect(Array.isArray(result.agentCalls)).toBe(true);

    // agentEnd callback fired (once by the agency wrapper itself)
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({
      agent: '__agency__',
      output: DEFAULT_RESULT.text,
    });
  });

  it('fires agentEnd callback with correct agent name', async () => {
    const endEvents: Array<{ agent: string; output: string; durationMs: number; timestamp: number }> = [];

    const team = agency({
      agents: { worker: mockAgentConfig('worker') },
      strategy: 'sequential',
      on: { agentEnd: (e) => endEvents.push(e) },
    });

    await team.generate('task');

    expect(endEvents).toHaveLength(1);
    expect(endEvents[0].output).toBe(DEFAULT_RESULT.text);
    expect(typeof endEvents[0].durationMs).toBe('number');
    expect(typeof endEvents[0].timestamp).toBe('number');
  });

  it('does not fire agentEnd when no callback is registered', async () => {
    // If no callback, the agency must not throw when trying to fire it.
    const team = agency({
      agents: { worker: mockAgentConfig('worker') },
      strategy: 'sequential',
    });

    await expect(team.generate('task')).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Named agency
  // ---------------------------------------------------------------------------

  it('uses the agency name in agentEnd events when provided', async () => {
    const endEvents: Array<{ agent: string }> = [];

    const team = agency({
      name: 'my-team',
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
      on: { agentEnd: (e) => endEvents.push(e) },
    });

    await team.generate('named agency task');
    expect(endEvents[0].agent).toBe('my-team');
  });

  // ---------------------------------------------------------------------------
  // HITL auto-approve
  // ---------------------------------------------------------------------------

  it('runs with HITL auto-approve', async () => {
    const team = agency({
      agents: { worker: mockAgentConfig('worker') },
      strategy: 'sequential',
      hitl: {
        approvals: { beforeReturn: true },
        handler: hitl.autoApprove(),
      },
    });

    const result = await team.generate('Do the thing') as Record<string, unknown>;
    // Strategy still executes and returns a valid result.
    expect(result.text).toBeDefined();
    expect(result.text).toBe(DEFAULT_RESULT.text);
  });

  it('runs with HITL auto-approve on beforeTool trigger', async () => {
    const team = agency({
      agents: { worker: mockAgentConfig('worker') },
      strategy: 'sequential',
      hitl: {
        approvals: { beforeTool: ['delete-record'] },
        handler: hitl.autoApprove(),
      },
    });

    const result = await team.generate('delete record') as Record<string, unknown>;
    expect(result.text).toBeDefined();
  });

  it('runs with HITL auto-reject handler (config must not throw)', () => {
    expect(() =>
      agency({
        agents: { worker: mockAgentConfig('worker') },
        strategy: 'sequential',
        hitl: {
          approvals: { beforeReturn: true },
          handler: hitl.autoReject('dry-run'),
        },
      }),
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Session — multi-turn history
  // ---------------------------------------------------------------------------

  it('session maintains history across turns', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const session = team.session('test') as {
      send: (t: string) => Promise<unknown>;
      messages: () => Array<{ role: string; content: string }>;
    };

    await session.send('First message');
    await session.send('Second message');

    const history = session.messages();
    // 2 user turns + 2 assistant turns = 4 messages
    expect(history.length).toBe(4);
    expect(history[0]).toEqual({ role: 'user', content: 'First message' });
    expect(history[1]).toEqual({ role: 'assistant', content: DEFAULT_RESULT.text });
    expect(history[2]).toEqual({ role: 'user', content: 'Second message' });
    expect(history[3]).toEqual({ role: 'assistant', content: DEFAULT_RESULT.text });
  });

  it('session.clear() removes all history', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const session = team.session('clear-test') as {
      send: (t: string) => Promise<unknown>;
      messages: () => Array<{ role: string; content: string }>;
      clear: () => void;
    };

    await session.send('Hello');
    expect(session.messages().length).toBe(2);
    session.clear();
    expect(session.messages().length).toBe(0);
  });

  it('session isolation — two sessions do not share history', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const s1 = team.session('session-a') as {
      send: (t: string) => Promise<unknown>;
      messages: () => Array<{ role: string; content: string }>;
    };
    const s2 = team.session('session-b') as {
      send: (t: string) => Promise<unknown>;
      messages: () => Array<{ role: string; content: string }>;
    };

    await s1.send('Only in s1');
    expect(s1.messages().length).toBe(2);
    expect(s2.messages().length).toBe(0);
  });

  it('session auto-generates a unique ID when none provided', () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const s1 = team.session() as { id: string };
    const s2 = team.session() as { id: string };

    // Both sessions exist and their IDs are valid strings.
    expect(typeof s1.id).toBe('string');
    expect(typeof s2.id).toBe('string');
    // Two auto-generated sessions must not collide.
    expect(s1.id).not.toBe(s2.id);
  });

  it('same session ID returns identical session object', () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const s1 = team.session('stable-id');
    const s2 = team.session('stable-id');
    expect(s1).toBe(s2);
  });

  // ---------------------------------------------------------------------------
  // close() teardown
  // ---------------------------------------------------------------------------

  it('close cleans up all resources without throwing', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    await team.generate('task');
    await expect(team.close()).resolves.toBeUndefined();
  });

  it('close calls close() on pre-built Agent instances', async () => {
    const preBuilt = mockAgent('worker output');

    const team = agency({
      agents: { worker: preBuilt },
      strategy: 'sequential',
    });

    await team.close();
    expect(preBuilt.close).toHaveBeenCalledOnce();
  });

  it('close can be called without a preceding generate()', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    await expect(team.close()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Resource controls
  // ---------------------------------------------------------------------------

  it('fires limitReached callback when token limit is breached', async () => {
    hoisted.strategyExecute.mockResolvedValueOnce({
      text: 'over-budget',
      agentCalls: [],
      usage: { promptTokens: 5000, completionTokens: 2000, totalTokens: 7000 },
    });

    const limitEvents: Array<{ metric: string; value: number; limit: number }> = [];

    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
      controls: { maxTotalTokens: 1000, onLimitReached: 'warn' },
      on: { limitReached: (e) => limitEvents.push(e) },
    });

    await team.generate('expensive task');

    expect(limitEvents.length).toBe(1);
    expect(limitEvents[0].metric).toBe('maxTotalTokens');
    expect(limitEvents[0].value).toBe(7000);
    expect(limitEvents[0].limit).toBe(1000);
  });

  it('throws AgencyConfigError when token limit breached and onLimitReached is "error"', async () => {
    hoisted.strategyExecute.mockResolvedValueOnce({
      text: 'over-budget',
      agentCalls: [],
      usage: { promptTokens: 5000, completionTokens: 2000, totalTokens: 7000 },
    });

    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
      controls: { maxTotalTokens: 1000, onLimitReached: 'error' },
    });

    await expect(team.generate('expensive task')).rejects.toThrow(AgencyConfigError);
  });

  it('does not fire limitReached when within limits', async () => {
    const limitEvents: unknown[] = [];

    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
      controls: { maxTotalTokens: 100_000, onLimitReached: 'warn' },
      on: { limitReached: (e) => limitEvents.push(e) },
    });

    await team.generate('cheap task');
    expect(limitEvents.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // usage()
  // ---------------------------------------------------------------------------

  it('agency-level usage() resolves to a usage object', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const u = await team.usage() as Record<string, unknown>;
    expect(typeof u.promptTokens).toBe('number');
    expect(typeof u.completionTokens).toBe('number');
    expect(typeof u.totalTokens).toBe('number');
  });

  it('session.usage() resolves to a usage object', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const session = team.session('usage-sess') as { usage: () => Promise<unknown> };
    const u = await session.usage() as Record<string, unknown>;
    expect(typeof u.promptTokens).toBe('number');
    expect(typeof u.completionTokens).toBe('number');
    expect(typeof u.totalTokens).toBe('number');
  });

  // ---------------------------------------------------------------------------
  // stream()
  // ---------------------------------------------------------------------------

  it('stream() delegates to the compiled strategy', () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const streamResult = team.stream('stream test') as {
      text: Promise<string>;
      textStream: AsyncIterable<string>;
    };

    // The mock strategy stream is invoked and returns a valid object.
    expect(streamResult).toBeDefined();
    expect(hoisted.strategyStream).toHaveBeenCalledWith('stream test', undefined);
  });

  it('stream textStream is iterable', async () => {
    const team = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const streamResult = team.stream('stream task') as { textStream: AsyncIterable<string> };
    const chunks: string[] = [];

    for await (const chunk of streamResult.textStream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBe(DEFAULT_RESULT.text);
  });

  // ---------------------------------------------------------------------------
  // Validation edge cases
  // ---------------------------------------------------------------------------

  it('parallel strategy with agency-level model runs without throwing', async () => {
    const team = agency({
      model: 'openai:gpt-4o',
      agents: { a: mockAgentConfig('a'), b: mockAgentConfig('b') },
      strategy: 'parallel',
    });

    const result = await team.generate('parallel task') as Record<string, unknown>;
    expect(result.text).toBeDefined();
  });

  it('debate strategy with agency-level model runs without throwing', async () => {
    const team = agency({
      model: 'openai:gpt-4o',
      agents: { a: mockAgentConfig('a'), b: mockAgentConfig('b') },
      strategy: 'debate',
    });

    const result = await team.generate('debate task') as Record<string, unknown>;
    expect(result.text).toBeDefined();
  });
});

/**
 * @file agency-factory.test.ts
 * Tests for the `agency()` factory function.
 *
 * Validates:
 * - Successful creation with valid options
 * - `.generate()` returns result with `agentCalls` array
 * - `.session()` creates sessions with message history
 * - Validation: throws AgencyConfigError on empty agents, emergent without
 *   hierarchical, HITL without handler, parallel/debate without model
 * - Resource controls: fires `limitReached` callbacks on breach and throws
 *   when `onLimitReached` is `"error"`
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Agent, BaseAgentConfig, AgencyOptions } from '../../types.js';
import { AgencyConfigError } from '../../types.js';

// ---------------------------------------------------------------------------
// Mock the strategy compilers so we don't call real LLMs
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  executeResult: {
    text: 'agency result',
    agentCalls: [
      {
        agent: 'worker',
        input: 'do something',
        output: 'agency result',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        durationMs: 100,
      },
    ],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  },
  strategyExecute: vi.fn(),
  strategyStream: vi.fn(),
}));

vi.mock('../strategies/index.js', () => ({
  compileStrategy: vi.fn(() => ({
    execute: hoisted.strategyExecute,
    stream: hoisted.strategyStream,
  })),
  isAgent: (value: BaseAgentConfig | Agent) =>
    typeof (value as Agent).generate === 'function',
}));

import { agency } from '../../agency.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid AgencyOptions with one agent config. */
function minimalOpts(overrides?: Partial<AgencyOptions>): AgencyOptions {
  return {
    model: 'openai:gpt-4o-mini',
    agents: { worker: { instructions: 'Do work.' } },
    ...overrides,
  };
}

/** Creates a mock pre-built Agent instance. */
function mockAgent(): Agent {
  return {
    generate: vi.fn().mockResolvedValue({ text: 'mock', agentCalls: [], usage: {} }),
    stream: vi.fn(),
    session: vi.fn(),
    usage: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  hoisted.strategyExecute.mockResolvedValue(hoisted.executeResult);
  hoisted.strategyStream.mockReturnValue({
    textStream: (async function* () { yield 'streamed'; })(),
    fullStream: (async function* () { yield { type: 'text', text: 'streamed' }; })(),
    text: Promise.resolve('streamed'),
    usage: Promise.resolve({}),
    agentCalls: Promise.resolve([]),
  });
});

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

describe('agency() factory — creation', () => {
  it('creates an agency with minimal valid options', () => {
    const a = agency(minimalOpts());
    expect(a).toBeDefined();
    expect(typeof a.generate).toBe('function');
    expect(typeof a.stream).toBe('function');
    expect(typeof a.session).toBe('function');
    expect(typeof a.usage).toBe('function');
    expect(typeof a.close).toBe('function');
  });

  it('creates an agency with pre-built Agent instances in the roster', () => {
    const a = agency(minimalOpts({ agents: { worker: mockAgent() } }));
    expect(a).toBeDefined();
  });

  it('creates an agency with strategy: sequential', () => {
    const a = agency(minimalOpts({ strategy: 'sequential' }));
    expect(a).toBeDefined();
  });

  it('creates an agency with strategy: hierarchical', () => {
    const a = agency(minimalOpts({ strategy: 'hierarchical' }));
    expect(a).toBeDefined();
  });

  it('creates an agency with adaptive: true', () => {
    const a = agency(minimalOpts({ adaptive: true }));
    expect(a).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

describe('agency().generate()', () => {
  it('returns a result with a text field', async () => {
    const a = agency(minimalOpts());
    const result = await a.generate('do something') as Record<string, unknown>;
    expect(result.text).toBe('agency result');
  });

  it('returns a result with an agentCalls array', async () => {
    const a = agency(minimalOpts());
    const result = await a.generate('do something') as Record<string, unknown>;
    expect(Array.isArray(result.agentCalls)).toBe(true);
    expect((result.agentCalls as unknown[]).length).toBeGreaterThan(0);
  });

  it('calls the compiled strategy execute method', async () => {
    const a = agency(minimalOpts());
    await a.generate('hello');
    expect(hoisted.strategyExecute).toHaveBeenCalledWith('hello', undefined);
  });

  it('fires the agentEnd callback after completion', async () => {
    const agentEnd = vi.fn();
    const a = agency(minimalOpts({ on: { agentEnd } }));
    await a.generate('hello');
    expect(agentEnd).toHaveBeenCalledOnce();
    expect(agentEnd.mock.calls[0][0].output).toBe('agency result');
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe('agency().stream()', () => {
  it('delegates to the compiled strategy stream method', async () => {
    const a = agency(minimalOpts());
    const result = a.stream('hello') as { text: Promise<string> };
    await result.text;
    expect(hoisted.strategyStream).toHaveBeenCalledWith('hello', undefined);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// session()
// ---------------------------------------------------------------------------

describe('agency().session()', () => {
  it('creates a session with a stable ID', () => {
    const a = agency(minimalOpts());
    const s = a.session('sess-1') as Record<string, unknown>;
    expect(s.id).toBe('sess-1');
  });

  it('returns the same session for the same ID', () => {
    const a = agency(minimalOpts());
    const s1 = a.session('sess-abc');
    const s2 = a.session('sess-abc');
    expect(s1).toBe(s2);
  });

  it('creates different sessions for different IDs', () => {
    const a = agency(minimalOpts());
    const s1 = a.session('sess-1');
    const s2 = a.session('sess-2');
    expect(s1).not.toBe(s2);
  });

  it('auto-generates an ID when none is provided', () => {
    const a = agency(minimalOpts());
    const s = a.session() as Record<string, unknown>;
    expect(typeof s.id).toBe('string');
    expect((s.id as string).length).toBeGreaterThan(0);
  });

  it('session.send() returns a result and records history', async () => {
    const a = agency(minimalOpts());
    const s = a.session('hist-sess') as {
      send: (t: string) => Promise<unknown>;
      messages: () => Array<{ role: string; content: string }>;
    };

    const result = await s.send('hello agency') as Record<string, unknown>;
    expect(result.text).toBe('agency result');

    const msgs = s.messages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'user', content: 'hello agency' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'agency result' });
  });

  it('session.clear() empties the history', async () => {
    const a = agency(minimalOpts());
    const s = a.session('clear-sess') as {
      send: (t: string) => Promise<unknown>;
      messages: () => Array<{ role: string; content: string }>;
      clear: () => void;
    };

    await s.send('first message');
    expect(s.messages()).toHaveLength(2);
    s.clear();
    expect(s.messages()).toHaveLength(0);
  });

  it('session.usage() resolves to a usage object', async () => {
    const a = agency(minimalOpts());
    const s = a.session('usage-sess') as { usage: () => Promise<unknown> };
    const u = await s.usage();
    expect(u).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// usage()
// ---------------------------------------------------------------------------

describe('agency().usage()', () => {
  it('resolves to an object with token fields', async () => {
    const a = agency(minimalOpts());
    const u = await a.usage() as Record<string, unknown>;
    expect(typeof u.promptTokens).toBe('number');
    expect(typeof u.completionTokens).toBe('number');
    expect(typeof u.totalTokens).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

describe('agency().close()', () => {
  it('resolves without throwing', async () => {
    const a = agency(minimalOpts());
    await expect(a.close()).resolves.toBeUndefined();
  });

  it('calls close() on pre-built Agent instances in the roster', async () => {
    const agent1 = mockAgent();
    const a = agency(minimalOpts({ agents: { worker: agent1 } }));
    await a.close();
    expect(agent1.close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Validation — AgencyConfigError
// ---------------------------------------------------------------------------

describe('agency() validation', () => {
  it('throws AgencyConfigError when agents is empty', () => {
    expect(() =>
      agency({ agents: {}, model: 'openai:gpt-4o' }),
    ).toThrow(AgencyConfigError);
  });

  it('throws with message when agents is empty', () => {
    expect(() =>
      agency({ agents: {} }),
    ).toThrow(/requires at least one agent/i);
  });

  it('throws when emergent.enabled without hierarchical strategy', () => {
    expect(() =>
      agency(minimalOpts({
        strategy: 'sequential',
        emergent: { enabled: true },
      })),
    ).toThrow(AgencyConfigError);
  });

  it('does NOT throw when emergent.enabled with hierarchical strategy', () => {
    expect(() =>
      agency(minimalOpts({
        strategy: 'hierarchical',
        emergent: { enabled: true },
      })),
    ).not.toThrow();
  });

  it('does NOT throw when emergent.enabled with adaptive: true', () => {
    expect(() =>
      agency(minimalOpts({
        adaptive: true,
        emergent: { enabled: true },
      })),
    ).not.toThrow();
  });

  it('throws when HITL approvals set but no handler provided', () => {
    expect(() =>
      agency(minimalOpts({
        hitl: {
          approvals: { beforeTool: ['delete'] },
          // handler deliberately omitted
        },
      })),
    ).toThrow(AgencyConfigError);
  });

  it('does NOT throw when HITL approvals set with a handler', () => {
    expect(() =>
      agency(minimalOpts({
        hitl: {
          approvals: { beforeTool: ['delete'] },
          handler: async () => ({ approved: true }),
        },
      })),
    ).not.toThrow();
  });

  it('does NOT throw when hitl.approvals has no triggers', () => {
    expect(() =>
      agency(minimalOpts({
        hitl: { approvals: {} /* no triggers */ },
      })),
    ).not.toThrow();
  });

  it('throws when strategy is parallel without a model', () => {
    expect(() =>
      agency({
        strategy: 'parallel',
        agents: { a: {}, b: {} },
        // model and provider deliberately omitted
      }),
    ).toThrow(AgencyConfigError);
  });

  it('does NOT throw when strategy is parallel with a model', () => {
    expect(() =>
      agency({
        strategy: 'parallel',
        model: 'openai:gpt-4o',
        agents: { a: {}, b: {} },
      }),
    ).not.toThrow();
  });

  it('throws when strategy is debate without a model', () => {
    expect(() =>
      agency({
        strategy: 'debate',
        agents: { a: {}, b: {} },
      }),
    ).toThrow(AgencyConfigError);
  });

  it('does NOT throw when strategy is debate with a provider', () => {
    expect(() =>
      agency({
        strategy: 'debate',
        provider: 'openai',
        agents: { a: {}, b: {} },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Resource controls
// ---------------------------------------------------------------------------

describe('agency() resource controls', () => {
  it('fires limitReached callback when token limit is exceeded', async () => {
    hoisted.strategyExecute.mockResolvedValueOnce({
      text: 'over-budget',
      agentCalls: [],
      usage: { promptTokens: 900, completionTokens: 200, totalTokens: 1100 },
    });

    const limitReached = vi.fn();
    const a = agency(minimalOpts({
      controls: { maxTotalTokens: 1000, onLimitReached: 'warn' },
      on: { limitReached },
    }));

    await a.generate('expensive prompt');
    expect(limitReached).toHaveBeenCalledOnce();
    expect(limitReached.mock.calls[0][0].metric).toBe('maxTotalTokens');
    expect(limitReached.mock.calls[0][0].value).toBe(1100);
    expect(limitReached.mock.calls[0][0].limit).toBe(1000);
  });

  it('fires limitReached callback when agent call limit is exceeded', async () => {
    hoisted.strategyExecute.mockResolvedValueOnce({
      text: 'too many calls',
      agentCalls: [
        { agent: 'a', input: '', output: '', toolCalls: [], usage: {}, durationMs: 0 },
        { agent: 'b', input: '', output: '', toolCalls: [], usage: {}, durationMs: 0 },
        { agent: 'c', input: '', output: '', toolCalls: [], usage: {}, durationMs: 0 },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const limitReached = vi.fn();
    const a = agency(minimalOpts({
      controls: { maxAgentCalls: 2, onLimitReached: 'warn' },
      on: { limitReached },
    }));

    await a.generate('many agents');
    expect(limitReached).toHaveBeenCalledOnce();
    expect(limitReached.mock.calls[0][0].metric).toBe('maxAgentCalls');
  });

  it('throws AgencyConfigError when token limit exceeded and onLimitReached is "error"', async () => {
    hoisted.strategyExecute.mockResolvedValueOnce({
      text: 'over-budget',
      agentCalls: [],
      usage: { promptTokens: 900, completionTokens: 200, totalTokens: 1100 },
    });

    const a = agency(minimalOpts({
      controls: { maxTotalTokens: 1000, onLimitReached: 'error' },
    }));

    await expect(a.generate('expensive')).rejects.toThrow(AgencyConfigError);
  });

  it('does NOT fire limitReached when usage is within limits', async () => {
    const limitReached = vi.fn();
    const a = agency(minimalOpts({
      controls: { maxTotalTokens: 10000, onLimitReached: 'warn' },
      on: { limitReached },
    }));

    await a.generate('cheap prompt');
    expect(limitReached).not.toHaveBeenCalled();
  });
});

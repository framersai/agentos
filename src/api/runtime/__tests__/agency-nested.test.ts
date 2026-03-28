/**
 * @file agency-nested.test.ts
 * Tests for nested agency behaviour and emergent agent validation.
 *
 * Nested agencies: an `agency()` instance may be placed directly inside another
 * agency's `agents` roster because it satisfies the `Agent` interface
 * (`generate`, `stream`, `session`, `usage`, `close`).  These tests verify that
 * the outer sequential strategy treats the inner agency as a single opaque agent
 * call and that the final result still carries a populated `agentCalls` array.
 *
 * Emergent tests confirm that `emergent.enabled` is only permitted when the
 * strategy is `"hierarchical"` or `adaptive: true` is set.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Agent, BaseAgentConfig, AgencyOptions } from '../../types.js';
import { AgencyConfigError } from '../../types.js';

// ---------------------------------------------------------------------------
// Mock the strategy compiler so tests never call a real LLM
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  /**
   * Tracks how many times execute() has been called so we can assert call
   * counts and control what each invocation returns.
   */
  strategyExecute: vi.fn(),
  strategyStream: vi.fn(),
}));

/**
 * Replace the entire strategies/index.js module with a minimal stub.
 * `compileStrategy` returns a single compiled strategy whose `execute` and
 * `stream` methods are the hoisted spies above.
 * `isAgent` mirrors the real implementation — it checks for a `generate`
 * method — so that pre-built Agent instances (including nested agencies) are
 * handled correctly by `agency().close()`.
 */
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

/**
 * Returns a minimal `BaseAgentConfig` identified by `name`.
 * The instructions field makes the config easy to identify in assertions.
 *
 * @param name - Human-readable agent name embedded in the instructions string.
 */
function mockAgentConfig(name: string): BaseAgentConfig {
  return { instructions: `You are ${name}.` };
}

/**
 * Creates a pre-built mock `Agent` that returns a fixed text result.
 *
 * @param text - The text the mock's `generate()` resolves with.
 * @param agentCalls - Optional agent call records to include in the result.
 * @param usage - Optional usage counts to include in the result.
 */
function mockAgent(
  text: string,
  agentCalls: Array<Record<string, unknown>> = [],
  usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
): Agent {
  return {
    generate: vi.fn().mockResolvedValue({ text, agentCalls, usage }),
    stream: vi.fn().mockReturnValue({
      textStream: (async function* () { yield text; })(),
      fullStream: (async function* () { yield { type: 'text', text }; })(),
      text: Promise.resolve(text),
      usage: Promise.resolve(usage),
    }),
    session: vi.fn(),
    usage: vi.fn().mockResolvedValue(usage),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/** Default execute result used across most tests. */
const DEFAULT_RESULT = {
  text: 'nested result',
  agentCalls: [
    {
      agent: 'inner',
      input: 'task',
      output: 'nested result',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      durationMs: 50,
    },
    {
      agent: 'outer-c',
      input: 'nested result',
      output: 'final',
      toolCalls: [],
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      durationMs: 40,
    },
  ],
  usage: { promptTokens: 18, completionTokens: 9, totalTokens: 27 },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  hoisted.strategyExecute.mockResolvedValue(DEFAULT_RESULT);
  hoisted.strategyStream.mockReturnValue({
    textStream: (async function* () { yield DEFAULT_RESULT.text; })(),
    fullStream: (async function* () { yield { type: 'text', text: DEFAULT_RESULT.text }; })(),
    text: Promise.resolve(DEFAULT_RESULT.text),
    usage: Promise.resolve(DEFAULT_RESULT.usage),
  });
});

// ---------------------------------------------------------------------------
// Nested Agencies
// ---------------------------------------------------------------------------

describe('Nested Agencies', () => {
  it('runs an agency as a sub-agent in another agency', async () => {
    /*
     * The inner agency satisfies the `Agent` interface, so the outer agency's
     * roster treats it as a pre-built agent.  The mock strategy execute is
     * shared; the outer call must return agentCalls with at least two entries
     * (one for the inner agency as a whole, one for outer-c).
     */
    const inner = agency({
      agents: { a: mockAgentConfig('inner-a'), b: mockAgentConfig('inner-b') },
      strategy: 'sequential',
    });

    const outer = agency({
      agents: { inner, c: mockAgentConfig('outer-c') },
      strategy: 'sequential',
    });

    const result = await outer.generate('task') as Record<string, unknown>;

    expect(result.agentCalls).toBeDefined();
    expect(Array.isArray(result.agentCalls)).toBe(true);
    expect((result.agentCalls as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('returns text from the outermost agency', async () => {
    const inner = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const outer = agency({
      agents: { inner, b: mockAgentConfig('b') },
      strategy: 'sequential',
    });

    const result = await outer.generate('get text') as Record<string, unknown>;
    expect(typeof result.text).toBe('string');
    expect(result.text).toBe(DEFAULT_RESULT.text);
  });

  it('aggregates usage across nested levels', async () => {
    /*
     * The mock strategy returns a pre-merged usage object that represents the
     * sum of inner + outer calls.  The outer agency must surface that object
     * unchanged through the generate() path.
     */
    const inner = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const outer = agency({
      agents: { inner, b: mockAgentConfig('b') },
      strategy: 'sequential',
    });

    const result = await outer.generate('usage check') as Record<string, unknown>;
    const usage = result.usage as { promptTokens: number; completionTokens: number; totalTokens: number };

    // The mock returns totalTokens = 27 (18 + 9).
    expect(usage.totalTokens).toBe(DEFAULT_RESULT.usage.totalTokens);
    expect(typeof usage.promptTokens).toBe('number');
    expect(typeof usage.completionTokens).toBe('number');
  });

  it('nests 3 levels deep', async () => {
    /*
     * A three-level nesting: level1 is passed as a sub-agent of level2, which
     * is passed as a sub-agent of level3.  Each wrapping layer is still an
     * `Agent` from the outer agency's perspective.
     */
    const level1 = agency({ agents: { a: mockAgentConfig('a') }, strategy: 'sequential' });
    const level2 = agency({ agents: { level1, b: mockAgentConfig('b') }, strategy: 'sequential' });
    const level3 = agency({ agents: { level2, c: mockAgentConfig('c') }, strategy: 'sequential' });

    const result = await level3.generate('deep task') as Record<string, unknown>;

    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
  });

  it('close() propagates to nested pre-built Agency instances', async () => {
    /*
     * `agency().close()` iterates `opts.agents` and calls `close()` on any
     * value that satisfies `isAgent`.  Since the inner agency satisfies
     * `isAgent`, its `close()` method must be invoked.
     */
    const inner = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    // Spy on the inner agency's close method.
    const innerCloseSpy = vi.spyOn(inner, 'close');

    const outer = agency({
      agents: { inner },
      strategy: 'sequential',
    });

    await outer.close();
    expect(innerCloseSpy).toHaveBeenCalledOnce();
  });

  it('passes generate opts through to the strategy execute', async () => {
    const inner = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const outer = agency({
      agents: { inner },
      strategy: 'sequential',
    });

    const opts = { temperature: 0.5 };
    await outer.generate('opts test', opts);

    // The mocked strategy execute is the one that outer's compiled strategy
    // calls; verify it received the extra options.
    expect(hoisted.strategyExecute).toHaveBeenCalledWith('opts test', opts);
  });

  it('nested agency exposes a session() method', () => {
    const inner = agency({
      agents: { a: mockAgentConfig('a') },
      strategy: 'sequential',
    });

    const outer = agency({
      agents: { inner },
      strategy: 'sequential',
    });

    const session = outer.session('nested-sess') as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(typeof (session as { send: unknown }).send).toBe('function');
    expect(typeof (session as { messages: unknown }).messages).toBe('function');
  });

  it('mixed roster — pre-built mock agent and nested agency', async () => {
    const inner = agency({
      agents: { a: mockAgentConfig('inner-agent') },
      strategy: 'sequential',
    });

    const preBuilt = mockAgent('prebuilt output');

    const outer = agency({
      agents: { inner, preBuilt },
      strategy: 'sequential',
    });

    const result = await outer.generate('mixed task') as Record<string, unknown>;
    expect(result.agentCalls).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Emergent Agent Creation
// ---------------------------------------------------------------------------

describe('Emergent Agent Creation', () => {
  it('validates emergent requires hierarchical or adaptive', () => {
    /*
     * Setting `emergent.enabled` on a sequential (or any non-hierarchical)
     * strategy without `adaptive: true` must throw `AgencyConfigError` whose
     * message contains "emergent".
     */
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        strategy: 'sequential',
        emergent: { enabled: true },
      }),
    ).toThrow(AgencyConfigError);
  });

  it('throws with a message mentioning "emergent"', () => {
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        strategy: 'sequential',
        emergent: { enabled: true },
      }),
    ).toThrow(/emergent/i);
  });

  it('throws for parallel strategy + emergent without adaptive', () => {
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a'), b: mockAgentConfig('b') },
        strategy: 'parallel',
        model: 'openai:gpt-4o',
        emergent: { enabled: true },
      }),
    ).toThrow(AgencyConfigError);
  });

  it('throws for debate strategy + emergent without adaptive', () => {
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a'), b: mockAgentConfig('b') },
        strategy: 'debate',
        model: 'openai:gpt-4o',
        emergent: { enabled: true },
      }),
    ).toThrow(AgencyConfigError);
  });

  it('throws for review-loop strategy + emergent without adaptive', () => {
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('reviewer'), b: mockAgentConfig('writer') },
        strategy: 'review-loop',
        emergent: { enabled: true },
      }),
    ).toThrow(AgencyConfigError);
  });

  it('allows emergent with hierarchical strategy', () => {
    /*
     * `strategy: "hierarchical"` is the explicit approval pathway for emergent
     * agent synthesis — no throw expected.
     */
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        strategy: 'hierarchical',
        emergent: { enabled: true },
      }),
    ).not.toThrow();
  });

  it('allows emergent with adaptive mode on sequential', () => {
    /*
     * When `adaptive: true`, the agency internally routes to hierarchical,
     * which satisfies the emergent precondition.
     */
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        strategy: 'sequential',
        adaptive: true,
        emergent: { enabled: true },
      }),
    ).not.toThrow();
  });

  it('allows emergent with adaptive mode and no explicit strategy', () => {
    /*
     * Strategy defaults to "sequential" but adaptive overrides it.
     * This is a common configuration pattern that must be supported.
     */
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        adaptive: true,
        emergent: { enabled: true },
      }),
    ).not.toThrow();
  });

  it('emergent disabled does not trigger validation', () => {
    /*
     * `emergent: { enabled: false }` must never throw regardless of strategy,
     * because the feature is simply turned off.
     */
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        strategy: 'sequential',
        emergent: { enabled: false },
      }),
    ).not.toThrow();
  });

  it('omitting emergent entirely does not throw', () => {
    expect(() =>
      agency({
        agents: { a: mockAgentConfig('a') },
        strategy: 'sequential',
      }),
    ).not.toThrow();
  });

  it('emergent tier config does not affect validation on hierarchical', () => {
    /*
     * All emergent tier values ('session', 'agent', 'shared') are valid when
     * the strategy allows emergent agents.
     */
    for (const tier of ['session', 'agent', 'shared'] as const) {
      expect(() =>
        agency({
          agents: { a: mockAgentConfig('a') },
          strategy: 'hierarchical',
          emergent: { enabled: true, tier },
        }),
      ).not.toThrow();
    }
  });
});

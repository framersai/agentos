/**
 * @file agency.test.ts
 * Tests for the sequential and parallel strategy compilers.
 *
 * Uses mock agents to isolate strategy logic from actual LLM calls.
 * Each mock agent returns deterministic text, usage, and tool call data
 * so that aggregation and chaining logic can be verified precisely.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Agent, AgentCallRecord, AgencyOptions, BaseAgentConfig } from '../types.js';
import { AgencyConfigError } from '../types.js';

/* ------------------------------------------------------------------ */
/* Hoist mocks so agent() calls inside strategy compilers are captured */
/* ------------------------------------------------------------------ */

const hoisted = vi.hoisted(() => ({
  agentGenerate: vi.fn(),
}));

/**
 * Mock the agent factory so `createAgent()` calls inside the strategy
 * compilers return our controllable mock. The mock tracks call order
 * via the `agentGenerate` spy.
 */
vi.mock('../agent.js', () => ({
  agent: vi.fn(() => ({
    generate: hoisted.agentGenerate,
    stream: vi.fn(),
    session: vi.fn(),
    usage: vi.fn(),
    close: vi.fn(),
  })),
}));

import { compileSequential } from '../strategies/sequential.js';
import { compileParallel } from '../strategies/parallel.js';
import { compileStrategy, isAgent } from '../strategies/index.js';

/* ------------------------------------------------------------------ */
/* Helper: create a mock pre-built Agent                               */
/* ------------------------------------------------------------------ */

function mockAgent(text: string, usage?: Partial<{ promptTokens: number; completionTokens: number; totalTokens: number }>): Agent {
  const u = {
    promptTokens: usage?.promptTokens ?? 10,
    completionTokens: usage?.completionTokens ?? 5,
    totalTokens: usage?.totalTokens ?? 15,
  };
  return {
    generate: vi.fn().mockResolvedValue({ text, usage: u, toolCalls: [] }),
    stream: vi.fn(),
    session: vi.fn(),
    usage: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/* ------------------------------------------------------------------ */
/* isAgent guard                                                       */
/* ------------------------------------------------------------------ */

describe('isAgent', () => {
  it('returns true for objects with a generate function', () => {
    expect(isAgent(mockAgent('hi'))).toBe(true);
  });

  it('returns false for plain config objects', () => {
    const config: BaseAgentConfig = { model: 'openai:gpt-4o' };
    expect(isAgent(config)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* compileStrategy dispatcher                                          */
/* ------------------------------------------------------------------ */

describe('compileStrategy', () => {
  it('dispatches "sequential" to compileSequential', () => {
    const strategy = compileStrategy(
      'sequential',
      { a: mockAgent('ok') },
      { agents: { a: mockAgent('ok') } } as AgencyOptions,
    );
    expect(strategy).toHaveProperty('execute');
    expect(strategy).toHaveProperty('stream');
  });

  it('dispatches "parallel" to compileParallel', () => {
    const strategy = compileStrategy(
      'parallel',
      { a: mockAgent('ok') },
      { agents: { a: mockAgent('ok') }, model: 'openai:gpt-4o' } as AgencyOptions,
    );
    expect(strategy).toHaveProperty('execute');
  });

  it('throws for unimplemented strategies', () => {
    expect(() =>
      compileStrategy(
        'debate',
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(/not yet implemented/);
  });
});

/* ------------------------------------------------------------------ */
/* Sequential Strategy                                                 */
/* ------------------------------------------------------------------ */

describe('Sequential Strategy', () => {
  it('runs agents in declaration order', async () => {
    const callOrder: string[] = [];
    const agentA: Agent = {
      generate: vi.fn().mockImplementation(async () => {
        callOrder.push('a');
        return { text: 'A output', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, toolCalls: [] };
      }),
      stream: vi.fn(),
      session: vi.fn(),
      usage: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const agentB: Agent = {
      generate: vi.fn().mockImplementation(async () => {
        callOrder.push('b');
        return { text: 'B output', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 }, toolCalls: [] };
      }),
      stream: vi.fn(),
      session: vi.fn(),
      usage: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const agencyConfig = { agents: { a: agentA, b: agentB } } as AgencyOptions;
    const strategy = compileSequential({ a: agentA, b: agentB }, agencyConfig);
    await strategy.execute('test prompt');

    expect(callOrder).toEqual(['a', 'b']);
  });

  it('passes previous output as context to the next agent', async () => {
    const agentA = mockAgent('first result');
    const agentB = mockAgent('final result');

    const agencyConfig = { agents: { a: agentA, b: agentB } } as AgencyOptions;
    const strategy = compileSequential({ a: agentA, b: agentB }, agencyConfig);
    await strategy.execute('do the thing');

    /* Agent A receives the raw prompt. */
    expect(agentA.generate).toHaveBeenCalledWith('do the thing', undefined);

    /* Agent B receives chained context including A's output. */
    const bInput = (agentB.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(bInput).toContain('Original task: do the thing');
    expect(bInput).toContain('Previous agent (a) output:');
    expect(bInput).toContain('first result');
  });

  it('collects agentCalls for every agent', async () => {
    const agentA = mockAgent('output A');
    const agentB = mockAgent('output B');

    const agencyConfig = { agents: { a: agentA, b: agentB } } as AgencyOptions;
    const strategy = compileSequential({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('task')) as { agentCalls: AgentCallRecord[] };

    expect(result.agentCalls).toHaveLength(2);
    expect(result.agentCalls[0].agent).toBe('a');
    expect(result.agentCalls[0].output).toBe('output A');
    expect(result.agentCalls[1].agent).toBe('b');
    expect(result.agentCalls[1].output).toBe('output B');
  });

  it('aggregates usage across all agents', async () => {
    const agentA = mockAgent('A', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const agentB = mockAgent('B', { promptTokens: 200, completionTokens: 80, totalTokens: 280 });

    const agencyConfig = { agents: { a: agentA, b: agentB } } as AgencyOptions;
    const strategy = compileSequential({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('task')) as { usage: { promptTokens: number; completionTokens: number; totalTokens: number } };

    expect(result.usage.promptTokens).toBe(300);
    expect(result.usage.completionTokens).toBe(130);
    expect(result.usage.totalTokens).toBe(430);
  });

  it('records durationMs for each agent call', async () => {
    const agentA: Agent = {
      generate: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { text: 'A', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, toolCalls: [] };
      }),
      stream: vi.fn(),
      session: vi.fn(),
      usage: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const agencyConfig = { agents: { a: agentA } } as AgencyOptions;
    const strategy = compileSequential({ a: agentA }, agencyConfig);
    const result = (await strategy.execute('task')) as { agentCalls: AgentCallRecord[] };

    expect(result.agentCalls[0].durationMs).toBeGreaterThanOrEqual(5);
  });

  it('instantiates raw configs via agent() factory', async () => {
    /*
     * When a raw BaseAgentConfig is passed instead of a pre-built Agent,
     * the strategy should call the mocked agent() factory. The factory mock
     * returns a mock agent backed by hoisted.agentGenerate.
     */
    hoisted.agentGenerate.mockResolvedValue({
      text: 'from config',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const rawConfig: BaseAgentConfig = { model: 'openai:gpt-4o', instructions: 'Be brief.' };
    const agencyConfig = {
      agents: { writer: rawConfig },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileSequential({ writer: rawConfig }, agencyConfig);
    const result = (await strategy.execute('hello')) as { agentCalls: AgentCallRecord[] };

    expect(result.agentCalls).toHaveLength(1);
    expect(result.agentCalls[0].output).toBe('from config');
  });

  it('returns a stream wrapper from the stream method', async () => {
    const agentA = mockAgent('streamed text');
    const agencyConfig = { agents: { a: agentA } } as AgencyOptions;
    const strategy = compileSequential({ a: agentA }, agencyConfig);

    const streamResult = strategy.stream('task') as {
      textStream: AsyncIterable<string>;
      text: Promise<string>;
    };

    const text = await streamResult.text;
    expect(text).toBe('streamed text');
  });
});

/* ------------------------------------------------------------------ */
/* Parallel Strategy                                                   */
/* ------------------------------------------------------------------ */

describe('Parallel Strategy', () => {
  beforeEach(() => {
    hoisted.agentGenerate.mockReset();
  });

  it('throws AgencyConfigError without an agency-level model or provider', () => {
    expect(() =>
      compileParallel(
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(AgencyConfigError);
    expect(() =>
      compileParallel(
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(/agency-level model/i);
  });

  it('runs all agents simultaneously', async () => {
    const startTimes: number[] = [];

    const makeTimedAgent = (text: string): Agent => ({
      generate: vi.fn().mockImplementation(async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 20));
        return { text, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, toolCalls: [] };
      }),
      stream: vi.fn(),
      session: vi.fn(),
      usage: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const agentA = makeTimedAgent('A result');
    const agentB = makeTimedAgent('B result');
    const agentC = makeTimedAgent('C result');

    /* The synthesis step is handled by the mocked agent() factory. */
    hoisted.agentGenerate.mockResolvedValue({
      text: 'synthesized',
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB, c: agentC },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileParallel({ a: agentA, b: agentB, c: agentC }, agencyConfig);
    await strategy.execute('task');

    /*
     * All three agents should have started within a tight window.
     * If they ran sequentially the gap would be >= 20ms per agent.
     */
    const maxGap = Math.max(...startTimes) - Math.min(...startTimes);
    expect(maxGap).toBeLessThan(15);
  });

  it('synthesizes results using the agency-level model', async () => {
    const agentA = mockAgent('alpha output');
    const agentB = mockAgent('beta output');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'combined answer',
      usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
      instructions: 'Focus on accuracy.',
    } as AgencyOptions;

    const strategy = compileParallel({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('research topic')) as { text: string };

    /* The synthesis prompt is passed to the mocked agent factory's generate. */
    const synthInput = hoisted.agentGenerate.mock.calls[0][0] as string;
    expect(synthInput).toContain('alpha output');
    expect(synthInput).toContain('beta output');
    expect(synthInput).toContain('research topic');
    expect(synthInput).toContain('Synthesize');
    expect(synthInput).toContain('Focus on accuracy.');

    expect(result.text).toBe('combined answer');
  });

  it('collects agentCalls for all parallel agents', async () => {
    const agentA = mockAgent('A');
    const agentB = mockAgent('B');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileParallel({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('task')) as { agentCalls: AgentCallRecord[] };

    expect(result.agentCalls).toHaveLength(2);
    expect(result.agentCalls.map((c: AgentCallRecord) => c.agent)).toEqual(['a', 'b']);
    /* All agents received the same prompt. */
    expect(result.agentCalls[0].input).toBe('task');
    expect(result.agentCalls[1].input).toBe('task');
  });

  it('aggregates usage including the synthesis step', async () => {
    const agentA = mockAgent('A', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const agentB = mockAgent('B', { promptTokens: 200, completionTokens: 80, totalTokens: 280 });

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth',
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileParallel({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('task')) as {
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

    /* Agent usage (100+200=300 prompt, 50+80=130 completion, 150+280=430 total) + synthesis (50, 20, 70). */
    expect(result.usage.promptTokens).toBe(350);
    expect(result.usage.completionTokens).toBe(150);
    expect(result.usage.totalTokens).toBe(500);
  });

  it('returns a stream wrapper from the stream method', async () => {
    const agentA = mockAgent('parallel text');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth stream',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileParallel({ a: agentA }, agencyConfig);
    const streamResult = strategy.stream('task') as {
      text: Promise<string>;
    };

    const text = await streamResult.text;
    expect(text).toBe('synth stream');
  });
});

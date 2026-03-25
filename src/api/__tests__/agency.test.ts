/**
 * @file agency.test.ts
 * Tests for all strategy compilers: sequential, parallel, debate,
 * review-loop, hierarchical, and adaptive mode.
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
import { compileDebate } from '../strategies/debate.js';
import { compileReviewLoop } from '../strategies/review-loop.js';
import { compileHierarchical } from '../strategies/hierarchical.js';
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

/**
 * Creates a mock agent whose generate() responses are controlled by a
 * sequence of return values. Each call returns the next value in order.
 */
function mockAgentSequence(responses: Array<{ text: string; usage?: Partial<{ promptTokens: number; completionTokens: number; totalTokens: number }> }>): Agent {
  const gen = vi.fn();
  for (const resp of responses) {
    const u = {
      promptTokens: resp.usage?.promptTokens ?? 10,
      completionTokens: resp.usage?.completionTokens ?? 5,
      totalTokens: resp.usage?.totalTokens ?? 15,
    };
    gen.mockResolvedValueOnce({ text: resp.text, usage: u, toolCalls: [] });
  }
  return {
    generate: gen,
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
  beforeEach(() => {
    hoisted.agentGenerate.mockReset();
  });

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

  it('dispatches "debate" to compileDebate', () => {
    const strategy = compileStrategy(
      'debate',
      { a: mockAgent('ok'), b: mockAgent('ok') },
      { agents: { a: mockAgent('ok'), b: mockAgent('ok') }, model: 'openai:gpt-4o' } as AgencyOptions,
    );
    expect(strategy).toHaveProperty('execute');
    expect(strategy).toHaveProperty('stream');
  });

  it('dispatches "review-loop" to compileReviewLoop', () => {
    const strategy = compileStrategy(
      'review-loop',
      { producer: mockAgent('ok'), reviewer: mockAgent('ok') },
      { agents: { producer: mockAgent('ok'), reviewer: mockAgent('ok') } } as AgencyOptions,
    );
    expect(strategy).toHaveProperty('execute');
  });

  it('dispatches "hierarchical" to compileHierarchical', () => {
    hoisted.agentGenerate.mockResolvedValue({
      text: 'managed',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const strategy = compileStrategy(
      'hierarchical',
      { a: mockAgent('ok') },
      { agents: { a: mockAgent('ok') }, model: 'openai:gpt-4o' } as AgencyOptions,
    );
    expect(strategy).toHaveProperty('execute');
  });

  it('throws for unknown strategies', () => {
    expect(() =>
      compileStrategy(
        'unknown-strategy' as any,
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

/* ------------------------------------------------------------------ */
/* Debate Strategy                                                     */
/* ------------------------------------------------------------------ */

describe('Debate Strategy', () => {
  beforeEach(() => {
    hoisted.agentGenerate.mockReset();
  });

  it('throws AgencyConfigError without an agency-level model or provider', () => {
    expect(() =>
      compileDebate(
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(AgencyConfigError);
    expect(() =>
      compileDebate(
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(/agency-level model/i);
  });

  it('runs multiple rounds of debate', async () => {
    const agentA = mockAgent('A argues');
    const agentB = mockAgent('B argues');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synthesized debate',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
      maxRounds: 2,
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('debate this')) as { agentCalls: AgentCallRecord[] };

    /* 2 rounds * 2 agents = 4 agent calls. */
    expect(result.agentCalls).toHaveLength(4);
    expect(result.agentCalls[0].agent).toBe('a');
    expect(result.agentCalls[1].agent).toBe('b');
    expect(result.agentCalls[2].agent).toBe('a');
    expect(result.agentCalls[3].agent).toBe('b');
  });

  it('each agent sees prior arguments', async () => {
    const agentA = mockAgent('A perspective');
    const agentB = mockAgent('B perspective');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
      maxRounds: 1,
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA, b: agentB }, agencyConfig);
    await strategy.execute('topic');

    /* First agent in round 1 sees "You are the first to argue." */
    const aInput = (agentA.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(aInput).toContain('You are the first to argue.');
    expect(aInput).toContain('Present your perspective as a');

    /* Second agent in round 1 sees agent A's argument. */
    const bInput = (agentB.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(bInput).toContain('Previous arguments:');
    expect(bInput).toContain('[a, round 1]: A perspective');
    expect(bInput).toContain('Present your perspective as b');
  });

  it('respects maxRounds configuration', async () => {
    const agentA = mockAgent('round arg');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    /* Single agent, 5 rounds. */
    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
      maxRounds: 5,
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA }, agencyConfig);
    const result = (await strategy.execute('task')) as { agentCalls: AgentCallRecord[] };

    /* 5 rounds * 1 agent = 5 agent calls. */
    expect(result.agentCalls).toHaveLength(5);
  });

  it('defaults to 3 rounds when maxRounds is not set', async () => {
    const agentA = mockAgent('arg');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA }, agencyConfig);
    const result = (await strategy.execute('task')) as { agentCalls: AgentCallRecord[] };

    expect(result.agentCalls).toHaveLength(3);
  });

  it('synthesizes final result from all arguments', async () => {
    const agentA = mockAgent('thesis');
    const agentB = mockAgent('antithesis');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synthesis of debate',
      usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
      maxRounds: 1,
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('topic')) as { text: string };

    /* The synthesis prompt includes all collected arguments. */
    const synthInput = hoisted.agentGenerate.mock.calls[0][0] as string;
    expect(synthInput).toContain('[a, round 1]: thesis');
    expect(synthInput).toContain('[b, round 1]: antithesis');
    expect(synthInput).toContain('Synthesize these perspectives');

    expect(result.text).toBe('synthesis of debate');
  });

  it('aggregates usage across all rounds plus synthesis', async () => {
    const agentA = mockAgent('A', { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    const agentB = mockAgent('B', { promptTokens: 20, completionTokens: 10, totalTokens: 30 });

    hoisted.agentGenerate.mockResolvedValue({
      text: 'synth',
      usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
      maxRounds: 2,
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('task')) as {
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

    /* 2 rounds: A(10)+B(20)+A(10)+B(20) = 60 prompt, synth(50) = 110 total prompt. */
    expect(result.usage.promptTokens).toBe(110);
    expect(result.usage.completionTokens).toBe(55); /* 5+10+5+10 + 25 */
    expect(result.usage.totalTokens).toBe(165); /* 15+30+15+30 + 75 */
  });

  it('returns a stream wrapper from the stream method', async () => {
    const agentA = mockAgent('debate text');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'debate synth stream',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
      maxRounds: 1,
    } as AgencyOptions;

    const strategy = compileDebate({ a: agentA }, agencyConfig);
    const streamResult = strategy.stream('task') as { text: Promise<string> };

    const text = await streamResult.text;
    expect(text).toBe('debate synth stream');
  });
});

/* ------------------------------------------------------------------ */
/* Review-Loop Strategy                                                */
/* ------------------------------------------------------------------ */

describe('Review-Loop Strategy', () => {
  beforeEach(() => {
    hoisted.agentGenerate.mockReset();
  });

  it('throws AgencyConfigError with fewer than two agents', () => {
    expect(() =>
      compileReviewLoop(
        { producer: mockAgent('ok') },
        { agents: { producer: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(AgencyConfigError);
    expect(() =>
      compileReviewLoop(
        { producer: mockAgent('ok') },
        { agents: { producer: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(/at least two agents/i);
  });

  it('producer creates, reviewer reviews', async () => {
    const producer = mockAgent('draft v1');
    const reviewer = mockAgent(JSON.stringify({ approved: true, feedback: 'Looks good!' }));

    const agencyConfig = {
      agents: { producer, reviewer },
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const result = (await strategy.execute('write a poem')) as { text: string; agentCalls: AgentCallRecord[] };

    /* Producer was called first, then reviewer. */
    expect(result.agentCalls).toHaveLength(2);
    expect(result.agentCalls[0].agent).toBe('producer');
    expect(result.agentCalls[1].agent).toBe('reviewer');

    /* The final text is the producer's draft. */
    expect(result.text).toBe('draft v1');
  });

  it('loops on rejection until approved', async () => {
    /* Producer generates two drafts (one per round). */
    const producer = mockAgentSequence([
      { text: 'draft v1' },
      { text: 'draft v2' },
    ]);

    /* Reviewer rejects first, approves second. */
    const reviewer = mockAgentSequence([
      { text: JSON.stringify({ approved: false, feedback: 'Needs more detail.' }) },
      { text: JSON.stringify({ approved: true, feedback: 'Great!' }) },
    ]);

    const agencyConfig = {
      agents: { producer, reviewer },
      maxRounds: 5,
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const result = (await strategy.execute('write code')) as { text: string; agentCalls: AgentCallRecord[] };

    /* 2 rounds * 2 agents = 4 agent calls. */
    expect(result.agentCalls).toHaveLength(4);
    expect(result.text).toBe('draft v2');

    /* Second producer call should include feedback from the first review. */
    const secondProdInput = (producer.generate as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondProdInput).toContain('Needs more detail.');
    expect(secondProdInput).toContain('Revise your work');
  });

  it('stops on approval in the first round', async () => {
    const producer = mockAgent('perfect draft');
    const reviewer = mockAgent(JSON.stringify({ approved: true, feedback: 'Perfect!' }));

    const agencyConfig = {
      agents: { producer, reviewer },
      maxRounds: 5,
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const result = (await strategy.execute('task')) as { agentCalls: AgentCallRecord[] };

    /* Only 1 round (producer + reviewer) since approved immediately. */
    expect(result.agentCalls).toHaveLength(2);
    expect(producer.generate).toHaveBeenCalledTimes(1);
    expect(reviewer.generate).toHaveBeenCalledTimes(1);
  });

  it('respects maxRounds and returns last draft on exhaustion', async () => {
    /* Producer always produces, reviewer always rejects. */
    const producer = mockAgent('endless draft');
    const reviewer = mockAgent(JSON.stringify({ approved: false, feedback: 'Still not right.' }));

    const agencyConfig = {
      agents: { producer, reviewer },
      maxRounds: 2,
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const result = (await strategy.execute('task')) as { text: string; agentCalls: AgentCallRecord[] };

    /* 2 rounds * 2 agents = 4 calls. */
    expect(result.agentCalls).toHaveLength(4);
    expect(result.text).toBe('endless draft');
  });

  it('treats non-JSON reviewer output as feedback (rejection)', async () => {
    const producer = mockAgentSequence([
      { text: 'initial draft' },
      { text: 'revised draft' },
    ]);
    const reviewer = mockAgentSequence([
      { text: 'This needs work. Add more examples.' },
      { text: JSON.stringify({ approved: true, feedback: 'Good now.' }) },
    ]);

    const agencyConfig = {
      agents: { producer, reviewer },
      maxRounds: 3,
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const result = (await strategy.execute('task')) as { text: string; agentCalls: AgentCallRecord[] };

    /* Non-JSON review is treated as rejection feedback. */
    expect(result.agentCalls).toHaveLength(4);
    expect(result.text).toBe('revised draft');

    /* The second producer call should include the plain-text feedback. */
    const secondProdInput = (producer.generate as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondProdInput).toContain('This needs work. Add more examples.');
  });

  it('aggregates usage across all rounds', async () => {
    const producer = mockAgent('draft', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const reviewer = mockAgent(
      JSON.stringify({ approved: true }),
      { promptTokens: 30, completionTokens: 10, totalTokens: 40 },
    );

    const agencyConfig = {
      agents: { producer, reviewer },
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const result = (await strategy.execute('task')) as {
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

    expect(result.usage.promptTokens).toBe(130);
    expect(result.usage.completionTokens).toBe(60);
    expect(result.usage.totalTokens).toBe(190);
  });

  it('returns a stream wrapper from the stream method', async () => {
    const producer = mockAgent('streamed draft');
    const reviewer = mockAgent(JSON.stringify({ approved: true }));

    const agencyConfig = {
      agents: { producer, reviewer },
    } as AgencyOptions;

    const strategy = compileReviewLoop({ producer, reviewer }, agencyConfig);
    const streamResult = strategy.stream('task') as { text: Promise<string> };

    const text = await streamResult.text;
    expect(text).toBe('streamed draft');
  });
});

/* ------------------------------------------------------------------ */
/* Hierarchical Strategy                                               */
/* ------------------------------------------------------------------ */

describe('Hierarchical Strategy', () => {
  beforeEach(() => {
    hoisted.agentGenerate.mockReset();
  });

  it('throws AgencyConfigError without an agency-level model or provider', () => {
    expect(() =>
      compileHierarchical(
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(AgencyConfigError);
    expect(() =>
      compileHierarchical(
        { a: mockAgent('ok') },
        { agents: { a: mockAgent('ok') } } as AgencyOptions,
      ),
    ).toThrow(/agency-level model/i);
  });

  it('manager delegates via tools and returns final answer', async () => {
    const researcher = mockAgent('research findings');
    const writer = mockAgent('polished article');

    /* The manager (created via mocked agent factory) returns a final answer. */
    hoisted.agentGenerate.mockResolvedValue({
      text: 'manager synthesized answer',
      usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { researcher, writer },
      model: 'openai:gpt-4o',
      instructions: 'Be thorough.',
    } as AgencyOptions;

    const strategy = compileHierarchical({ researcher, writer }, agencyConfig);
    const result = (await strategy.execute('write an article')) as { text: string };

    /* Manager was invoked via the mocked agent factory. */
    expect(hoisted.agentGenerate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('manager synthesized answer');
  });

  it('collects agentCalls from delegated agents when tools are invoked', async () => {
    const researcher = mockAgent('raw research data');

    /*
     * Simulate the manager calling the delegate_to_researcher tool.
     * When the mocked agent factory's generate is called, we manually
     * invoke the tool that was passed to it.
     */
    hoisted.agentGenerate.mockImplementation(async function (_prompt: string, _opts: unknown) {
      /* The tools were passed via the agent() factory call; we access them
       * through the mock's closure. We need to extract the tool from the
       * factory call arguments. */
      const { agent: agentFactory } = await import('../agent.js');
      const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
      const factoryCallArgs = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];
      const delegateTool = factoryCallArgs.tools?.delegate_to_researcher;

      if (delegateTool?.execute) {
        await delegateTool.execute({ task: 'find sources' });
      }

      return {
        text: 'final answer with research',
        usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
        toolCalls: [{ name: 'delegate_to_researcher', args: { task: 'find sources' } }],
      };
    });

    const agencyConfig = {
      agents: { researcher },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileHierarchical({ researcher }, agencyConfig);
    const result = (await strategy.execute('research topic')) as {
      agentCalls: AgentCallRecord[];
    };

    /* The researcher's call should be recorded. */
    expect(result.agentCalls).toHaveLength(1);
    expect(result.agentCalls[0].agent).toBe('researcher');
    expect(result.agentCalls[0].input).toBe('find sources');
    expect(result.agentCalls[0].output).toBe('raw research data');
  });

  it('manager sees team roster in system prompt', async () => {
    const coder: BaseAgentConfig = { model: 'openai:gpt-4o', instructions: 'Write clean code' };
    const tester: BaseAgentConfig = { model: 'openai:gpt-4o', instructions: 'Write thorough tests' };

    hoisted.agentGenerate.mockResolvedValue({
      text: 'managed result',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { coder, tester },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileHierarchical({ coder, tester }, agencyConfig);
    await strategy.execute('build a feature');

    /* The agent factory was called with instructions containing the team roster. */
    const { agent: agentFactory } = await import('../agent.js');
    const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
    const managerConfig = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];

    expect(managerConfig.instructions).toContain('coder: Write clean code');
    expect(managerConfig.instructions).toContain('tester: Write thorough tests');
    expect(managerConfig.instructions).toContain('manager agent');
  });

  it('creates delegate tools for each sub-agent', async () => {
    const agentA = mockAgent('ok');
    const agentB = mockAgent('ok');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'done',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { alpha: agentA, beta: agentB },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileHierarchical({ alpha: agentA, beta: agentB }, agencyConfig);
    await strategy.execute('task');

    /* Inspect the tools passed to the manager agent. */
    const { agent: agentFactory } = await import('../agent.js');
    const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
    const managerConfig = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];

    expect(managerConfig.tools).toHaveProperty('delegate_to_alpha');
    expect(managerConfig.tools).toHaveProperty('delegate_to_beta');
    expect(managerConfig.tools.delegate_to_alpha.description).toContain('alpha');
    expect(managerConfig.tools.delegate_to_beta.description).toContain('beta');
  });

  it('returns a stream wrapper from the stream method', async () => {
    const agentA = mockAgent('ok');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'hierarchical stream',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
    } as AgencyOptions;

    const strategy = compileHierarchical({ a: agentA }, agencyConfig);
    const streamResult = strategy.stream('task') as { text: Promise<string> };

    const text = await streamResult.text;
    expect(text).toBe('hierarchical stream');
  });
});

/* ------------------------------------------------------------------ */
/* Adaptive Mode                                                       */
/* ------------------------------------------------------------------ */

describe('Adaptive Mode', () => {
  beforeEach(async () => {
    hoisted.agentGenerate.mockReset();
    /* Reset the agent factory mock to clear accumulated calls from prior tests. */
    const { agent: agentFactory } = await import('../agent.js');
    (agentFactory as ReturnType<typeof vi.fn>).mockClear();
  });

  it('wraps non-hierarchical strategy with a hierarchical manager', async () => {
    const agentA = mockAgent('ok');
    const agentB = mockAgent('ok');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'adaptive result',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA, b: agentB },
      model: 'openai:gpt-4o',
      strategy: 'sequential' as const,
      adaptive: true,
    } as AgencyOptions;

    const strategy = compileStrategy('sequential', { a: agentA, b: agentB }, agencyConfig);
    const result = (await strategy.execute('task')) as { text: string };

    /* When adaptive is true, the strategy is compiled as hierarchical. */
    expect(result.text).toBe('adaptive result');

    /* The manager should have delegation tools (hierarchical pattern). */
    const { agent: agentFactory } = await import('../agent.js');
    const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
    const managerConfig = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];

    expect(managerConfig.tools).toHaveProperty('delegate_to_a');
    expect(managerConfig.tools).toHaveProperty('delegate_to_b');
  });

  it('includes default strategy name in manager instructions', async () => {
    const agentA = mockAgent('ok');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'adaptive',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
      strategy: 'parallel' as const,
      adaptive: true,
    } as AgencyOptions;

    const strategy = compileStrategy('parallel', { a: agentA }, agencyConfig);
    /* Must call execute() so the manager agent is instantiated via the factory. */
    await strategy.execute('task');

    const { agent: agentFactory } = await import('../agent.js');
    const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
    const managerConfig = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];

    expect(managerConfig.instructions).toContain('Your default strategy is "parallel"');
    expect(managerConfig.instructions).toContain('override');
  });

  it('does not wrap hierarchical strategy even when adaptive is true', async () => {
    const agentA = mockAgent('ok');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'direct hierarchical',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
      strategy: 'hierarchical' as const,
      adaptive: true,
    } as AgencyOptions;

    const strategy = compileStrategy('hierarchical', { a: agentA }, agencyConfig);
    const result = (await strategy.execute('task')) as { text: string };

    /* Should work as normal hierarchical without double-wrapping. */
    expect(result.text).toBe('direct hierarchical');

    /* The manager instructions should NOT contain adaptive strategy override language. */
    const { agent: agentFactory } = await import('../agent.js');
    const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
    const managerConfig = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];

    expect(managerConfig.instructions).not.toContain('Your default strategy is');
  });

  it('preserves agency-level instructions in adaptive wrapper', async () => {
    const agentA = mockAgent('ok');

    hoisted.agentGenerate.mockResolvedValue({
      text: 'result',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });

    const agencyConfig = {
      agents: { a: agentA },
      model: 'openai:gpt-4o',
      strategy: 'sequential' as const,
      adaptive: true,
      instructions: 'Always be concise.',
    } as AgencyOptions;

    const strategy = compileStrategy('sequential', { a: agentA }, agencyConfig);
    /* Must call execute() so the manager agent is instantiated via the factory. */
    await strategy.execute('task');

    const { agent: agentFactory } = await import('../agent.js');
    const factoryMock = agentFactory as ReturnType<typeof vi.fn>;
    const managerConfig = factoryMock.mock.calls[factoryMock.mock.calls.length - 1][0];

    expect(managerConfig.instructions).toContain('Always be concise.');
    expect(managerConfig.instructions).toContain('Your default strategy is "sequential"');
  });
});

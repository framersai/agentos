import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const hoisted = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  getRecordedAgentOSUsage: vi.fn(),
}));

vi.mock('../../generateText.js', () => ({
  generateText: hoisted.generateText,
}));

vi.mock('../../streamText.js', () => ({
  streamText: hoisted.streamText,
}));

vi.mock('../usageLedger.js', () => ({
  getRecordedAgentOSUsage: hoisted.getRecordedAgentOSUsage,
}));

import { agent } from '../agent.js';

describe('agent', () => {
  beforeEach(() => {
    hoisted.generateText.mockReset();
    hoisted.streamText.mockReset();
    hoisted.getRecordedAgentOSUsage.mockReset();
    hoisted.generateText.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: 'ok',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    hoisted.getRecordedAgentOSUsage.mockResolvedValue({
      promptTokens: 2,
      completionTokens: 1,
      totalTokens: 3,
      costUSD: 0.001,
      calls: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once when runtime-only capabilities are passed to agent()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      emergent: { enabled: true } as any,
      guardrails: ['pii-redaction'],
      discovery: { enabled: true },
    });

    expect(typeof assistant.generate).toBe('function');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('agent() accepted config that requires the full AgentOS runtime'),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for lightweight-supported fields', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    agent({
      model: 'openai:gpt-4.1-mini',
      tools: {},
      memory: false,
      instructions: 'Be concise.',
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('forwards top-level usageLedger to observability.usageLedger', async () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      usageLedger: { path: '/tmp/compat.jsonl', enabled: true },
    });
    await assistant.generate('hi');
    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        usageLedger: expect.objectContaining({
          path: '/tmp/compat.jsonl',
          enabled: true,
        }),
      })
    );
  });

  it('injects personality traits as behavioral descriptions into the system prompt', async () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      instructions: 'Be concise.',
      personality: { openness: 0.8, conscientiousness: 0.6 },
    });

    await assistant.generate('Hello');

    // High openness (0.8 > 0.65) produces a behavioral directive
    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('creative angles'),
      })
    );
    // The original instructions are preserved
    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Be concise.'),
      })
    );
  });

  it('does not retain session history when memory is disabled', async () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      memory: false,
    });

    const session = assistant.session('demo');
    await session.send('first');
    await session.send('second');

    expect(hoisted.generateText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messages: [{ role: 'user', content: 'first' }],
      })
    );
    expect(hoisted.generateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: [{ role: 'user', content: 'second' }],
      })
    );
    expect(session.messages()).toEqual([]);
  });

  it('tracks session usage through the durable usage ledger', async () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      usageLedger: { path: '/tmp/agentos-usage-test.jsonl', enabled: true },
    });

    const session = assistant.session('demo');
    await session.send('hello');

    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        usageLedger: expect.objectContaining({
          path: '/tmp/agentos-usage-test.jsonl',
          sessionId: 'demo',
          source: 'agent.session.send',
        }),
      })
    );

    await expect(session.usage()).resolves.toEqual({
      promptTokens: 2,
      completionTokens: 1,
      totalTokens: 3,
      costUSD: 0.001,
      calls: 1,
    });
    expect(hoisted.getRecordedAgentOSUsage).toHaveBeenCalledWith({
      enabled: true,
      path: '/tmp/agentos-usage-test.jsonl',
      sessionId: 'demo',
    });
  });

  it('accepts external tool registries on the agent config', async () => {
    const externalTools = new Map([
      [
        'open_profile',
        {
          description: 'Load a saved profile by ID.',
          inputSchema: {
            type: 'object',
            properties: { profileId: { type: 'string' } },
            required: ['profileId'],
          },
          execute: async () => ({ success: true, output: { id: 'profile-1' } }),
        },
      ],
    ]);

    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      tools: externalTools,
    });

    await assistant.generate('Load my profile.');

    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: externalTools,
      })
    );
  });

  it('forwards maxTokens from agent config to every generateText call (generate / session.send)', async () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      instructions: 'be brief',
      maxTokens: 1500,
    });

    await assistant.generate('Hello.');
    expect(hoisted.generateText).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxTokens: 1500 }),
    );

    await assistant.session('s1').send('Hello again.');
    expect(hoisted.generateText).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxTokens: 1500 }),
    );
  });

  it('omits maxTokens from the generateText call when agent config does not set it', async () => {
    const assistant = agent({ model: 'openai:gpt-4.1-mini', instructions: 'be brief' });
    await assistant.generate('Hello.');
    const callArgs = hoisted.generateText.mock.calls.at(-1)?.[0];
    expect(callArgs?.maxTokens).toBeUndefined();
  });
});

describe('agent session.send: structured output (responseSchema)', () => {
  beforeEach(() => {
    hoisted.generateText.mockReset();
    hoisted.streamText.mockReset();
    hoisted.getRecordedAgentOSUsage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const Decision = z.object({
    verdict: z.enum(['yes', 'no']),
    confidence: z.number().min(0).max(1),
  });

  it('returns plain GenerateTextResult when responseSchema is omitted (regression guard)', async () => {
    hoisted.generateText.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: 'plain reply',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const assistant = agent({ model: 'openai:gpt-4.1-mini' });
    const session = assistant.session('demo');
    const r = await session.send('hi');
    expect(r.text).toBe('plain reply');
    expect('object' in r).toBe(false);
  });

  it('returns typed object alongside text when responseSchema is set', async () => {
    hoisted.generateText.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: '{"verdict":"yes","confidence":0.92}',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const assistant = agent({ model: 'openai:gpt-4.1-mini' });
    const session = assistant.session('demo');
    const r = await session.send('decide', { responseSchema: Decision });
    expect(r.object).toEqual({ verdict: 'yes', confidence: 0.92 });
    expect(r.text).toBe('{"verdict":"yes","confidence":0.92}');
  });

  it('forwards _responseFormat to generateText when responseSchema is set (openai → json_schema)', async () => {
    hoisted.generateText.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: '{"verdict":"yes","confidence":0.5}',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const assistant = agent({ model: 'openai:gpt-4.1-mini' });
    await assistant.session('demo').send('decide', {
      responseSchema: Decision,
      schemaName: 'Decision',
    });
    const callArgs = hoisted.generateText.mock.calls.at(-1)?.[0];
    expect(callArgs?._responseFormat).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'Decision', strict: true },
    });
  });

  it('strips caller-provided tools when responseSchema is set and warns once', async () => {
    hoisted.generateText.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: '{"verdict":"no","confidence":0.1}',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeTool = {
      stub: {
        description: 'stub',
        inputSchema: { type: 'object' as const, properties: {} },
        execute: async () => ({ success: true, output: {} }),
      },
    };
    const assistant = agent({ model: 'openai:gpt-4.1-mini', tools: fakeTool as any });
    await assistant.session('demo').send('decide', { responseSchema: Decision });
    const callArgs = hoisted.generateText.mock.calls.at(-1)?.[0];
    expect(callArgs?.tools).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tools are ignored when responseSchema is set'),
    );
  });

  it('throws ObjectGenerationError when provider returns non-JSON text', async () => {
    hoisted.generateText.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: 'not json at all',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const assistant = agent({ model: 'openai:gpt-4.1-mini' });
    await expect(
      assistant.session('demo').send('decide', { responseSchema: Decision }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws ObjectGenerationError when JSON fails Zod validation', async () => {
    hoisted.generateText.mockResolvedValueOnce({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: '{"verdict":"maybe","confidence":2}',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const assistant = agent({ model: 'openai:gpt-4.1-mini' });
    await expect(
      assistant.session('demo').send('decide', { responseSchema: Decision }),
    ).rejects.toThrow(/Zod validation/);
  });

  it('preserves session memory across schema-aware sends', async () => {
    hoisted.generateText.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: '{"verdict":"yes","confidence":0.8}',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
    const assistant = agent({ model: 'openai:gpt-4.1-mini' });
    const session = assistant.session('demo');
    await session.send('first', { responseSchema: Decision });
    await session.send('second', { responseSchema: Decision });
    expect(hoisted.generateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: '{"verdict":"yes","confidence":0.8}' },
          { role: 'user', content: 'second' },
        ],
      }),
    );
  });
});

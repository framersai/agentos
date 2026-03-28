import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  getRecordedAgentOSUsage: vi.fn(),
}));

vi.mock('../generateText.js', () => ({
  generateText: hoisted.generateText,
}));

vi.mock('../streamText.js', () => ({
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

  it('accepts guardrails without throwing (stored as config for agency/runtime)', () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      guardrails: ['pii-redaction'],
    });
    // Should create the agent successfully — guardrails are accepted as config
    expect(typeof assistant.generate).toBe('function');
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

  it('injects personality traits into the system prompt', async () => {
    const assistant = agent({
      model: 'openai:gpt-4.1-mini',
      instructions: 'Be concise.',
      personality: { openness: 0.8, conscientiousness: 0.6 },
    });

    await assistant.generate('Hello');

    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('openness=0.80'),
      })
    );
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
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('../generateText.js', () => ({
  generateText: hoisted.generateText,
}));

vi.mock('../streamText.js', () => ({
  streamText: hoisted.streamText,
}));

import { agent } from '../agent.js';

describe('agent', () => {
  beforeEach(() => {
    hoisted.generateText.mockReset();
    hoisted.streamText.mockReset();
    hoisted.generateText.mockResolvedValue({
      text: 'ok',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: [],
      finishReason: 'stop',
    });
  });

  it('throws when guardrails are requested on the lightweight API', () => {
    expect(() =>
      agent({
        model: 'openai:gpt-4.1-mini',
        guardrails: ['pii-redaction'],
      }),
    ).toThrow(/full AgentOS runtime/i);
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
      }),
    );
    expect(hoisted.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Be concise.'),
      }),
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
      }),
    );
    expect(hoisted.generateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: [{ role: 'user', content: 'second' }],
      }),
    );
    expect(session.messages()).toEqual([]);
  });
});

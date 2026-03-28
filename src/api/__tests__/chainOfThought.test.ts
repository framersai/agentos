import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const generateCompletion = vi.fn();
  const getProvider = vi.fn(() => ({ generateCompletion }));
  const createProviderManager = vi.fn(async () => ({ getProvider }));
  return {
    generateCompletion,
    getProvider,
    createProviderManager,
  };
});

vi.mock('../model.js', () => ({
  resolveModelOption: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4.1-mini' })),
  resolveProvider: vi.fn(() => ({
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    apiKey: 'test-key',
  })),
  createProviderManager: hoisted.createProviderManager,
}));

import { generateText } from '../generateText.js';
import { DEFAULT_COT_INSTRUCTION } from '../generateText.js';

describe('chainOfThought', () => {
  beforeEach(() => {
    hoisted.generateCompletion.mockReset();
    hoisted.generateCompletion.mockResolvedValue({
      modelId: 'gpt-4.1-mini',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      choices: [
        {
          message: { role: 'assistant', content: 'response text' },
          finishReason: 'stop',
        },
      ],
    });
  });

  it('does not inject CoT instruction when chainOfThought is disabled', async () => {
    await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'hello',
      system: 'You are a helper.',
      tools: { my_tool: { description: 'A tool', parameters: {} } },
      chainOfThought: false,
    });

    const messages = hoisted.generateCompletion.mock.calls[0][1];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toBe('You are a helper.');
    expect(systemMsg.content).not.toContain('Before choosing an action');
  });

  it('injects default CoT instruction when chainOfThought is true', async () => {
    await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'hello',
      system: 'You are a helper.',
      tools: { my_tool: { description: 'A tool', parameters: {} } },
      chainOfThought: true,
    });

    const messages = hoisted.generateCompletion.mock.calls[0][1];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain(DEFAULT_COT_INSTRUCTION);
    expect(systemMsg.content).toContain('You are a helper.');
  });

  it('injects custom CoT instruction when chainOfThought is a string', async () => {
    const customCot = 'Think step by step before answering.';

    await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'hello',
      system: 'You are a helper.',
      tools: { my_tool: { description: 'A tool', parameters: {} } },
      chainOfThought: customCot,
    });

    const messages = hoisted.generateCompletion.mock.calls[0][1];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain(customCot);
    expect(systemMsg.content).toContain('You are a helper.');
    expect(systemMsg.content).not.toContain(DEFAULT_COT_INSTRUCTION);
  });

  it('detects tools supplied as a Map and still injects CoT', async () => {
    await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'hello',
      tools: new Map([
        [
          'lookup',
          {
            description: 'A tool',
            inputSchema: { type: 'object', properties: {} },
            execute: vi.fn(async () => ({ ok: true })),
          },
        ],
      ]) as any,
      chainOfThought: true,
    });

    const messages = hoisted.generateCompletion.mock.calls[0][1];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain(DEFAULT_COT_INSTRUCTION);
  });
});

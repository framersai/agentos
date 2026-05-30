import { beforeEach, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const generateCompletion = vi.fn();
  const generateCompletionStream = vi.fn();
  const getProvider = vi.fn(() => ({ generateCompletion, generateCompletionStream }));
  const createProviderManager = vi.fn(async () => ({ getProvider }));
  return { generateCompletion, generateCompletionStream, getProvider, createProviderManager };
});
vi.mock('../../model.js', () => ({
  resolveModelOption: vi.fn(() => ({ providerId: 'openai', modelId: 'uncensored-x' })),
  resolveProvider: vi.fn(() => ({ providerId: 'openai', modelId: 'uncensored-x', apiKey: 'k' })),
  createProviderManager: hoisted.createProviderManager,
}));

import { streamText } from '../streamText.js';

const recall = {
  id: 'r', name: 'recall', displayName: 'R', description: 'recall',
  inputSchema: { type: 'object', properties: {} },
  execute: vi.fn(async () => ({ success: true, output: { found: 'beach' } })),
};

const okStep = (content: string) => ({
  modelId: 'uncensored-x', usage: { totalTokens: 5 },
  choices: [{ message: { role: 'assistant', content }, finishReason: 'stop' }],
});

beforeEach(() => {
  hoisted.generateCompletion.mockReset();
  hoisted.generateCompletionStream.mockReset();
  recall.execute.mockClear();
});

it('toolMode:prompt streams the final answer after buffered tool hops', async () => {
  hoisted.generateCompletion
    .mockResolvedValueOnce(okStep('<tool_call>{"name":"recall","arguments":{}}</tool_call>'))
    .mockResolvedValueOnce(okStep('You went to the beach.'));

  const result = streamText({
    model: 'openai:uncensored-x', prompt: 'where did I go?',
    tools: [recall] as any, toolMode: 'prompt', maxSteps: 5,
  } as any);

  let streamed = '';
  for await (const chunk of result.textStream) streamed += chunk;

  expect(recall.execute).toHaveBeenCalledTimes(1);
  expect(streamed).toBe('You went to the beach.');
  await expect(result.text).resolves.toBe('You went to the beach.');
  await expect(result.toolCalls).resolves.toEqual([{ name: 'recall', args: {} }]);
});

it('toolMode:auto falls back to the shim when native streaming rejects tool use', async () => {
  // native streaming attempt (with tools) rejects tool use → reactive fallback
  hoisted.generateCompletionStream.mockImplementation(() => {
    throw new Error('No endpoints found that support tool use. Try disabling tools.');
  });
  hoisted.generateCompletion
    .mockResolvedValueOnce(okStep('<tool_call>{"name":"recall","arguments":{}}</tool_call>'))
    .mockResolvedValueOnce(okStep('You went to the beach.'));

  const result = streamText({
    model: 'openai:uncensored-x', prompt: 'where did I go?',
    tools: [recall] as any, toolMode: 'auto', maxSteps: 5,
  } as any);

  let streamed = '';
  for await (const chunk of result.textStream) streamed += chunk;

  expect(recall.execute).toHaveBeenCalledTimes(1);
  expect(streamed).toBe('You went to the beach.');
  await expect(result.text).resolves.toBe('You went to the beach.');
});

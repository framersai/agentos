import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { clearRecordedAgentOSUsage, getRecordedAgentOSUsage } from '../usageLedger.js';

describe('generateText', () => {
  beforeEach(() => {
    hoisted.generateCompletion.mockReset();
  });

  afterEach(async () => {
    delete process.env.AGENTOS_USAGE_LEDGER_PATH;
  });

  it('persists helper usage when a ledger path is configured', async () => {
    const ledgerPath = path.join(os.tmpdir(), `agentos-generate-text-${Date.now()}.jsonl`);
    hoisted.generateCompletion.mockResolvedValue({
      modelId: 'gpt-4.1-mini',
      usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18, costUSD: 0.0021 },
      choices: [
        {
          message: { role: 'assistant', content: 'hello world' },
          finishReason: 'stop',
        },
      ],
    });

    const result = await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'hello',
      usageLedger: { path: ledgerPath, sessionId: 'demo-session' },
    });

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      text: 'hello world',
    });
    await expect(
      getRecordedAgentOSUsage({ path: ledgerPath, sessionId: 'demo-session' })
    ).resolves.toEqual({
      sessionId: 'demo-session',
      personaId: undefined,
      promptTokens: 12,
      completionTokens: 6,
      totalTokens: 18,
      costUSD: 0.0021,
      calls: 1,
    });

    await clearRecordedAgentOSUsage({ path: ledgerPath });
  });

  it('accepts prompt-only ToolDefinitionForLLM arrays and records explicit tool errors', async () => {
    hoisted.generateCompletion
      .mockResolvedValueOnce({
        modelId: 'gpt-4.1-mini',
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'tool-1',
                  type: 'function',
                  function: {
                    name: 'open_profile',
                    arguments: '{"profileId":"profile-1"}',
                  },
                },
              ],
            },
            finishReason: 'tool_calls',
          },
        ],
      })
      .mockResolvedValueOnce({
        modelId: 'gpt-4.1-mini',
        usage: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
        choices: [
          {
            message: { role: 'assistant', content: 'Tool execution failed as expected.' },
            finishReason: 'stop',
          },
        ],
      });

    const result = await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'Load my profile.',
      maxSteps: 2,
      tools: [
        {
          name: 'open_profile',
          description: 'Load a saved profile record by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
        },
      ],
    });

    expect(hoisted.generateCompletion).toHaveBeenCalledTimes(2);
    expect(hoisted.generateCompletion.mock.calls[0]?.[2]?.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'open_profile',
          description: 'Load a saved profile record by ID.',
          parameters: {
            type: 'object',
            properties: {
              profileId: { type: 'string' },
            },
            required: ['profileId'],
          },
        },
      },
    ]);
    expect(result.text).toBe('Tool execution failed as expected.');
    expect(result.toolCalls).toEqual([
      {
        name: 'open_profile',
        args: { profileId: 'profile-1' },
        error: 'No executor configured for prompt-only tool "open_profile".',
      },
    ]);
  });
});

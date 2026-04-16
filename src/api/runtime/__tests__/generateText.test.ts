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

vi.mock('../../model.js', () => ({
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

  it('parses text tool calls once and passes a real execution context to external tools', async () => {
    const observedContexts: any[] = [];

    hoisted.generateCompletion
      .mockResolvedValueOnce({
        modelId: 'gpt-4.1-mini',
        usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
        choices: [
          {
            message: {
              role: 'assistant',
              content: [
                'I should use a tool.',
                '```json',
                '{"tool": "lookup", "arguments": {"topic": "QUIC"}}',
                '```',
                'Thought: I should confirm with the same tool.',
                'Action: lookup',
                'Input: {"topic":"QUIC"}',
              ].join('\n'),
            },
            finishReason: 'stop',
          },
        ],
      })
      .mockResolvedValueOnce({
        modelId: 'gpt-4.1-mini',
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        choices: [
          {
            message: { role: 'assistant', content: 'QUIC reduces handshake overhead.' },
            finishReason: 'stop',
          },
        ],
      });

    const execute = vi.fn(async (args: { topic: string }, context: any) => {
      observedContexts.push(context);
      return { summary: `context for ${args.topic}` };
    });

    const result = await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'Explain QUIC.',
      maxSteps: 2,
      tools: new Map([
        [
          'lookup',
          {
            description: 'Look up protocol context',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
            },
            execute,
          },
        ],
      ]) as any,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(observedContexts[0]).toMatchObject({
      gmiId: expect.stringMatching(/^generateText:/),
      personaId: 'generateText:persona',
      userContext: { userId: 'system', source: 'generateText' },
      correlationId: 'text-tc-0-0',
      sessionData: {
        source: 'generateText',
        stepIndex: 0,
        sessionId: expect.stringMatching(/^generateText:/),
      },
    });
    expect(result.text).toBe('QUIC reduces handshake overhead.');
    expect(result.toolCalls).toEqual([
      {
        name: 'lookup',
        args: { topic: 'QUIC' },
        result: { summary: 'context for QUIC' },
      },
    ]);
  });

  it('uses onAfterGeneration text rewrites when continuing a text-fallback tool loop', async () => {
    hoisted.generateCompletion
      .mockResolvedValueOnce({
        modelId: 'gpt-4.1-mini',
        usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Action: lookup\nInput: {"topic":"QUIC"}',
            },
            finishReason: 'stop',
          },
        ],
      })
      .mockResolvedValueOnce({
        modelId: 'gpt-4.1-mini',
        usage: { promptTokens: 7, completionTokens: 4, totalTokens: 11 },
        choices: [
          {
            message: { role: 'assistant', content: 'QUIC reduces handshake overhead.' },
            finishReason: 'stop',
          },
        ],
      });

    const result = await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'Explain QUIC.',
      maxSteps: 2,
      onAfterGeneration: async (stepResult) =>
        stepResult.toolCalls.length > 0
          ? { ...stepResult, text: 'Use the lookup tool before answering.' }
          : stepResult,
      tools: new Map([
        [
          'lookup',
          {
            description: 'Look up protocol context',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
            },
            execute: vi.fn(async () => ({ summary: 'ctx' })),
          },
        ],
      ]) as any,
    });

    expect(hoisted.generateCompletion.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'Use the lookup tool before answering.',
        }),
      ])
    );
    expect(result.text).toBe('QUIC reduces handshake overhead.');
  });

  it('records malformed native tool arguments as a tool error without executing the tool', async () => {
    const execute = vi.fn(async () => ({ ok: true }));

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
                    name: 'lookup',
                    arguments: '{"topic":',
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
        usage: { promptTokens: 6, completionTokens: 3, totalTokens: 9 },
        choices: [
          {
            message: { role: 'assistant', content: 'I could not execute that tool call.' },
            finishReason: 'stop',
          },
        ],
      });

    const result = await generateText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'Explain QUIC.',
      maxSteps: 2,
      tools: new Map([
        [
          'lookup',
          {
            description: 'Look up protocol context',
            inputSchema: {
              type: 'object',
              properties: { topic: { type: 'string' } },
              required: ['topic'],
            },
            execute,
          },
        ],
      ]) as any,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([
      {
        name: 'lookup',
        args: '{"topic":',
        error: 'Tool "lookup" arguments were not valid JSON.',
      },
    ]);
    expect(result.text).toBe('I could not execute that tool call.');
  });

  it('auto-builds fallback chain when fallbackProviders is undefined and primary throws 429', async () => {
    hoisted.generateCompletion
      .mockRejectedValueOnce(new Error('429 rate limit exceeded'))
      .mockResolvedValueOnce({
        modelId: 'gpt-4o-mini',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        choices: [{ message: { role: 'assistant', content: 'fallback reply' }, finishReason: 'stop' }],
      });

    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    try {
      const result = await generateText({
        model: 'openai:gpt-4o',
        prompt: 'hello',
      });
      expect(result.text).toBe('fallback reply');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('does NOT fallback when fallbackProviders is explicitly []', async () => {
    hoisted.generateCompletion.mockRejectedValueOnce(new Error('429 rate limit exceeded'));

    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    try {
      await expect(
        generateText({
          model: 'openai:gpt-4o',
          prompt: 'hello',
          fallbackProviders: [],
        })
      ).rejects.toThrow('429');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const generateCompletionStream = vi.fn();
  const getProvider = vi.fn(() => ({ generateCompletionStream }));
  const createProviderManager = vi.fn(async () => ({ getProvider }));
  return {
    generateCompletionStream,
    getProvider,
    createProviderManager,
  };
});

vi.mock('../model.js', () => ({
  parseModelString: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4.1-mini' })),
  resolveModelOption: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4.1-mini' })),
  resolveProvider: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4.1-mini', apiKey: 'test-key' })),
  createProviderManager: hoisted.createProviderManager,
}));

import { streamText } from '../streamText.js';
import { clearRecordedAgentOSUsage, getRecordedAgentOSUsage } from '../usageLedger.js';

describe('streamText', () => {
  it('executes streamed tool calls before continuing to the next step', async () => {
    hoisted.generateCompletionStream
      .mockImplementationOnce(async function* () {
        yield {
          id: 'step-1',
          object: 'chat.completion.chunk',
          created: 1,
          modelId: 'gpt-4.1-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'tool-1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"topic":"QUIC"}' },
                  },
                ],
              },
              finishReason: 'tool_calls',
            },
          ],
          isFinal: true,
          usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        };
      })
      .mockImplementationOnce(async function* () {
        yield {
          id: 'step-2a',
          object: 'chat.completion.chunk',
          created: 2,
          modelId: 'gpt-4.1-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'QUIC reduces handshake overhead.' },
              finishReason: null,
            },
          ],
          responseTextDelta: 'QUIC reduces handshake overhead.',
          isFinal: false,
        };
        yield {
          id: 'step-2b',
          object: 'chat.completion.chunk',
          created: 2,
          modelId: 'gpt-4.1-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'QUIC reduces handshake overhead.' },
              finishReason: 'stop',
            },
          ],
          isFinal: true,
          usage: { promptTokens: 7, completionTokens: 5, totalTokens: 12 },
        };
      });

    const result = streamText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'Explain QUIC.',
      maxSteps: 2,
      tools: {
        lookup: {
          description: 'Look up protocol context',
          parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
          execute: vi.fn(async (args: { topic: string }) => ({ summary: `context for ${args.topic}` })),
        },
      },
    });

    const parts: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const part of result.fullStream) {
      parts.push(part as any);
    }

    expect(parts.map((part) => part.type)).toEqual(['tool-call', 'tool-result', 'text']);
    expect(parts[0]).toMatchObject({ toolName: 'lookup', args: { topic: 'QUIC' } });
    expect(parts[1]).toMatchObject({ toolName: 'lookup', result: { summary: 'context for QUIC' } });
    expect(await result.text).toBe('QUIC reduces handshake overhead.');
    expect(await result.usage).toEqual({ promptTokens: 17, completionTokens: 7, totalTokens: 24 });
    await expect(result.toolCalls).resolves.toEqual([
      {
        name: 'lookup',
        args: { topic: 'QUIC' },
        result: { summary: 'context for QUIC' },
      },
    ]);
  });

  it('persists streaming usage when a ledger path is configured', async () => {
    const ledgerPath = path.join(os.tmpdir(), `agentos-stream-text-${Date.now()}.jsonl`);

    hoisted.generateCompletionStream.mockImplementationOnce(async function* () {
      yield {
        id: 'step-1',
        object: 'chat.completion.chunk',
        created: 1,
        modelId: 'gpt-4.1-mini',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'streamed hello' },
            finishReason: 'stop',
          },
        ],
        responseTextDelta: 'streamed hello',
        isFinal: true,
        usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7, costUSD: 0.0007 },
      };
    });

    const result = streamText({
      model: 'openai:gpt-4.1-mini',
      prompt: 'hi',
      usageLedger: { path: ledgerPath, sessionId: 'stream-session' },
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['streamed hello']);
    await expect(getRecordedAgentOSUsage({ path: ledgerPath, sessionId: 'stream-session' })).resolves.toEqual({
      sessionId: 'stream-session',
      personaId: undefined,
      promptTokens: 4,
      completionTokens: 3,
      totalTokens: 7,
      costUSD: 0.0007,
      calls: 1,
    });

    await clearRecordedAgentOSUsage({ path: ledgerPath });
  });
});

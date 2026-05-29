import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  checkBinaryInstalled: vi.fn(),
  checkAuthenticated: vi.fn(),
  execute: vi.fn(),
  executeWithSystemPrompt: vi.fn(),
  stream: vi.fn(),
  streamWithSystemPrompt: vi.fn(),
}));

vi.mock('../implementations/GeminiCLIBridge', () => ({
  GeminiCLIBridge: vi.fn().mockImplementation(() => bridgeMocks),
}));

import { GeminiCLIProvider } from '../implementations/GeminiCLIProvider';
import type { ChatMessage, ModelCompletionOptions } from '../IProvider';

describe('GeminiCLIProvider', () => {
  let provider: GeminiCLIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiCLIProvider();

    bridgeMocks.checkBinaryInstalled.mockResolvedValue({
      installed: true, binaryPath: '/usr/local/bin/gemini', version: '1.0.5',
    });
    bridgeMocks.checkAuthenticated.mockResolvedValue(true);
  });

  describe('initialize()', () => {
    it('sets isInitialized and providerId', async () => {
      await provider.initialize({});
      expect(provider.isInitialized).toBe(true);
      expect(provider.providerId).toBe('gemini-cli');
    });

    it('throws when gemini is not installed', async () => {
      bridgeMocks.checkBinaryInstalled.mockResolvedValue({ installed: false });
      await expect(provider.initialize({})).rejects.toThrow('not installed');
    });

    it('throws when not authenticated', async () => {
      bridgeMocks.checkAuthenticated.mockResolvedValue(false);
      await expect(provider.initialize({})).rejects.toThrow('not logged in');
    });
  });

  describe('generateCompletion()', () => {
    const userMsg: ChatMessage = { role: 'user', content: 'Hello' };
    const systemMsg: ChatMessage = { role: 'system', content: 'Be helpful.' };

    beforeEach(async () => {
      await provider.initialize({});
    });

    it('returns text response for simple prompt', async () => {
      bridgeMocks.executeWithSystemPrompt.mockResolvedValue({
        result: 'Hi there!',
        sessionId: 'g1',
        usage: { input_tokens: 10, output_tokens: 5 },
        isError: false,
        durationMs: 1200,
      });

      const response = await provider.generateCompletion(
        'gemini-2.5-flash',
        [systemMsg, userMsg],
        {},
      );

      expect(response.choices[0].message.content).toBe('Hi there!');
      expect(response.choices[0].finishReason).toBe('stop');
      expect(response.modelId).toBe('gemini-2.5-flash');
      expect(response.usage?.costUSD).toBe(0);

      /* System prompt goes to bridge */
      const callOpts = bridgeMocks.executeWithSystemPrompt.mock.calls[0][0];
      expect(callOpts.systemPrompt).toContain('Be helpful.');
    });

    it('parses tool calls from XML in response', async () => {
      const tools = [{
        type: 'function' as const,
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      }];

      bridgeMocks.executeWithSystemPrompt.mockResolvedValue({
        result: 'Let me search for that.\n<tool_call id="tc1" name="web_search">{"query": "weather tokyo"}</tool_call>',
        sessionId: 'g2',
        usage: { input_tokens: 20, output_tokens: 15 },
        isError: false,
        durationMs: 2000,
      });

      const response = await provider.generateCompletion(
        'gemini-2.5-flash',
        [userMsg],
        { tools } as ModelCompletionOptions,
      );

      expect(response.choices[0].finishReason).toBe('tool_calls');
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe('web_search');

      const args = JSON.parse(response.choices[0].message.tool_calls![0].function.arguments);
      expect(args.query).toBe('weather tokyo');

      /* Tool schemas injected into system prompt */
      const callOpts = bridgeMocks.executeWithSystemPrompt.mock.calls[0][0];
      expect(callOpts.systemPrompt).toContain('web_search');
      expect(callOpts.systemPrompt).toContain('<available_tools>');
    });

    it('returns text when tools requested but model responds with text', async () => {
      const tools = [{
        type: 'function' as const,
        function: { name: 'test', description: 'test', parameters: { type: 'object' } },
      }];

      bridgeMocks.executeWithSystemPrompt.mockResolvedValue({
        result: 'I can answer that directly without a tool.',
        isError: false,
        durationMs: 1000,
      });

      const response = await provider.generateCompletion(
        'gemini-2.5-flash',
        [userMsg],
        { tools } as ModelCompletionOptions,
      );

      expect(response.choices[0].finishReason).toBe('stop');
      expect(response.choices[0].message.content).toContain('directly without a tool');
    });

    it('handles single user message without XML wrapper', async () => {
      bridgeMocks.executeWithSystemPrompt.mockResolvedValue({
        result: 'response',
        isError: false,
        durationMs: 500,
      });

      await provider.generateCompletion('gemini-2.5-flash', [userMsg], {});

      const callOpts = bridgeMocks.executeWithSystemPrompt.mock.calls[0][0];
      expect(callOpts.prompt).toBe('Hello');
      expect(callOpts.prompt).not.toContain('<conversation>');
    });
  });

  describe('listAvailableModels()', () => {
    beforeEach(async () => {
      await provider.initialize({});
    });

    it('returns 4 Gemini models', async () => {
      const models = await provider.listAvailableModels();
      expect(models).toHaveLength(4);
      const ids = models.map(m => m.modelId);
      expect(ids).toContain('gemini-2.5-pro');
      expect(ids).toContain('gemini-2.5-flash');
      expect(ids).toContain('gemini-2.0-flash');
      expect(ids).toContain('gemini-2.0-flash-lite');
      expect(models.every(m => m.pricePer1MTokensInput === 0)).toBe(true);
    });
  });

  describe('generateEmbeddings()', () => {
    beforeEach(async () => {
      await provider.initialize({});
    });

    it('throws not supported', async () => {
      await expect(provider.generateEmbeddings('any', ['text'])).rejects.toThrow('does not support embeddings');
    });
  });

  describe('checkHealth()', () => {
    it('returns healthy when installed and authenticated', async () => {
      await provider.initialize({});
      const health = await provider.checkHealth();
      expect(health.isHealthy).toBe(true);
      expect((health.details as any).cliInstalled).toBe(true);
    });

    it('reports unhealthy when not installed', async () => {
      bridgeMocks.checkBinaryInstalled.mockResolvedValue({ installed: false });
      const health = await provider.checkHealth();
      expect(health.isHealthy).toBe(false);
      expect((health.details as any).guidance).toContain('npm install -g @google/gemini-cli');
    });
  });

  describe('generateCompletionStream()', () => {
    beforeEach(async () => {
      await provider.initialize({});
    });

    it('synthesizes a final chunk when the bridge only emits text deltas', async () => {
      bridgeMocks.streamWithSystemPrompt.mockImplementation(async function* () {
        yield { type: 'text_delta', text: 'Gemini' };
        yield { type: 'text_delta', text: ' stream' };
      });

      const chunks: any[] = [];
      for await (const chunk of provider.generateCompletionStream(
        'gemini-2.5-pro',
        [{ role: 'user', content: 'Hello' }],
        {},
      )) {
        chunks.push(chunk);
      }

      const finalChunk = chunks[chunks.length - 1];
      expect(finalChunk.isFinal).toBe(true);
      expect(finalChunk.modelId).toBe('gemini-2.5-pro');
      expect(finalChunk.choices[0].message.content).toBe('Gemini stream');
    });

    it('emits a terminal error chunk instead of throwing on stream errors', async () => {
      bridgeMocks.streamWithSystemPrompt.mockImplementation(async function* () {
        yield { type: 'error', error: 'quota exploded' };
      });

      const chunks: any[] = [];
      for await (const chunk of provider.generateCompletionStream(
        'gemini-2.0-flash-lite',
        [{ role: 'user', content: 'Hello' }],
        {},
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        isFinal: true,
        modelId: 'gemini-2.0-flash-lite',
        error: { message: expect.stringContaining('quota exploded') },
      });
    });
  });
});

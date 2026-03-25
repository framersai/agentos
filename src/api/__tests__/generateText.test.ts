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
  resolveProvider: vi.fn(() => ({ providerId: 'openai', modelId: 'gpt-4.1-mini', apiKey: 'test-key' })),
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
    await expect(getRecordedAgentOSUsage({ path: ledgerPath, sessionId: 'demo-session' })).resolves.toEqual({
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
});

/**
 * @fileoverview Tests for LLMUtilityAI.calculateSimilarity — validates parsing
 * of similarity scores from the mocked LLM provider and verifies the [0,1]
 * clamping behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMUtilityAI, LLMUtilityAIConfig } from '../LLMUtilityAI';
import type { IUtilityAI } from '../IUtilityAI';
import type { AIModelProviderManager } from '../../../core/llm/providers/AIModelProviderManager';
import type { IProvider, ModelCompletionResponse } from '../../../core/llm/providers/IProvider';

const mockProvider: IProvider = {
  providerId: 'mock-llm-provider',
  isInitialized: true,
  initialize: vi.fn().mockResolvedValue(undefined),
  generateCompletion: vi.fn().mockResolvedValue(<ModelCompletionResponse>{
    id: 'cmp-1', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
    choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, text: '{}', finishReason: 'stop' }],
    usage: { totalTokens: 10 },
  }),
  generateCompletionStream: vi.fn().mockImplementation(async function* () {
    yield { id: 'cmp-s', object: 'chat.completion.chunk', created: Date.now(), modelId: 'default-llm-model', responseTextDelta: '', isFinal: true, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason: 'stop' }], usage: { totalTokens: 1 } } as ModelCompletionResponse;
  }),
  generateEmbeddings: vi.fn().mockResolvedValue({ object: 'list', data: [], model: 'embed-model', usage: { prompt_tokens: 0, total_tokens: 0 } }),
  listAvailableModels: vi.fn().mockResolvedValue([]),
  getModelInfo: vi.fn().mockResolvedValue({ modelId: 'default-llm-model', providerId: 'mock-llm-provider', capabilities: ['chat'], supportsStreaming: true }),
  checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

const mockLlmProviderManager: AIModelProviderManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
  getProvider: vi.fn().mockReturnValue(mockProvider),
  listProviderIds: vi.fn().mockReturnValue(['mock-llm-provider']),
  checkHealth: vi.fn().mockResolvedValue({ isOverallHealthy: true, providerStatus: { 'mock-llm-provider': { isHealthy: true } } }),
  shutdownAll: vi.fn().mockResolvedValue(undefined),
} as any;

const defaultConfig: LLMUtilityAIConfig = {
  utilityId: 'test-llm-similarity',
  llmProviderManager: mockLlmProviderManager,
  defaultModelId: 'default-llm-model',
  defaultProviderId: 'mock-llm-provider',
};

describe('LLMUtilityAI — calculateSimilarity', () => {
  let llmUtility: IUtilityAI;

  beforeEach(async () => {
    vi.clearAllMocks();
    llmUtility = new LLMUtilityAI();
    await llmUtility.initialize(defaultConfig);
  });

  it('parses similarity score from LLM response', async () => {
    const similarityJson = JSON.stringify({ similarityScore: 0.87 });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-sim', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: similarityJson }, text: similarityJson, finishReason: 'stop' }],
      usage: { totalTokens: 20 },
    });

    const score = await llmUtility.calculateSimilarity(
      'The knight drew his sword',
      'The warrior unsheathed his blade',
      { method: 'llm_semantic' },
    );

    expect(score).toBe(0.87);
    expect(mockProvider.generateCompletion).toHaveBeenCalled();
  });

  it('clamps scores above 1.0 down to 1.0', async () => {
    const overJson = JSON.stringify({ similarityScore: 1.5 });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-over', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: overJson }, text: overJson, finishReason: 'stop' }],
      usage: { totalTokens: 15 },
    });

    const score = await llmUtility.calculateSimilarity('text A', 'text B', { method: 'llm_semantic' });
    expect(score).toBe(1.0);
  });

  it('clamps scores below 0.0 up to 0.0', async () => {
    const underJson = JSON.stringify({ similarityScore: -0.3 });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-under', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: underJson }, text: underJson, finishReason: 'stop' }],
      usage: { totalTokens: 15 },
    });

    const score = await llmUtility.calculateSimilarity('text A', 'text B', { method: 'llm_semantic' });
    expect(score).toBe(0.0);
  });

  it('sends both texts in the prompt to the LLM', async () => {
    const json = JSON.stringify({ similarityScore: 0.5 });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-prompt', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: json }, text: json, finishReason: 'stop' }],
      usage: { totalTokens: 20 },
    });

    await llmUtility.calculateSimilarity(
      'dragons breathe fire',
      'cats sleep on couches',
      { method: 'llm_semantic' },
    );

    const callArgs = (mockProvider.generateCompletion as any).mock.calls[0];
    const messages = callArgs[1] as Array<{ role: string; content: string }>;
    const allContent = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
    expect(allContent).toContain('dragons breathe fire');
    expect(allContent).toContain('cats sleep on couches');
  });
});

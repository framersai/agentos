/**
 * @fileoverview Tests for LLMUtilityAI.classifyText — zero-shot classification
 * via mocked LLM provider. Validates JSON response parsing, multi-label support,
 * and prompt construction.
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
  utilityId: 'test-llm-classify',
  llmProviderManager: mockLlmProviderManager,
  defaultModelId: 'default-llm-model',
  defaultProviderId: 'mock-llm-provider',
};

describe('LLMUtilityAI — classifyText', () => {
  let llmUtility: IUtilityAI;

  beforeEach(async () => {
    vi.clearAllMocks();
    llmUtility = new LLMUtilityAI();
    await llmUtility.initialize(defaultConfig);
  });

  it('returns parsed classification result from mocked LLM JSON response', async () => {
    const classificationJson = JSON.stringify({
      bestClass: 'attack',
      confidence: 0.92,
      allScores: [
        { classLabel: 'attack', score: 0.92 },
        { classLabel: 'equip', score: 0.05 },
        { classLabel: 'buy', score: 0.03 },
      ],
    });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-classify', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: classificationJson }, text: classificationJson, finishReason: 'stop' }],
      usage: { totalTokens: 50 },
    });

    const result = await llmUtility.classifyText('swing my sword at the orc', {
      candidateClasses: ['attack', 'equip', 'buy'],
    });

    expect(result.bestClass).toBe('attack');
    expect(result.confidence).toBe(0.92);
    expect(Array.isArray(result.allScores)).toBe(true);
    expect(result.allScores.length).toBe(3);
  });

  it('handles multi-label classification (bestClass is array)', async () => {
    const multiLabelJson = JSON.stringify({
      bestClass: ['attack', 'equip'],
      confidence: [0.85, 0.72],
      allScores: [
        { classLabel: 'attack', score: 0.85 },
        { classLabel: 'equip', score: 0.72 },
        { classLabel: 'buy', score: 0.1 },
      ],
    });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-multi', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: multiLabelJson }, text: multiLabelJson, finishReason: 'stop' }],
      usage: { totalTokens: 60 },
    });

    const result = await llmUtility.classifyText('equip the sword and strike', {
      candidateClasses: ['attack', 'equip', 'buy'],
      multiLabel: true,
    });

    expect(Array.isArray(result.bestClass)).toBe(true);
    expect(result.bestClass).toContain('attack');
    expect(result.bestClass).toContain('equip');
    expect(Array.isArray(result.confidence)).toBe(true);
  });

  it('candidate classes appear in the LLM prompt', async () => {
    const classificationJson = JSON.stringify({
      bestClass: 'flee',
      confidence: 0.88,
    });

    (mockProvider.generateCompletion as any).mockResolvedValueOnce(<ModelCompletionResponse>{
      id: 'cmp-prompt', object: 'chat.completion', created: Date.now(), modelId: 'default-llm-model',
      choices: [{ index: 0, message: { role: 'assistant', content: classificationJson }, text: classificationJson, finishReason: 'stop' }],
      usage: { totalTokens: 30 },
    });

    await llmUtility.classifyText('run away from danger', {
      candidateClasses: ['attack', 'defend', 'flee'],
    });

    expect(mockProvider.generateCompletion).toHaveBeenCalled();
    const callArgs = (mockProvider.generateCompletion as any).mock.calls[0];
    const messages = callArgs[1] as Array<{ role: string; content: string }>;
    const allContent = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
    expect(allContent).toContain('attack');
    expect(allContent).toContain('defend');
    expect(allContent).toContain('flee');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { PromptEngine } from '../PromptEngine';
import type { ModelTargetInfo, PromptExecutionContext } from '../IPromptEngine';
import type { ChatMessage } from '../providers/IProvider';

const baseModelInfo: ModelTargetInfo = {
  modelId: 'gpt-4o-mini',
  providerId: 'openai',
  maxContextTokens: 128000,
  optimalContextTokens: 64000,
  capabilities: ['chat'],
  promptFormatType: 'openai_chat',
  toolSupport: { supported: false, format: 'openai_functions' },
};

const baseExecutionContext: PromptExecutionContext = {
  activePersona: {
    id: 'persona-test',
    name: 'Test Persona',
    description: 'Test persona',
    baseSystemPrompt: 'You are helpful.',
    contextualPromptElements: [],
  } as any,
  workingMemory: {
    id: 'wm-test',
    initialize: async () => undefined,
    set: async () => undefined,
    get: async () => undefined,
    delete: async () => undefined,
    getAll: async () => ({}),
    clear: async () => undefined,
    size: async () => 0,
    has: async () => false,
    close: async () => undefined,
  } as any,
};

function createPromptEngine(): PromptEngine {
  const engine = new PromptEngine();
  return engine;
}

function extractSystemContent(messages: unknown): string {
  const promptMessages = messages as ChatMessage[];
  const systemMessage = promptMessages.find((message) => message.role === 'system');
  return typeof systemMessage?.content === 'string' ? systemMessage.content : '';
}

describe('PromptEngine user preferences', () => {
  let engine: PromptEngine;

  beforeEach(async () => {
    engine = createPromptEngine();
    await engine.initialize({
      defaultTemplateName: 'openai_chat',
      availableTemplates: {},
      tokenCounting: { strategy: 'estimated' },
      historyManagement: {
        defaultMaxMessages: 10,
        maxTokensForHistory: 2048,
        summarizationTriggerRatio: 0.8,
        preserveImportantMessages: true,
      },
      contextManagement: {
        maxRAGContextTokens: 2048,
        summarizationQualityTier: 'balanced',
        preserveSourceAttributionInSummary: true,
      },
      contextualElementSelection: {
        maxElementsPerType: {},
        defaultMaxElementsPerType: 3,
        priorityResolutionStrategy: 'highest_first',
        conflictResolutionStrategy: 'skip_conflicting',
      },
      performance: {
        enableCaching: true,
        cacheTimeoutSeconds: 60,
      },
    });
  });

  it('injects concise verbosity guidance into system prompts', async () => {
    const result = await engine.constructPrompt(
      {
        systemPrompts: [{ content: 'Base instructions' }],
        userInput: 'Summarize this.',
      },
      baseModelInfo,
      {
        ...baseExecutionContext,
        userPreferences: { verbosity: 'low' },
      },
    );

    const systemContent = extractSystemContent(result.prompt);
    expect(systemContent).toContain('Base instructions');
    expect(systemContent).toContain('keep the answer concise and efficient');
  });

  it('injects preferred format guidance into system prompts', async () => {
    const result = await engine.constructPrompt(
      {
        userInput: 'List deployment options.',
      },
      baseModelInfo,
      {
        ...baseExecutionContext,
        userPreferences: { preferredFormat: 'bullet points' },
      },
    );

    const systemContent = extractSystemContent(result.prompt);
    expect(systemContent).toContain('format the response as bullet points');
  });

  it('keeps cached prompts isolated across user preference changes', async () => {
    const baseComponents = {
      systemPrompts: [{ content: 'Base instructions' }],
      userInput: 'Explain the tradeoffs.',
    };

    const concise = await engine.constructPrompt(
      baseComponents,
      baseModelInfo,
      {
        ...baseExecutionContext,
        userPreferences: { verbosity: 'brief' },
      },
    );

    const detailed = await engine.constructPrompt(
      baseComponents,
      baseModelInfo,
      {
        ...baseExecutionContext,
        userPreferences: { verbosity: 'detailed' },
      },
    );

    expect(concise.cacheKey).not.toBe(detailed.cacheKey);
    expect(extractSystemContent(concise.prompt)).toContain('keep the answer concise and efficient');
    expect(extractSystemContent(detailed.prompt)).toContain('provide a detailed, thorough answer');
  });
});

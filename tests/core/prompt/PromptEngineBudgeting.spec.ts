// File: packages/agentos/tests/core/prompt/PromptEngineBudgeting.spec.ts
import { describe, it, expect } from 'vitest';
import { PromptEngine } from '../../../src/core/llm/PromptEngine.js';
import { PromptEngineConfig, PromptComponents, ModelTargetInfo, IPromptEngineUtilityAI } from '../../../src/core/llm/IPromptEngine.js';
import { ConversationMessage } from '../../../src/core/conversation/ConversationMessage.js';

function makeHistory(count: number, base: string = 'message'): ConversationMessage[] {
  return Array.from({ length: count }).map((_, i) => ({
    id: `m${i}`,
    role: 'user' as any,
    content: `${base}-${i} ${'x'.repeat(50)}`,
    timestamp: Date.now() - (count - i) * 1000,
  }));
}

const baseConfig: PromptEngineConfig = {
  defaultTemplateName: 'openai_chat',
  availableTemplates: {},
  tokenCounting: { strategy: 'estimated' },
  historyManagement: {
    defaultMaxMessages: 50,
    maxTokensForHistory: 400,
    summarizationTriggerRatio: 0.8,
    preserveImportantMessages: false,
  },
  contextManagement: {
    maxRAGContextTokens: 300,
    summarizationQualityTier: 'fast',
    preserveSourceAttributionInSummary: true,
  },
  contextualElementSelection: {
    maxElementsPerType: {},
    defaultMaxElementsPerType: 5,
    priorityResolutionStrategy: 'highest_first',
    conflictResolutionStrategy: 'skip_conflicting',
  },
  performance: { enableCaching: false, cacheTimeoutSeconds: 60 },
};

const modelInfo: ModelTargetInfo = {
  modelId: 'test-model',
  providerId: 'openai',
  maxContextTokens: 1000,
  optimalContextTokens: 800,
  capabilities: ['chat'],
  promptFormatType: 'openai_chat',
  toolSupport: { supported: false, format: 'openai_functions' },
};

const dummyUtility: IPromptEngineUtilityAI = {
  async summarizeConversationHistory(
    messages: Parameters<IPromptEngineUtilityAI["summarizeConversationHistory"]>[0],
    targetTokenCount: Parameters<IPromptEngineUtilityAI["summarizeConversationHistory"]>[1]
  ) {
    // Collapse all messages into a single summary message respecting targetTokenCount roughly
    const combined = messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join(' ');
    const truncated = combined.slice(0, targetTokenCount * 4); // coarse char approximation
    return {
      summaryMessages: [{ 
        id: 'summary-1', 
        role: 'system' as any, 
        content: `SUMMARY:${truncated}`,
        timestamp: Date.now()
      } satisfies ConversationMessage],
      originalTokenCount: Math.ceil(combined.length / 4),
      finalTokenCount: Math.ceil(truncated.length / 4),
      messagesSummarized: messages.length,
    };
  },
  async summarizeRAGContext(
    context: Parameters<IPromptEngineUtilityAI["summarizeRAGContext"]>[0],
    targetTokenCount: Parameters<IPromptEngineUtilityAI["summarizeRAGContext"]>[1]
  ) {
    const raw = typeof context === 'string' ? context : context.map((entry) => entry.content).join(' ');
    const truncated = raw.slice(0, targetTokenCount * 4);
    return {
      summary: `RAG_SUMMARY:${truncated}`,
      originalTokenCount: Math.ceil(raw.length / 4),
      finalTokenCount: Math.ceil(truncated.length / 4),
      preservedSources: Array.isArray(context) ? context.map(c => c.source) : [],
    };
  },
};

describe('PromptEngine token budgeting edge cases', () => {
  it('summarizes conversation history when over ratio with utilityAI', async () => {
    const engine = new PromptEngine();
    await engine.initialize(baseConfig, dummyUtility);

    const history = makeHistory(40); // enough to exceed history budget ratio
    const components: PromptComponents = {
      systemPrompts: [{ content: 'Base system' }],
      conversationHistory: history,
      userInput: 'Hello world',
    };

    const res = await engine.constructPrompt(components, modelInfo);
    expect(res.wasTruncatedOrSummarized).toBe(true);
    expect(res.modificationDetails?.summarizedComponents).toContain('conversationHistory');
    // After summarization historyMessagesIncluded should reflect new smaller set
    expect(res.metadata.historyMessagesIncluded).toBeLessThan(history.length);
  });

  it('truncates RAG context when no utilityAI provided', async () => {
    const engine = new PromptEngine();
    await engine.initialize(baseConfig); // no utility AI
    const longContext = Array.from({ length: 30 }).map((_, i) => ({ source: `doc${i}`, content: 'C'.repeat(120) }));
    const components: PromptComponents = {
      systemPrompts: [{ content: 'Base system' }],
      userInput: 'Query',
      retrievedContext: longContext,
    };
    const res = await engine.constructPrompt(components, modelInfo);
    expect(res.wasTruncatedOrSummarized).toBe(true);
    expect(res.modificationDetails?.truncatedComponents).toContain('retrievedContext');
  });

  it('falls back to truncation when utilityAI summarization throws', async () => {
    const failingUtility: IPromptEngineUtilityAI = {
      async summarizeConversationHistory(
        _messages: Parameters<IPromptEngineUtilityAI["summarizeConversationHistory"]>[0]
      ) {
        throw new Error('history summarization failure');
      },
      async summarizeRAGContext(
        context: Parameters<IPromptEngineUtilityAI["summarizeRAGContext"]>[0],
        targetTokenCount: Parameters<IPromptEngineUtilityAI["summarizeRAGContext"]>[1],
        modelInfo: Parameters<IPromptEngineUtilityAI["summarizeRAGContext"]>[2]
      ) {
        return dummyUtility.summarizeRAGContext(context, targetTokenCount, modelInfo);
      },
    } as any;
    const engine = new PromptEngine();
    await engine.initialize(baseConfig, failingUtility);
    const history = makeHistory(50);
    const components: PromptComponents = { systemPrompts: [{ content: 'Sys' }], conversationHistory: history, userInput: 'hello' };
    const res = await engine.constructPrompt(components, modelInfo);
    const issueCodes = (res.issues || []).map((i: any) => i.code);
    expect(issueCodes).toContain('HISTORY_SUMMARIZATION_FAILED');
    expect(res.modificationDetails?.truncatedComponents).toContain('conversationHistory');
  });
});

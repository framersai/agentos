// File: packages/agentos/tests/core/prompt/PromptEngineToolManifest.spec.ts
import { describe, it, expect } from 'vitest';
import { PromptEngine } from '../../../src/core/llm/PromptEngine.js';
import { PromptEngineConfig, PromptComponents, ModelTargetInfo, IPromptEngineUtilityAI, PromptExecutionContext } from '../../../src/core/llm/IPromptEngine.js';
import { ITool } from '../../../src/core/tools/ITool.js';

const toolA: ITool = { id: 'tool.search', name: 'searchWeb', displayName: 'Search Web', description: 'Search engine', inputSchema: {}, outputSchema: {} } as any;
const toolB: ITool = { id: 'tool.calc', name: 'calculate', displayName: 'Calculator', description: 'Math ops', inputSchema: {}, outputSchema: {} } as any;
const toolC: ITool = { id: 'tool.weather', name: 'getWeather', displayName: 'Weather', description: 'Weather lookup', inputSchema: {}, outputSchema: {} } as any;

const baseConfig: PromptEngineConfig = {
  defaultTemplateName: 'openai_chat',
  availableTemplates: {},
  tokenCounting: { strategy: 'estimated' },
  historyManagement: { defaultMaxMessages: 20, maxTokensForHistory: 400, summarizationTriggerRatio: 0.8, preserveImportantMessages: false },
  contextManagement: { maxRAGContextTokens: 300, summarizationQualityTier: 'fast', preserveSourceAttributionInSummary: true },
  contextualElementSelection: { maxElementsPerType: {}, defaultMaxElementsPerType: 5, priorityResolutionStrategy: 'highest_first', conflictResolutionStrategy: 'skip_conflicting' },
  performance: { enableCaching: false, cacheTimeoutSeconds: 60 },
  toolSchemaManifest: {
    personaAlpha: {
      enabledToolIds: ['tool.search','tool.calc'],
      disabledToolIds: ['tool.calc'],
    },
    personaBeta: {
      enabledToolIds: ['tool.search','tool.calc','tool.weather'],
      modelOverrides: { 'model-x': ['tool.weather'] },
    }
  }
};

const modelInfo: ModelTargetInfo = {
  modelId: 'model-x',
  providerId: 'openai',
  maxContextTokens: 800,
  capabilities: ['chat','tool_use'],
  promptFormatType: 'openai_chat',
  toolSupport: { supported: true, format: 'openai_functions' },
};

function makeExecContext(personaId: string): PromptExecutionContext {
  return {
    activePersona: { id: personaId, contextualPromptElements: [] } as any,
    workingMemory: { get: () => undefined } as any,
  };
}

describe('PromptEngine tool schema manifest filtering', () => {
  it('applies enabled + disabled lists for personaAlpha', async () => {
    const engine = new PromptEngine();
    await engine.initialize(baseConfig);
    const components: PromptComponents = { systemPrompts: [{ content: 'Sys' }], tools: [toolA, toolB, toolC] };
    // Hack: attach currentExecutionContext so formatToolSchemasForModel sees persona
    (engine as any).currentExecutionContext = makeExecContext('personaAlpha');
    const res = await engine.constructPrompt(components, modelInfo, makeExecContext('personaAlpha'));
    // formattedToolSchemas should contain only tool.search (tool.calc disabled, weather not enabled)
    const names = res.formattedToolSchemas?.map((t: any) => t.function?.name);
    expect(names).toEqual(['searchWeb']);
  });

  it('applies model override for personaBeta on model-x', async () => {
    const engine = new PromptEngine();
    await engine.initialize(baseConfig);
    const components: PromptComponents = { systemPrompts: [{ content: 'Sys' }], tools: [toolA, toolB, toolC] };
    engine.setCurrentExecutionContext(makeExecContext('personaBeta'));
    const res = await engine.constructPrompt(components, modelInfo, makeExecContext('personaBeta'));
    const names = res.formattedToolSchemas?.map((t: any) => t.function?.name);
    // model override restricts to ['tool.weather'] only
    expect(names).toEqual(['getWeather']);
    const reasons = res.formattedToolSchemas?.map((t: any) => t._filteringReason);
    expect(reasons).toEqual(['included:model_override']);
  });

  it('falls back to all tools when persona absent from manifest', async () => {
    const engine = new PromptEngine();
    await engine.initialize(baseConfig);
    const components: PromptComponents = { systemPrompts: [{ content: 'Sys' }], tools: [toolA, toolB] };
    engine.setCurrentExecutionContext(makeExecContext('personaGamma'));
    const res = await engine.constructPrompt(components, modelInfo, makeExecContext('personaGamma'));
    const names = res.formattedToolSchemas?.map((t: any) => t.function?.name).sort();
    expect(names).toEqual(['calculate','searchWeb'].sort());
    const reasons = res.formattedToolSchemas?.map((t: any) => t._filteringReason);
    // No manifest entry => reasons undefined
    expect(reasons.filter((r: any) => r !== undefined).length).toBe(0);
  });
});
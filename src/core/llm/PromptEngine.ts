// File: backend/agentos/core/llm/PromptEngine.ts
/**
 * @fileoverview Implements the sophisticated PromptEngine that serves as the core of
 * AgentOS's adaptive and contextual prompting system. This implementation provides
 * intelligent prompt construction with dynamic contextual element selection,
 * token budgeting, multi-modal content integration, and optimization strategies.
 *
 * The PromptEngine orchestrates the entire prompt construction pipeline:
 * 1. Context Analysis: Evaluates execution context against persona-defined criteria.
 * 2. Element Selection: Dynamically selects applicable contextual prompt elements.
 * 3. Content Augmentation: Integrates selected elements with base prompt components.
 * 4. Token Management: Applies intelligent budgeting and content optimization.
 * 5. Template Formatting: Renders final prompts using model-specific templates.
 * 6. Quality Assurance: Validates output and reports issues/optimizations.
 *
 * @module backend/agentos/core/llm/PromptEngine
 * @implements {IPromptEngine}
 */

import {
  IPromptEngine,
  PromptEngineConfig,
  PromptComponents,
  ModelTargetInfo,
  PromptExecutionContext,
  FormattedPrompt,
  PromptEngineResult,
  PromptTemplateFunction,
  ContextualElementType,
  PromptEngineError,
  IPromptEngineUtilityAI,
  TokenEstimator,
  VisionInputData, // Assuming VisionInputData is exported from IPromptEngine or IGMI via IPromptEngine
} from './IPromptEngine';
import {
  IPersonaDefinition,
  ContextualPromptElement,
  ContextualPromptElementCriteria,
} from '../../cognitive_substrate/personas/IPersonaDefinition';
import { ConversationMessage as Message, MessageRole, ConversationToolCallRequest } from '../conversation/ConversationMessage'; // Corrected import: Used alias and added MessageRole
import { ChatMessage, MessageContentPart } from './providers/IProvider'; // Added MessageContentPart
import { ITool, JSONSchemaObject } from '../tools/ITool'; // Corrected import path


/**
 * Cache entry structure for optimization and performance tracking.
 * @interface CacheEntry
 * @private
 */
interface CacheEntry {
  key: string;
  result: PromptEngineResult;
  timestamp: number;
  accessCount: number;
  modelId: string;
  estimatedTokenCount: number;
}

/**
 * Statistics tracking for performance monitoring and optimization.
 * @interface EngineStatisticsInternal
 * @private
 */
interface EngineStatisticsInternal {
  totalPromptsConstructed: number;
  totalConstructionTimeMs: number;
  cacheHits: number;
  cacheMisses: number;
  contextualElementSelections: Record<string, number>;
  tokenCountingOperations: number;
  errorsByType: Record<string, number>;
  performanceTimers: Record<string, { count: number; totalTimeMs: number; averageTimeMs: number }>; // Added averageTimeMs
}


/**
 * Comprehensive implementation of the IPromptEngine interface, providing
 * sophisticated adaptive prompting capabilities for AgentOS GMIs.
 *
 * @class PromptEngine
 * @implements {IPromptEngine}
 */
export class PromptEngine implements IPromptEngine {
  private config!: Readonly<PromptEngineConfig>;
  private utilityAI?: IPromptEngineUtilityAI;
  private isInitialized: boolean = false;
  /**
   * Current execution context used implicitly for operations (e.g., tool manifest filtering) when
   * a context is not passed directly. This is set via `setCurrentExecutionContext` by orchestration layers.
   * Avoids leaking context through multiple method signatures while still enabling persona-scoped behavior.
   */
  private currentExecutionContext?: Readonly<PromptExecutionContext>;

  private cache: Map<string, CacheEntry> = new Map();
  private statistics: EngineStatisticsInternal = this.getInitialStatistics();

  private readonly defaultTemplates: Record<string, PromptTemplateFunction>;

  constructor() {
    this.defaultTemplates = {
      'openai_chat': this.createOpenAIChatTemplate(),
      'anthropic_messages': this.createAnthropicMessagesTemplate(),
      'generic_completion': this.createGenericCompletionTemplate(),
    };
  }

  public async initialize(
    config: PromptEngineConfig,
    utilityAI?: IPromptEngineUtilityAI
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn('PromptEngine: Re-initializing an already initialized engine. State will be reset.');
      this.cache.clear();
      this.statistics = this.getInitialStatistics();
    }

    this.validateEngineConfiguration(config);

    this.config = Object.freeze({ ...config });
    this.utilityAI = utilityAI;

    this.config = Object.freeze({
      ...this.config,
      availableTemplates: {
        ...this.defaultTemplates,
        ...(config.availableTemplates || {}),
      },
    });

    if (this.config.performance.enableCaching) {
      this.setupCacheEviction();
    }

    this.isInitialized = true;
    console.log(`PromptEngine initialized successfully. Default template: '${this.config.defaultTemplateName}'. Available templates: ${Object.keys(this.config.availableTemplates).length}.`);
  }

  /**
   * Sets the current execution context for implicit persona-aware operations (e.g., tool filtering).
   * Passing undefined clears the context.
   */
  public setCurrentExecutionContext(ctx?: Readonly<PromptExecutionContext>): void {
    this.currentExecutionContext = ctx;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new PromptEngineError(
        'PromptEngine is not initialized. Call initialize() first.',
        'ENGINE_NOT_INITIALIZED',
        'PromptEngineCore'
      );
    }
  }

  private getInitialStatistics(): EngineStatisticsInternal {
    return {
      totalPromptsConstructed: 0,
      totalConstructionTimeMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      contextualElementSelections: {},
      tokenCountingOperations: 0,
      errorsByType: {},
      performanceTimers: {}, // Timers will be added with averageTimeMs initialized to 0
    };
  }

  public async constructPrompt(
    baseComponents: Readonly<PromptComponents>,
    modelTargetInfo: Readonly<ModelTargetInfo>,
    executionContext?: Readonly<PromptExecutionContext>,
    templateName?: string
  ): Promise<PromptEngineResult> {
    this.ensureInitialized();
    const constructionStart = Date.now();
    this.statistics.totalPromptsConstructed++;

    const result: PromptEngineResult = {
      prompt: [],
      wasTruncatedOrSummarized: false,
      issues: [],
      metadata: {
        constructionTimeMs: 0,
        selectedContextualElementIds: [],
        templateUsed: templateName || modelTargetInfo.promptFormatType || this.config.defaultTemplateName,
        totalSystemPromptsApplied: 0,
        historyMessagesIncluded: 0,
      },
    };

    if (this.config.performance.enableCaching) {
      const cacheKey = this.generateCacheKey(baseComponents, modelTargetInfo, executionContext, result.metadata.templateUsed);
      result.cacheKey = cacheKey;
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.config.performance.cacheTimeoutSeconds * 1000) {
        this.statistics.cacheHits++;
        cached.accessCount++;
        return JSON.parse(JSON.stringify(cached.result));
      }
      this.statistics.cacheMisses++;
    }

    try {
      let selectedElements: ContextualPromptElement[] = [];
      // Corrected: use contextualPromptElements directly from IPersonaDefinition
      if (executionContext?.activePersona?.contextualPromptElements) {
        const timerId = 'contextualElementSelection';
        this.startPerformanceTimer(timerId);
        // Corrected: use contextualPromptElements directly
        for (const element of executionContext.activePersona.contextualPromptElements) {
          if (element.criteria && await this.evaluateCriteria(element.criteria, executionContext)) {
            selectedElements.push(element);
          }
        }
        selectedElements.sort((a,b) => (b.priority || 0) - (a.priority || 0));
        const maxElementsOverall = 10; // Example
        selectedElements = selectedElements.slice(0, maxElementsOverall);

        result.metadata.selectedContextualElementIds = selectedElements.map(el => el.id || 'unnamed_contextual_element');
        this.recordPerformanceTimer(timerId, Date.now() - constructionStart); // Pass actual duration
        selectedElements.forEach(el => this.statistics.contextualElementSelections[el.id || el.type] = (this.statistics.contextualElementSelections[el.id || el.type] || 0) + 1);
      }

      const augmentedComponents = this.augmentBaseComponents(baseComponents, selectedElements);

      const timerIdBudget = 'tokenBudgeting';
      const budgetStart = Date.now();
      this.startPerformanceTimer(timerIdBudget);
      const { optimizedComponents, modifications } = await this.applyTokenBudget(
        augmentedComponents,
        modelTargetInfo,
        result.issues || []
      );
      result.wasTruncatedOrSummarized = modifications.wasModified;
      result.modificationDetails = modifications.details;
      this.recordPerformanceTimer(timerIdBudget, Date.now() - budgetStart);


      const timerIdTemplate = 'templateApplication';
      const templateStart = Date.now();
      this.startPerformanceTimer(timerIdTemplate);
      const templateFn = this.config.availableTemplates[result.metadata.templateUsed];
      if (!templateFn) {
        throw new PromptEngineError(`Template '${result.metadata.templateUsed}' not found.`, 'TEMPLATE_NOT_FOUND', 'TemplateApplication');
      }
      result.prompt = await templateFn(
        optimizedComponents,
        modelTargetInfo,
        selectedElements,
        this.config,
        (content, modelId) => this.estimateTokenCount(content, modelId || modelTargetInfo.modelId)
      );
      this.recordPerformanceTimer(timerIdTemplate, Date.now() - templateStart);

      result.estimatedTokenCount = await this.estimateTokenCount(
        typeof result.prompt === 'string' ? result.prompt : JSON.stringify(result.prompt),
        modelTargetInfo.modelId
      );
      result.metadata.totalSystemPromptsApplied = optimizedComponents.systemPrompts?.length || 0;
      result.metadata.historyMessagesIncluded = optimizedComponents.conversationHistory?.length || 0;
      if(optimizedComponents.retrievedContext){
        result.metadata.ragContextTokensUsed = await this.estimateTokenCount(
          typeof optimizedComponents.retrievedContext === 'string' ? optimizedComponents.retrievedContext : JSON.stringify(optimizedComponents.retrievedContext),
          modelTargetInfo.modelId
        );
      }

      if (optimizedComponents.tools && optimizedComponents.tools.length > 0 && modelTargetInfo.toolSupport.supported) {
        result.formattedToolSchemas = this.formatToolSchemasForModel(optimizedComponents.tools, modelTargetInfo);
      }

    } catch (error: unknown) {
      const err = (error instanceof PromptEngineError) ? error :
        new PromptEngineError(
          error instanceof Error ? error.message : 'Unknown error during prompt construction.',
          'UNHANDLED_CONSTRUCTION_ERROR',
          'ConstructPromptCore',
          error
        );
      result.issues = result.issues || [];
      result.issues.push({
        type: 'error',
        code: err.code,
        message: err.message,
        details: err.details,
        component: err.component || 'ConstructPromptPipeline',
      });
      this.statistics.errorsByType[err.code] = (this.statistics.errorsByType[err.code] || 0) + 1;
    } finally {
      result.metadata.constructionTimeMs = Date.now() - constructionStart;
      this.statistics.totalConstructionTimeMs += result.metadata.constructionTimeMs;
    }

    if (result.cacheKey && this.config.performance.enableCaching && (result.issues?.every(i => i.type !== 'error'))) {
      this.cache.set(result.cacheKey, {
        key: result.cacheKey,
        result: JSON.parse(JSON.stringify(result)),
        timestamp: Date.now(),
        accessCount: 0,
        modelId: modelTargetInfo.modelId,
        estimatedTokenCount: result.estimatedTokenCount || 0,
      });
    }
    return result;
  }

  public async evaluateCriteria(
    criteria: Readonly<ContextualPromptElementCriteria>,
    context: Readonly<PromptExecutionContext>
  ): Promise<boolean> {
    this.ensureInitialized();
    const timerId = 'evaluateCriteria';
    const evalStart = Date.now();
    this.startPerformanceTimer(timerId);

    let overallMatch = true;

    if (criteria.mood && context.currentMood !== criteria.mood) overallMatch = false;
    if (overallMatch && criteria.userSkillLevel && context.userSkillLevel !== criteria.userSkillLevel) overallMatch = false;
    if (overallMatch && criteria.taskHint && !context.taskHint?.includes(criteria.taskHint)) overallMatch = false;
    if (overallMatch && criteria.taskComplexity && context.taskComplexity !== criteria.taskComplexity) overallMatch = false;
    if (overallMatch && criteria.language && context.language !== criteria.language) overallMatch = false;

    if (overallMatch && criteria.conversationSignals && criteria.conversationSignals.length > 0) {
      // Corrected: Added type for 's'
      if (!criteria.conversationSignals.every((s: string) => context.conversationSignals?.includes(s))) {
        overallMatch = false;
      }
    }
    if (overallMatch && criteria.workingMemoryQuery) {
      console.warn("Working memory query evaluation in PromptEngine is a placeholder.");
    }

    this.recordPerformanceTimer(timerId, Date.now() - evalStart);
    return overallMatch;
  }

  public async estimateTokenCount(content: string, modelId?: string): Promise<number> {
    this.ensureInitialized();
    this.statistics.tokenCountingOperations++;
    const timerId = 'estimateTokenCount';
    const estimateStart = Date.now();
    this.startPerformanceTimer(timerId);

    if (!content) return 0;
    let count = Math.ceil(content.length / 4);

    if (modelId?.includes('gpt-4')) count = Math.ceil(content.length / 3.8);
    else if (modelId?.includes('claude')) count = Math.ceil(content.length / 4.2);

    this.recordPerformanceTimer(timerId, Date.now() - estimateStart);
    return count;
  }

  public async registerTemplate(
    templateName: string,
    templateFunction: PromptTemplateFunction
  ): Promise<void> {
    this.ensureInitialized();
    if (!templateName || typeof templateName !== 'string' || templateName.trim() === '') {
      throw new PromptEngineError('Template name must be a non-empty string.', 'INVALID_TEMPLATE_NAME', 'RegisterTemplate');
    }
    if (typeof templateFunction !== 'function') {
      throw new PromptEngineError('Template function must be a valid function.', 'INVALID_TEMPLATE_FUNCTION', 'RegisterTemplate');
    }

    const mutableTemplates = this.config.availableTemplates as Record<string, PromptTemplateFunction>;
    if (mutableTemplates[templateName]) {
      console.warn(`PromptEngine: Overwriting existing template '${templateName}'.`);
    }
    mutableTemplates[templateName] = templateFunction;
    console.log(`PromptEngine: Template '${templateName}' registered.`);
  }

  public async validatePromptConfiguration(
    components: Readonly<PromptComponents>,
    modelTargetInfo: Readonly<ModelTargetInfo>,
    executionContext?: Readonly<PromptExecutionContext>
  ): Promise<{
    isValid: boolean;
    issues: Array<{ type: 'error' | 'warning'; code: string; message: string; suggestion?: string; component?: string; }>;
    recommendations?: string[];
  }> {
    this.ensureInitialized();
    const issues: Array<{ type: 'error' | 'warning'; code: string; message: string; suggestion?: string; component?: string;}> = [];
    const recommendations: string[] = [];

    if (components.visionInputs && components.visionInputs.length > 0 && !modelTargetInfo.visionSupport?.supported) {
      issues.push({ type: 'error', code: 'VISION_NOT_SUPPORTED', message: `Model ${modelTargetInfo.modelId} does not support vision inputs.`, component: 'visionInputs' });
    }
    if (components.tools && components.tools.length > 0 && !modelTargetInfo.toolSupport.supported) {
      issues.push({ type: 'error', code: 'TOOLS_NOT_SUPPORTED', message: `Model ${modelTargetInfo.modelId} does not support tools/functions.`, component: 'tools' });
    }

    let estimatedTokens = 0;
    if (components.systemPrompts) estimatedTokens += (await Promise.all(components.systemPrompts.map(sp => this.estimateTokenCount(sp.content, modelTargetInfo.modelId)))).reduce((a,b) => a+b, 0);
    if (components.userInput) estimatedTokens += await this.estimateTokenCount(components.userInput, modelTargetInfo.modelId);
    if (components.conversationHistory) estimatedTokens += await this.calculateTokensForMessages(components.conversationHistory, modelTargetInfo.modelId); // Corrected: Call fixed calculateTokensForMessages


    if (estimatedTokens > modelTargetInfo.maxContextTokens) {
      issues.push({ type: 'warning', code: 'POTENTIAL_TOKEN_OVERFLOW', message: `Estimated initial token count (${estimatedTokens}) exceeds model's max context (${modelTargetInfo.maxContextTokens}). Relying on truncation/summarization.`, component: 'OverallPrompt' });
    } else if (estimatedTokens > (modelTargetInfo.optimalContextTokens || modelTargetInfo.maxContextTokens) * 0.8) {
      recommendations.push(`Consider reducing initial prompt length; current estimate (${estimatedTokens}) is >80% of optimal/max context.`);
    }

    if (!components.systemPrompts || components.systemPrompts.length === 0) {
      recommendations.push("Consider adding a system prompt to guide the GMI's behavior more effectively.");
    }

    // Corrected: Use contextualPromptElements directly
    if (executionContext?.activePersona?.contextualPromptElements) {
      recommendations.push("Review persona's contextual elements to ensure they align with expected execution contexts.");
    }

    return { isValid: !issues.some(i => i.type === 'error'), issues, recommendations };
  }

  public async clearCache(selectivePattern?: string): Promise<void> {
    this.ensureInitialized();
    if (!this.config.performance.enableCaching) {
      console.warn("PromptEngine: Cache clearing attempted but caching is disabled.");
      return;
    }
    if (selectivePattern) {
      let clearedCount = 0;
      const regex = new RegExp(selectivePattern);
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
          clearedCount++;
        }
      }
      console.log(`PromptEngine: Cleared ${clearedCount} cache entries matching pattern '${selectivePattern}'.`);
    } else {
      this.cache.clear();
      console.log("PromptEngine: All cache entries cleared.");
    }
    this.statistics.cacheHits = 0;
    this.statistics.cacheMisses = 0;
  }

  public async getEngineStatistics(): Promise<{
    totalPromptsConstructed: number;
    averageConstructionTimeMs: number;
    cacheStats: { hits: number; misses: number; currentSize: number; maxSize?: number; effectivenessRatio: number; };
    tokenCountingStats: { operations: number; averageAccuracy?: number; };
    contextualElementUsage: Record<string, { count: number; averageEvaluationTimeMs?: number; }>;
    errorRatePerType: Record<string, number>;
    performanceTimers: Record<string, { count: number; totalTimeMs: number; averageTimeMs: number; }>;
  }> {
    this.ensureInitialized();
    const totalCacheAccesses = this.statistics.cacheHits + this.statistics.cacheMisses;
    const cacheEffectiveness = totalCacheAccesses > 0 ? this.statistics.cacheHits / totalCacheAccesses : 0;

    const contextualElementUsageWithAvgTime: Record<string, { count: number; averageEvaluationTimeMs?: number; }> = {};
    for(const key in this.statistics.contextualElementSelections) {
      contextualElementUsageWithAvgTime[key] = {
        count: this.statistics.contextualElementSelections[key],
      };
    }

    // Calculate averageTimeMs for performanceTimers before returning
    const calculatedPerformanceTimers: Record<string, { count: number; totalTimeMs: number; averageTimeMs: number; }> = {};
    for (const key in this.statistics.performanceTimers) {
      const timer = this.statistics.performanceTimers[key];
      calculatedPerformanceTimers[key] = {
        ...timer,
        averageTimeMs: timer.count > 0 ? timer.totalTimeMs / timer.count : 0,
      };
    }


    return {
      totalPromptsConstructed: this.statistics.totalPromptsConstructed,
      averageConstructionTimeMs: this.statistics.totalPromptsConstructed > 0 ? this.statistics.totalConstructionTimeMs / this.statistics.totalPromptsConstructed : 0,
      cacheStats: {
        hits: this.statistics.cacheHits,
        misses: this.statistics.cacheMisses,
        currentSize: this.cache.size,
        maxSize: this.config.performance.maxCacheSizeBytes,
        effectivenessRatio: cacheEffectiveness,
      },
      tokenCountingStats: {
        operations: this.statistics.tokenCountingOperations,
      },
      contextualElementUsage: contextualElementUsageWithAvgTime,
      errorRatePerType: { ...this.statistics.errorsByType },
      performanceTimers: calculatedPerformanceTimers, // Use calculated version
    };
  }

  private validateEngineConfiguration(config: PromptEngineConfig): void {
    if (!config.defaultTemplateName || typeof config.defaultTemplateName !== 'string') {
      throw new PromptEngineError('Invalid `defaultTemplateName` in configuration.', 'INVALID_CONFIG_PARAM', 'Initialization');
    }
    if (!config.availableTemplates || typeof config.availableTemplates !== 'object') {
      throw new PromptEngineError('Invalid `availableTemplates` in configuration.', 'INVALID_CONFIG_PARAM', 'Initialization');
    }
    if (!config.tokenCounting || typeof config.tokenCounting.strategy !== 'string') {
      throw new PromptEngineError('Invalid `tokenCounting` strategy in configuration.', 'INVALID_CONFIG_PARAM', 'Initialization');
    }
  }

  private generateCacheKey(
    components: Readonly<PromptComponents>,
    modelInfo: Readonly<ModelTargetInfo>,
    executionContext?: Readonly<PromptExecutionContext>,
    templateName?: string
  ): string {
    /**
     * Generates a stable cache key for a prospective prompt construction result.
     * Key Composition Strategy (intentional truncation for privacy & size):
     *  - First 50 chars of each system prompt concatenated (order sensitive)
     *  - First 100 chars of user input
     *  - Last turn content excerpt (first 50 chars) for light history sensitivity
     *  - Tool id list (joined)
     *  - Model id, template name, persona id, mood, task hint
     *
     * Hashing: Simple 32‑bit additive hash -> base36 to keep key short; collision risk acceptable for cache.
     *
     * NOTE: Omits retrievedContext & full history intentionally to avoid large keys and leaking RAG content into logs.
     */
    const relevantData = {
      system: components.systemPrompts?.map(p => p.content.substring(0,50)).join(';'),
      userInput: components.userInput?.substring(0,100),
      historyLastTurn: components.conversationHistory?.[components.conversationHistory.length -1]?.content?.toString().substring(0,50),
      tools: components.tools?.map(t => t.id).join(','),
      modelId: modelInfo.modelId,
      template: templateName,
      personaId: executionContext?.activePersona.id,
      mood: executionContext?.currentMood,
      task: executionContext?.taskHint,
    };
    const keyString = Object.values(relevantData).filter(v => v !== undefined).join('||');
    let hash = 0;
    for (let i = 0; i < keyString.length; i++) {
      const char = keyString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `promptcache:${modelInfo.modelId}:${hash.toString(36)}`;
  }

  private setupCacheEviction(): void {
    /**
     * Periodic passive cache eviction loop. Strategy:
     *  - Run every half of timeout window (min 60s)
     *  - Drop entries whose age > configured timeout.
     * No size‑based LRU yet; maxCacheSizeBytes reserved for future implementation.
     */
    const interval = (this.config.performance.cacheTimeoutSeconds / 2) * 1000;
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if ((now - entry.timestamp) > this.config.performance.cacheTimeoutSeconds * 1000) {
          this.cache.delete(key);
        }
      }
    }, Math.max(interval, 60000));
  }

  private startPerformanceTimer(timerId: string): void {
    if (!this.statistics.performanceTimers[timerId]) {
      // Initialize with averageTimeMs
      this.statistics.performanceTimers[timerId] = { count: 0, totalTimeMs: 0, averageTimeMs: 0 };
    }
  }

  private recordPerformanceTimer(timerId: string, durationMs?: number): void {
    const DUMMY_DURATION = 10;
    const actualDuration = durationMs !== undefined ? durationMs : DUMMY_DURATION;

    const timer = this.statistics.performanceTimers[timerId];
    if(timer){
      timer.count++;
      timer.totalTimeMs += actualDuration;
      // averageTimeMs will be calculated in getEngineStatistics to avoid repetitive division
    }
  }

  private augmentBaseComponents(
    base: Readonly<PromptComponents>,
    selectedElements: ReadonlyArray<ContextualPromptElement>
  ): PromptComponents {
    /**
     * Applies selected contextual elements onto the immutable base components producing a mutable augmented copy.
     * Merging Rules:
     *  - System prompt augmenters append as new system prompts with synthetic source tag.
     *  - Few‑shot examples accumulate under customComponents.fewShotExamples.
     *  - User prompt augmentation concatenates onto existing userInput (newline separated).
     *  - All other element types fall back to a dynamic bucket keyed by normalized type.
     * Sorting: Final systemPrompts sorted ascending by priority to preserve intended ordering.
     */
    const augmented = JSON.parse(JSON.stringify(base)) as PromptComponents;

    if (!augmented.systemPrompts) augmented.systemPrompts = [];
    if (!augmented.customComponents) augmented.customComponents = {};

    for (const element of selectedElements) {
      switch (element.type) {
        case ContextualElementType.SYSTEM_INSTRUCTION_ADDON:
        case ContextualElementType.BEHAVIORAL_GUIDANCE:
        case ContextualElementType.TASK_SPECIFIC_INSTRUCTION:
        case ContextualElementType.ERROR_HANDLING_GUIDANCE:
        case ContextualElementType.ETHICAL_GUIDELINE:
        case ContextualElementType.OUTPUT_FORMAT_SPEC:
        case ContextualElementType.REASONING_PROTOCOL:
          augmented.systemPrompts.push({ content: element.content as string, priority: element.priority || 100, source: `contextual:${element.id || element.type}` });
          break;
        case ContextualElementType.FEW_SHOT_EXAMPLE:
          if (!augmented.customComponents.fewShotExamples) augmented.customComponents.fewShotExamples = [];
          (augmented.customComponents.fewShotExamples as unknown[]).push(element.content);
          break;
        case ContextualElementType.USER_PROMPT_AUGMENTATION:
          augmented.userInput = `${augmented.userInput || ''}\n${element.content as string}`.trim();
          break;
        default:
          const typeKey = element.type.toString().toLowerCase().replace(/_/g, '');
          if (!augmented.customComponents[typeKey]) augmented.customComponents[typeKey] = [];
          (augmented.customComponents[typeKey] as unknown[]).push(element.content);
          break;
      }
    }
    augmented.systemPrompts.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    return augmented;
  }

  private async applyTokenBudget(
    components: PromptComponents,
    modelInfo: Readonly<ModelTargetInfo>,
    issues: PromptEngineResult['issues']
  ): Promise<{ optimizedComponents: PromptComponents; modifications: { wasModified: boolean; details: PromptEngineResult['modificationDetails'] } }> {
    /**
     * Enforces token budget across prompt sections (system, userInput, history, RAG context, tools).
     * Allocation Heuristics (percentages of overall budget):
     *  - system: 20%, user: 15%, history: 35%, rag: 20%, tools: 10%
     * Summarization: Uses UtilityAI if available & trigger ratio exceeded; else truncation fallback.
     * Failure Handling: On summarization errors pushes warning issue & falls back to truncation.
     * Returns cloned optimized components plus modification descriptors for telemetry.
     */
    const optimized = JSON.parse(JSON.stringify(components)) as PromptComponents;
    const modifications: { wasModified: boolean; details: PromptEngineResult['modificationDetails'] } = {
      wasModified: false,
      details: { truncatedComponents: [], summarizedComponents: [], removedComponents: [], originalEstimatedTokenCount: 0 }
    };

    const budget = modelInfo.optimalContextTokens || modelInfo.maxContextTokens;
    let currentTokens = await this.calculateTotalTokens(optimized, modelInfo.modelId);
    modifications.details!.originalEstimatedTokenCount = currentTokens;

    const budgets = {
      system: 0.20 * budget,
      userInput: 0.15 * budget,
      history: 0.35 * budget,
      rag: 0.20 * budget,
      tools: 0.10 * budget,
    };

    if (optimized.conversationHistory && optimized.conversationHistory.length > 0) {
      let historyTokens = await this.calculateTokensForMessages(optimized.conversationHistory, modelInfo.modelId);
      if (historyTokens > budgets.history || currentTokens > budget) {
        const originalCount = optimized.conversationHistory.length;
        if (this.utilityAI && this.config.historyManagement.summarizationTriggerRatio > 0 && (historyTokens / budgets.history > this.config.historyManagement.summarizationTriggerRatio)) {
          try {
            const { summaryMessages, finalTokenCount } = await this.utilityAI.summarizeConversationHistory(
              optimized.conversationHistory,
              (currentTokens > budget) ? budgets.history - (currentTokens - budget) : budgets.history,
              modelInfo,
              this.config.historyManagement.preserveImportantMessages
            );
            optimized.conversationHistory = summaryMessages;
            modifications.details!.summarizedComponents!.push('conversationHistory');
            modifications.wasModified = true;
            currentTokens = currentTokens - historyTokens + finalTokenCount;
            historyTokens = finalTokenCount;
          } catch (e) {
            issues?.push({type: 'warning', code: 'HISTORY_SUMMARIZATION_FAILED', message: `History summarization failed: ${e instanceof Error ? e.message : String(e)}`});
            optimized.conversationHistory = this.truncateMessages(optimized.conversationHistory, budgets.history, (content) => this.estimateTokenCount(content, modelInfo.modelId));
            modifications.details!.truncatedComponents!.push('conversationHistory');
            modifications.wasModified = true;
            const newHistoryTokens = await this.calculateTokensForMessages(optimized.conversationHistory, modelInfo.modelId);
            currentTokens = currentTokens - historyTokens + newHistoryTokens;
            historyTokens = newHistoryTokens;
          }
        } else {
          optimized.conversationHistory = this.truncateMessages(optimized.conversationHistory, budgets.history, (content) => this.estimateTokenCount(content, modelInfo.modelId));
          if(optimized.conversationHistory.length < originalCount) {
            modifications.details!.truncatedComponents!.push('conversationHistory');
            modifications.wasModified = true;
          }
          const newHistoryTokens = await this.calculateTokensForMessages(optimized.conversationHistory, modelInfo.modelId);
          currentTokens = currentTokens - historyTokens + newHistoryTokens;
          historyTokens = newHistoryTokens;
        }
      }
    }

    if (optimized.retrievedContext) {
      const contextStr = typeof optimized.retrievedContext === 'string' ? optimized.retrievedContext : optimized.retrievedContext.map(r => r.content).join('\n');
      let ragTokens = await this.estimateTokenCount(contextStr, modelInfo.modelId);
      if (ragTokens > budgets.rag || currentTokens > budget) {
        if (this.utilityAI) {
          try {
            const { summary, finalTokenCount } = await this.utilityAI.summarizeRAGContext(
              optimized.retrievedContext,
              (currentTokens > budget) ? budgets.rag - (currentTokens - budget) : budgets.rag,
              modelInfo,
              this.config.contextManagement.preserveSourceAttributionInSummary
            );
            optimized.retrievedContext = summary;
            modifications.details!.summarizedComponents!.push('retrievedContext');
            modifications.wasModified = true;
            currentTokens = currentTokens - ragTokens + finalTokenCount;
            ragTokens = finalTokenCount;
          } catch(e){
            issues?.push({type: 'warning', code: 'RAG_SUMMARIZATION_FAILED', message: `RAG summarization failed: ${e instanceof Error ? e.message : String(e)}`});
            optimized.retrievedContext = contextStr.substring(0, Math.floor(contextStr.length * (budgets.rag / ragTokens)));
            modifications.details!.truncatedComponents!.push('retrievedContext');
            modifications.wasModified = true;
            const newRagTokens = await this.estimateTokenCount(optimized.retrievedContext as string, modelInfo.modelId);
            currentTokens = currentTokens - ragTokens + newRagTokens;
            ragTokens = newRagTokens;
          }
        } else {
          optimized.retrievedContext = contextStr.substring(0, Math.floor(contextStr.length * (budgets.rag / ragTokens)));
          modifications.details!.truncatedComponents!.push('retrievedContext');
          modifications.wasModified = true;
          const newRagTokens = await this.estimateTokenCount(optimized.retrievedContext as string, modelInfo.modelId);
          currentTokens = currentTokens - ragTokens + newRagTokens;
          ragTokens = newRagTokens;
        }
      }
    }

    if (currentTokens > budget && issues) {
      issues.push({ type: 'warning', code: 'TOKEN_BUDGET_EXCEEDED_POST_OPT', message: `Prompt still exceeds budget (${currentTokens}/${budget}) after initial optimizations. Quality may be affected.`});
    }

    return { optimizedComponents: optimized, modifications };
  }

  private async calculateTotalTokens(components: PromptComponents, modelId: string): Promise<number> {
    let total = 0;
    if(components.systemPrompts) total += (await Promise.all(components.systemPrompts.map(sp => this.estimateTokenCount(sp.content, modelId)))).reduce((a,b) => a+b, 0);
    if(components.userInput) total += await this.estimateTokenCount(components.userInput, modelId);
    if(components.conversationHistory) total += await this.calculateTokensForMessages(components.conversationHistory, modelId);
    if(components.retrievedContext) {
      const contextStr = typeof components.retrievedContext === 'string' ? components.retrievedContext : components.retrievedContext.map(r => r.content).join('\n');
      total += await this.estimateTokenCount(contextStr, modelId);
    }
    if(components.tools) total += components.tools.length * 50;
    return total;
  }

  private async calculateTokensForMessages(messages: Message[], modelId: string): Promise<number> {
    if (!messages) return 0;
    let sum = 0;
    for (const msg of messages) {
      // Corrected: Handle different types of msg.content
      if (typeof msg.content === 'string') {
        sum += await this.estimateTokenCount(msg.content, modelId);
      } else if (Array.isArray(msg.content)) { // Multi-part content
        for (const part of msg.content as MessageContentPart[]) { // Use MessageContentPart type
          if (part.type === 'text' && typeof part.text === 'string') {
            sum += await this.estimateTokenCount(part.text, modelId);
          } else if (part.type === 'image_url' && part.image_url) {
            sum += 70; // Base cost for image URL
            if (part.image_url.detail === 'high') sum += 65; // Additional for high-res
          }
        }
      } else if (msg.content === null) {
        // No content tokens, but message overhead still applies
      } else if (typeof msg.content === 'object' && msg.content !== null) {
        // This case should not be common if msg.content is Array for multi-part, but as a fallback:
        sum += await this.estimateTokenCount(JSON.stringify(msg.content), modelId);
      }
      sum += 5; // Overhead for role, name, etc.
    }
    return sum;
  }

  private truncateMessages(messages: Message[], targetTokenCount: number, estimateFn: TokenEstimator): Message[] {
    let currentTokens = messages.reduce((sum, msg) => sum + (typeof msg.content === 'string' ? msg.content.length : (Array.isArray(msg.content) ? JSON.stringify(msg.content).length : 50)) , 0) / 4; // More robust rough estimate
    while(currentTokens > targetTokenCount && messages.length > 1) {
      const removedMsg = messages.shift();
      currentTokens -= (typeof removedMsg?.content === 'string' ? removedMsg.content.length : (Array.isArray(removedMsg?.content) ? JSON.stringify(removedMsg?.content).length : 50)) / 4;
    }
    return messages;
  }

  private formatToolSchemasForModel(tools: ITool[], modelInfo: Readonly<ModelTargetInfo>): any[] {
    /**
     * Normalizes internal ITool definitions to provider‑specific function/tool schema payloads.
     * Currently supports:
     *  - openai_functions: Emits array of { type: 'function', function: { name, description, parameters } }
     * Fallback path returns simplified definitions for unsupported formats with a console warning.
     *
     * Tool Schema Manifest Filtering:
     * If `config.toolSchemaManifest` specifies rules for the active persona, apply them BEFORE formatting:
     *   - model override list (exact allowed IDs) takes highest precedence.
     *   - enabledToolIds whitelist applied if present (intersection).
     *   - disabledToolIds removed at end.
     * Unknown IDs in manifest are ignored. If filtering results in empty set, returns [].
     */
    if (!modelInfo.toolSupport.supported || !tools || tools.length === 0) {
      return [];
    }
    // Manifest filtering
    let filtered = tools;
    const filteringReasons: Record<string, string> = {};
    const personaId = this.currentExecutionContext?.activePersona?.id || undefined;
    const manifestEntry = personaId ? this.config.toolSchemaManifest?.[personaId] : undefined;
    if (manifestEntry) {
      const { modelOverrides, enabledToolIds, disabledToolIds } = manifestEntry;
      if (modelOverrides && modelOverrides[modelInfo.modelId]) {
        const allowedList = new Set(modelOverrides[modelInfo.modelId]);
        filtered = filtered.filter(t => {
          const keep = allowedList.has(t.id);
          if (!keep) filteringReasons[t.id] = 'excluded:not_in_model_override_list';
          else filteringReasons[t.id] = 'included:model_override';
          return keep;
        });
      } else if (enabledToolIds && enabledToolIds.length > 0) {
        const allowed = new Set(enabledToolIds);
        filtered = filtered.filter(t => {
          const keep = allowed.has(t.id);
          if (!keep) filteringReasons[t.id] = 'excluded:not_in_enabled_tool_ids';
          else filteringReasons[t.id] = 'included:enabled_tool_ids';
          return keep;
        });
      }
      if (disabledToolIds && disabledToolIds.length > 0) {
        const blocked = new Set(disabledToolIds);
        filtered = filtered.filter(t => {
          const blockedOut = blocked.has(t.id);
          if (blockedOut) filteringReasons[t.id] = 'excluded:disabled_tool_ids';
          return !blockedOut;
        });
      }
    }
    if (filtered.length === 0) return [];
    switch (modelInfo.toolSupport.format) {
      case 'openai_functions':
        return filtered.map(tool => ({
          type: 'function',
          function: this.buildToolDefinition(tool),
          _filteringReason: filteringReasons[tool.id],
        }));
      default:
        console.warn(`PromptEngine: Tool format '${modelInfo.toolSupport.format}' not fully supported for schema generation. Returning normalized definitions.`);
        return filtered.map(tool => ({ ...this.buildToolDefinition(tool), _filteringReason: filteringReasons[tool.id] }));
    }
  }

  private buildToolDefinition(tool: ITool): { name: string; description: string; parameters: JSONSchemaObject } {
    return {
      name: tool.name || tool.id,
      description: tool.description || tool.displayName || tool.name,
      parameters:
        tool.inputSchema && Object.keys(tool.inputSchema).length > 0
          ? tool.inputSchema
          : { type: 'object', properties: {}, additionalProperties: false },
    };
  }

  private serializeToolArguments(args: unknown): string {
    if (typeof args === 'string') {
      return args;
    }
    try {
      return JSON.stringify(args ?? {});
    } catch (error) {
      console.warn('PromptEngine: Failed to stringify tool arguments for function call.', error);
      return '{}';
    }
  }

  private normalizeToolCalls(
    toolCalls?: ReadonlyArray<ConversationToolCallRequest>,
  ): ChatMessage['tool_calls'] | undefined {
    if (!toolCalls || toolCalls.length === 0) {
      return undefined;
    }
    return toolCalls.map(call => ({
      id: call.id,
      type: 'function' as const,
      function: {
        name: call.name,
        arguments: this.serializeToolArguments(call.arguments),
      },
    }));
  }

  private createOpenAIChatTemplate(): PromptTemplateFunction {
    return async (components, modelInfo, selectedElements, config, estimateTokenCountFn) => {
      const messages: ChatMessage[] = [];
      if (components.systemPrompts && components.systemPrompts.length > 0) {
        const combinedSystemContent = components.systemPrompts.map(p => p.content).join("\n\n").trim();
        if (combinedSystemContent) {
          messages.push({ role: 'system', content: combinedSystemContent });
        }
      }
      if (components.conversationHistory) {
        components.conversationHistory.forEach(msg => {
          let role: ChatMessage['role'] = 'user';
          if (msg.role === MessageRole.ASSISTANT) role = 'assistant';
          else if (msg.role === MessageRole.SYSTEM) role = 'system';
          else if (msg.role === MessageRole.TOOL) role = 'tool';

    const chatMsg: ChatMessage = { role, content: null };

          if (typeof msg.content === 'string') {
            chatMsg.content = msg.content;
          } else if (Array.isArray(msg.content)) {
            chatMsg.content = msg.content as MessageContentPart[]; // Use MessageContentPart
          } else if (msg.content === null && msg.tool_calls) {
            // Fine for tool_calls
          } else if (msg.content) {
            chatMsg.content = JSON.stringify(msg.content);
          }

    if (msg.name) chatMsg.name = msg.name;
    if (msg.tool_call_id) chatMsg.tool_call_id = msg.tool_call_id;
    const normalizedToolCalls = this.normalizeToolCalls(msg.tool_calls);
    if (normalizedToolCalls) {
      chatMsg.tool_calls = normalizedToolCalls;
      if (chatMsg.content === undefined) {
        chatMsg.content = null;
      }
    }
          messages.push(chatMsg);
        });
      }
      const userMessageParts: MessageContentPart[] = []; // Use MessageContentPart
      if (components.userInput) {
        userMessageParts.push({ type: 'text', text: components.userInput });
      }
      if (components.visionInputs && modelInfo.visionSupport?.supported) {
        components.visionInputs.forEach(vis => {
          userMessageParts.push({
            type: 'image_url',
            image_url: { url: vis.type === 'base64' ? `data:${vis.mimeType || 'image/jpeg'};base64,${vis.data}` : vis.data } // Corrected: vis.mimeType
          });
        });
      }
      if (userMessageParts.length > 0) {
        messages.push({ role: 'user', content: userMessageParts.length === 1 && userMessageParts[0].type === 'text' ? userMessageParts[0].text! : userMessageParts });
      }
      if (components.retrievedContext) {
        const ragContent = typeof components.retrievedContext === 'string' ? components.retrievedContext : components.retrievedContext.map(r => `Source: ${r.source}\nContent: ${r.content}`).join('\n\n');
        if (messages.length > 0 && messages[messages.length-1].role === 'user') {
          const lastUserMsg = messages[messages.length-1];
          const newUserContent = `Context:\n${ragContent}\n\nUser Query: ${lastUserMsg.content}`;
          messages[messages.length-1].content = newUserContent;
        } else {
          messages.push({role: 'user', content: `Based on the following context:\n${ragContent}\n\nPlease respond to the implicit or explicit user query.`});
        }
      }
      return messages;
    };
  }

  private createAnthropicMessagesTemplate(): PromptTemplateFunction {
    return async (components, modelInfo, selectedElements, config, estimateTokenCountFn) => {
      const messages: ChatMessage[] = [];
      let systemPrompt = '';
      if (components.systemPrompts && components.systemPrompts.length > 0) {
        systemPrompt = components.systemPrompts.map(p => p.content).join("\n\n").trim();
      }

      if (components.conversationHistory) {
        components.conversationHistory.forEach(msg => {
          let role: 'user' | 'assistant' = 'user';
          if (msg.role === MessageRole.ASSISTANT) role = 'assistant';

          if (msg.role === MessageRole.USER || msg.role === MessageRole.ASSISTANT) {
            const contentParts: MessageContentPart[] = []; // Use MessageContentPart
            if (typeof msg.content === 'string') {
              contentParts.push({type: 'text', text: msg.content});
            } else if (Array.isArray(msg.content)) {
              msg.content.forEach((part: any) => contentParts.push(part as MessageContentPart)); // Type assertion
            }
            messages.push({ role, content: contentParts });
          } else if (msg.role === MessageRole.TOOL) {
            messages.push({
              role: 'user',
              content: [ // Corrected: Type part explicitly after MessagePart is updated
                {
                  type: 'tool_result',
                  tool_use_id: msg.tool_call_id!,
                  content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                } as MessageContentPart, // Assert after MessageContentPart is updated
              ]
            });
          }
        });
      }

      const currentUserInputParts: MessageContentPart[] = []; // Use MessageContentPart
      if(components.userInput) currentUserInputParts.push({type: 'text', text: components.userInput});
      if(components.visionInputs && modelInfo.visionSupport?.supported){
        components.visionInputs.forEach(vis => {
          currentUserInputParts.push({
            type: 'image', // Anthropic uses 'image' type for content block
            source: {
              type: vis.type === 'base64' ? 'base64' : 'url', // This is Anthropic's image source type
              media_type: vis.mimeType || (vis.data.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png'), // Corrected: vis.mimeType
              data: vis.type === 'base64' ? vis.data : (vis.data.startsWith('data:') && vis.data.includes(',')) ? vis.data.split(',')[1] : vis.data
            }
          } as any); // Use 'as any' if 'image' type with 'source' is not yet in MessageContentPart
        });
      }
      if (currentUserInputParts.length > 0) {
        messages.push({role: 'user', content: currentUserInputParts});
      }

      const formatted: FormattedPrompt = { messages };
      if (systemPrompt) {
        formatted.system = systemPrompt;
      }
      if (components.tools && modelInfo.toolSupport.format === 'anthropic_tools') {
        formatted.tools = this.formatToolSchemasForModel(components.tools, modelInfo);
      }
      return formatted;
    };
  }

  private createGenericCompletionTemplate(): PromptTemplateFunction {
    return async (components, modelInfo, selectedElements, config, estimateTokenCountFn) => {
      let promptString = "";
      if (components.systemPrompts) promptString += components.systemPrompts.map(p=>p.content).join("\n") + "\n\n";
      if (components.conversationHistory) {
        promptString += components.conversationHistory.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join("\n") + "\n\n";
      }
      if (components.userInput) promptString += `user: ${components.userInput}\nassistant:`;
      return promptString;
    };
  }
}

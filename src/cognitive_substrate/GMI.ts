/**
 * @fileoverview Implements the Generalized Mind Instance (GMI), the core cognitive
 * engine of the AgentOS platform. This version integrates concrete IUtilityAI methods
 * for tasks like JSON parsing in self-reflection and summarization for RAG ingestion,
 * alongside its full suite of capabilities including tool orchestration, RAG interaction,
 * and adaptive state management.
 *
 * @module backend/agentos/cognitive_substrate/GMI
 * @see ./IGMI.ts for the interface definition.
 * @see ./personas/IPersonaDefinition.ts for persona structure.
 * @see ../core/tools/IToolOrchestrator.ts for tool orchestration.
 * @see ../core/ai_utilities/IUtilityAI.ts for utility functions.
 */

import { uuidv4 } from '../utils/uuid';
import {
  IGMI,
  GMIBaseConfig,
  GMITurnInput,
  GMIOutputChunk,
  GMIOutputChunkType,
  GMIPrimeState,
  GMIMood,
  UserContext,
  TaskContext,
  ReasoningTrace,
  ReasoningTraceEntry,
  ReasoningEntryType,
  GMIHealthReport,
  MemoryLifecycleEvent,
  LifecycleActionResponse,
  LifecycleAction,
  GMIInteractionType,
  ToolCallRequest,
  ToolCallResult,
  ToolResultPayload,
  GMIOutput,
  CostAggregator,
  UICommand, // Assuming UICommand is used internally if GMI constructs them
  // AudioOutputConfig, ImageOutputConfig are part of GMIOutput
} from './IGMI';
import {
  IPersonaDefinition,
  PersonaRagConfigIngestionTrigger, // Ensure this type definition exists and is correctly imported
} from './personas/IPersonaDefinition';
import { IWorkingMemory } from './memory/IWorkingMemory';
import { IPromptEngine, PromptExecutionContext, PromptComponents, PromptEngineResult, ModelTargetInfo } from '../core/llm/IPromptEngine';
import { IRetrievalAugmentor, RagRetrievalOptions, RagDocumentInput, RagIngestionOptions, RagMemoryCategory } from '../rag/IRetrievalAugmentor';

import { ChatMessage, ModelCompletionOptions } from '../core/llm/providers/IProvider';

import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import { IUtilityAI, SummarizationOptions, ParseJsonOptions } from '../core/ai_utilities/IUtilityAI';

import { IToolOrchestrator } from '../core/tools/IToolOrchestrator';

import { ToolExecutionRequestDetails } from '../core/tools/ToolExecutor';
import { ConversationMessage, createConversationMessage, MessageRole } from '../core/conversation/ConversationMessage';
import { GMIError, GMIErrorCode, createGMIErrorFromError } from '@framers/agentos/utils/errors';
import { GMIEventType, GMIEvent, SentimentHistoryState, createGMIEvent } from './GMIEvent.js';

const DEFAULT_MAX_CONVERSATION_HISTORY_TURNS = 20;
const DEFAULT_SELF_REFLECTION_INTERVAL_TURNS = 5;
const MAX_REASONING_TRACE_ENTRIES = 500; // Limit trace size in memory

/**
 * @class GMI
 * @implements {IGMI}
 * The core implementation of the Generalized Mind Instance, orchestrating
 * perception, cognition, action, and adaptation.
 */
export class GMI implements IGMI {
  public readonly gmiId: string;
  public readonly creationTimestamp: Date;

  private activePersona!: IPersonaDefinition;
  private config!: GMIBaseConfig;

  // Core Dependencies (Injected)
  private workingMemory!: IWorkingMemory;
  private promptEngine!: IPromptEngine;
  private retrievalAugmentor?: IRetrievalAugmentor;
  private toolOrchestrator!: IToolOrchestrator;
  private llmProviderManager!: AIModelProviderManager;
  private utilityAI!: IUtilityAI;

  // Internal State
  private state: GMIPrimeState;
  private isInitialized: boolean = false; // Maintained as per user-provided GMI.ts
  private currentGmiMood: GMIMood;
  private currentUserContext!: UserContext;
  private currentTaskContext!: TaskContext;
  private reasoningTrace: ReasoningTrace;
  private conversationHistory: ChatMessage[];

  // Self-Reflection Control
  private selfReflectionIntervalTurns: number;
  private turnsSinceLastReflection: number;

  // Sentiment & Event Tracking
  private pendingGMIEvents: Set<GMIEventType> = new Set();
  private eventHistory: GMIEvent[] = []; // Last 20 events for debugging
  private metaPromptTriggerCounters: Map<string, number> = new Map();

  /**
   * Constructs a GMI instance.
   * The GMI is not fully operational until `initialize` is called.
   * @param {string} [gmiId] - Optional ID for the GMI. If not provided, a UUID will be generated.
   */
  constructor(gmiId?: string) {
    this.gmiId = gmiId || `gmi-${uuidv4()}`;
    this.creationTimestamp = new Date();
    this.state = GMIPrimeState.IDLE;

    this.currentGmiMood = GMIMood.NEUTRAL;
    this.currentUserContext = { userId: 'uninitialized-user', skillLevel: 'novice', preferences: {} };
    this.currentTaskContext = { taskId: `task-${uuidv4()}`, domain: 'general', complexity: 'low', status: 'not_started' };
    this.reasoningTrace = { gmiId: this.gmiId, personaId: '', entries: [] };
    this.conversationHistory = [];
    this.selfReflectionIntervalTurns = DEFAULT_SELF_REFLECTION_INTERVAL_TURNS;
    this.turnsSinceLastReflection = 0;
  }

  /**
   * @inheritdoc
   */
  public async initialize(persona: IPersonaDefinition, config: GMIBaseConfig): Promise<void> {
    if (this.isInitialized && this.state !== GMIPrimeState.ERRORED) {
      console.warn(`GMI (ID: ${this.gmiId}) already initialized (state: ${this.state}). Re-initializing parts.`);
      // Selective re-initialization logic can be more granular if needed
      this.reasoningTrace = { gmiId: this.gmiId, personaId: '', entries: [] };
      this.conversationHistory = [];
    }

    this.validateInitializationInputs(persona, config);

    this.activePersona = persona;
    this.config = config;

    this.workingMemory = config.workingMemory;
    this.promptEngine = config.promptEngine;
    this.retrievalAugmentor = config.retrievalAugmentor;
    this.toolOrchestrator = config.toolOrchestrator;
    this.llmProviderManager = config.llmProviderManager;
    this.utilityAI = config.utilityAI;

    this.reasoningTrace.personaId = this.activePersona.id;

    await this.workingMemory.initialize(this.gmiId, this.activePersona.customFields?.defaultWorkingMemoryConfig || {});
    this.addTraceEntry(ReasoningEntryType.LIFECYCLE, 'GMI Initializing with Persona and Config.', { personaId: persona.id });

    await this.loadStateFromMemoryAndPersona();

    const reflectionMetaPrompt = this.activePersona.metaPrompts?.find(mp => mp.id === 'gmi_self_trait_adjustment');
    this.selfReflectionIntervalTurns = reflectionMetaPrompt?.trigger?.type === 'turn_interval' && typeof reflectionMetaPrompt.trigger.intervalTurns === 'number'
      ? reflectionMetaPrompt.trigger.intervalTurns
      : DEFAULT_SELF_REFLECTION_INTERVAL_TURNS;
    this.turnsSinceLastReflection = 0;

    this.isInitialized = true; // Set after all essential initializations
    this.state = GMIPrimeState.READY;
    this.addTraceEntry(ReasoningEntryType.LIFECYCLE, 'GMI Initialization complete. State: READY.');
    console.log(`GMI (ID: ${this.gmiId}, Persona: ${this.activePersona.id}) initialized successfully.`);
  }

  /**
   * Validates the essential inputs for GMI initialization.
   * @param {IPersonaDefinition} persona - The persona definition.
   * @param {GMIBaseConfig} config - The base configuration for the GMI.
   * @private
   * @throws {GMIError} if validation fails.
   */
  private validateInitializationInputs(persona: IPersonaDefinition, config: GMIBaseConfig): void {
    const errors: string[] = [];
    if (!persona) errors.push('PersonaDefinition');
    if (!config) errors.push('GMIBaseConfig');
    else {
      if (!config.workingMemory) errors.push('config.workingMemory');
      if (!config.promptEngine) errors.push('config.promptEngine');
      if (!config.llmProviderManager) errors.push('config.llmProviderManager');
      if (!config.utilityAI) errors.push('config.utilityAI');
      if (!config.toolOrchestrator) errors.push('config.toolOrchestrator');
    }
    if (errors.length > 0) {

      throw new GMIError(`GMI initialization failed, missing dependencies: ${errors.join(', ')}`, GMIErrorCode.GMI_INITIALIZATION_ERROR, { missing: errors });
    }
  }

  /**
   * Loads initial operational state from working memory or persona defaults.
   * @private
   */
  private async loadStateFromMemoryAndPersona(): Promise<void> {
    this.currentGmiMood = (await this.workingMemory.get<GMIMood>('currentGmiMood')) ||
                         (this.activePersona.moodAdaptation?.defaultMood as GMIMood) || // Assuming GMIMood string is compatible
                         GMIMood.NEUTRAL;

    const personaInitialUserCtx = this.activePersona.customFields?.initialUserContext || {};
    const memUserCtx = await this.workingMemory.get<UserContext>('currentUserContext');
    this.currentUserContext = {
      userId: 'default_user', // Will be overridden by actual session/turn user ID
      skillLevel: 'novice',
      preferences: {},
      ...personaInitialUserCtx,
      ...(memUserCtx || {}), // Spread memUserCtx if it exists
    };
    
    const personaInitialTaskCtx = this.activePersona.customFields?.initialTaskContext || {};
    const memTaskCtx = await this.workingMemory.get<TaskContext>('currentTaskContext');
    this.currentTaskContext = {
      taskId: `task-${uuidv4()}`,
      domain: this.activePersona.strengths?.[0] || 'general',
      complexity: 'medium',
      status: 'not_started',
      ...personaInitialTaskCtx,
      ...(memTaskCtx || {}),
    };

    await Promise.all([
        this.workingMemory.set('currentGmiMood', this.currentGmiMood),
        this.workingMemory.set('currentUserContext', this.currentUserContext),
        this.workingMemory.set('currentTaskContext', this.currentTaskContext)
    ]);

    this.addTraceEntry(ReasoningEntryType.STATE_CHANGE, 'GMI operational state (mood, user, task contexts) loaded/initialized.');

    if (this.activePersona.initialMemoryImprints && this.activePersona.initialMemoryImprints.length > 0) {
      this.addTraceEntry(ReasoningEntryType.STATE_CHANGE, `Applying ${this.activePersona.initialMemoryImprints.length} initial memory imprints from persona.`);
      for (const imprint of this.activePersona.initialMemoryImprints) {
        if (imprint.key && imprint.value !== undefined) {
          await this.workingMemory.set(imprint.key, imprint.value);
          this.addTraceEntry(ReasoningEntryType.DEBUG, `Applied memory imprint: '${imprint.key}'`, { value: imprint.value, description: imprint.description });
        }
      }
    }
  }

  /** @inheritdoc */
  public getPersona(): IPersonaDefinition {
    if (!this.isInitialized || !this.activePersona) {
      throw new GMIError("GMI is not properly initialized or has no active persona.", GMIErrorCode.NOT_INITIALIZED);
    }
    return this.activePersona;
  }

  /** @inheritdoc */
  public getCurrentPrimaryPersonaId(): string {
    if (!this.activePersona) {
      throw new GMIError("GMI has no active persona assigned.", GMIErrorCode.NOT_INITIALIZED);
    }
    return this.activePersona.id;
  }

  /** @inheritdoc */
  public getGMIId(): string { return this.gmiId; }

  /** @inheritdoc */
  public getCurrentState(): GMIPrimeState { return this.state; }

  /** @inheritdoc */
  public getReasoningTrace(): Readonly<ReasoningTrace> {
    return JSON.parse(JSON.stringify(this.reasoningTrace));
  }

  /**
   * Adds an entry to the GMI's reasoning trace.
   * @private
   */
  private addTraceEntry(type: ReasoningEntryType, message: string, details?: Record<string, any>, timestamp?: Date): void {
    if (this.reasoningTrace.entries.length >= MAX_REASONING_TRACE_ENTRIES) {
      this.reasoningTrace.entries.shift();
    }
    const entry: ReasoningTraceEntry = {
      timestamp: timestamp || new Date(),
      type,
      message: message.substring(0, 1000), // Cap message length
      details: details ? JSON.parse(JSON.stringify(details)) : {},
    };
    this.reasoningTrace.entries.push(entry);
  }

  /**
   * Ensures the GMI is initialized and in a READY state.
   * @private
   */
  private ensureReady(): void {
    if (!this.isInitialized) {
        throw new GMIError(`GMI (ID: ${this.gmiId}) is not initialized.`, GMIErrorCode.NOT_INITIALIZED);
    }
    if (this.state !== GMIPrimeState.READY) {

      throw new GMIError(
        `GMI (ID: ${this.gmiId}) is not in READY state. Current state: ${this.state}.`,
        GMIErrorCode.INVALID_STATE,
        { currentGMIState: this.state }
      );
    }
  }

  /**
   * Creates a standardized GMIOutputChunk.
   * @private
   */
  private createOutputChunk(
    interactionId: string,
    type: GMIOutputChunkType,
    content: any,
    extras: Partial<Omit<GMIOutputChunk, 'interactionId' | 'type' | 'content' | 'timestamp' | 'chunkId'>> = {}
  ): GMIOutputChunk {
    return {
      interactionId, type, content,
      timestamp: new Date(),
      chunkId: `gmi-chunk-${uuidv4()}`,
      ...extras,
    };
  }

  /**
   * Updates the internal conversation history with new input.
   * @private
   */
  private updateConversationHistory(turnInput: GMITurnInput): void {
    let messageToAdd: ChatMessage | null = null;

    switch (turnInput.type) {
      case GMIInteractionType.TEXT:
        messageToAdd = { role: 'user', content: turnInput.content as string, name: turnInput.metadata?.userName || turnInput.userId };
        break;
      case GMIInteractionType.MULTIMODAL_CONTENT:
        messageToAdd = { role: 'user', content: turnInput.content as any, name: turnInput.metadata?.userName || turnInput.userId };
        break;
      case GMIInteractionType.TOOL_RESPONSE: {
        const results = Array.isArray(turnInput.content) ? turnInput.content as ToolCallResult[] : [turnInput.content as ToolCallResult];
        results.forEach(result => {
          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            name: result.toolName,
            content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
          });
        });
        break;
      }
      case GMIInteractionType.SYSTEM_MESSAGE:
        messageToAdd = { role: 'system', content: turnInput.content as string };
        break;
    }
    if (messageToAdd) this.conversationHistory.push(messageToAdd);

    const maxHistoryMessages = this.activePersona.conversationContextConfig?.maxMessages ||
                               this.activePersona.memoryConfig?.conversationContext?.maxMessages ||
                               DEFAULT_MAX_CONVERSATION_HISTORY_TURNS;

    if (this.conversationHistory.length > maxHistoryMessages) {
      const removeCount = this.conversationHistory.length - maxHistoryMessages;
      this.conversationHistory.splice(0, removeCount);
      this.addTraceEntry(ReasoningEntryType.DEBUG, `Conversation history trimmed to ${maxHistoryMessages} messages.`);
    }
  }

  /**
   * Adds a tool call result to the GMI's internal conversation history.
   * @private
   * @param {ToolCallResult} toolCallResult - The result from the tool execution.
   */
  private updateConversationHistoryWithToolResult(toolCallResult: ToolCallResult): void {
    this.conversationHistory.push({
      role: 'tool',
      tool_call_id: toolCallResult.toolCallId,
      name: toolCallResult.toolName, // Name of the tool
      content: toolCallResult.isError
        ? `Error from tool '${toolCallResult.toolName}': ${JSON.stringify(toolCallResult.errorDetails || toolCallResult.output)}`
        : (typeof toolCallResult.output === 'string' ? toolCallResult.output : JSON.stringify(toolCallResult.output)),
    });
  }

  /**
   * Creates a conversation-history snapshot compatible with `PromptComponents`.
   * @private
   */
  private buildConversationHistoryForPrompt(): ConversationMessage[] {
    return this.conversationHistory.map(msg => this.convertChatMessageToConversationMessage(msg));
  }

  private convertChatMessageToConversationMessage(chatMsg: ChatMessage): ConversationMessage {
    const conversationMessage = createConversationMessage(
      this.mapChatRoleToMessageRole(chatMsg.role),
      this.normalizeChatMessageContent(chatMsg.content),
      {
        name: chatMsg.name,
        tool_call_id: chatMsg.tool_call_id,
      }
    );

    if (chatMsg.tool_calls && chatMsg.tool_calls.length > 0) {
      conversationMessage.tool_calls = chatMsg.tool_calls
        .filter(tc => !!tc?.function?.name)
        .map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: this.parseToolCallArguments(tc.function.arguments),
        }));
    }

    return conversationMessage;
  }

  private mapChatRoleToMessageRole(role: ChatMessage['role']): MessageRole {
    switch (role) {
      case 'system':
        return MessageRole.SYSTEM;
      case 'assistant':
        return MessageRole.ASSISTANT;
      case 'tool':
        return MessageRole.TOOL;
      default:
        return MessageRole.USER;
    }
  }

  private normalizeChatMessageContent(content: ChatMessage['content']): ConversationMessage['content'] {
    if (typeof content === 'undefined') {
      return null;
    }
    if (content === null || typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map(part => ({ ...part }));
    }
    return content as unknown as ConversationMessage['content'];
  }

  private parseToolCallArguments(args: unknown): Record<string, any> {
    if (!args) {
      return {};
    }
    if (typeof args === 'string') {
      try {
        return JSON.parse(args);
      } catch {
        return {};
      }
    }
    if (typeof args === 'object') {
      return args as Record<string, any>;
    }
    return {};
  }

  /**
   * Builds the PromptExecutionContext for the PromptEngine.
   * @private
   * @returns {PromptExecutionContext} The context for prompt construction.
   */
  private buildPromptExecutionContext(): PromptExecutionContext {
    if (!this.isInitialized || !this.activePersona || !this.currentUserContext || !this.currentTaskContext || !this.workingMemory) {
      throw new GMIError("GMI context not properly initialized for prompt construction.", GMIErrorCode.INVALID_STATE);
    }
    
    const context: PromptExecutionContext = {
      activePersona: this.activePersona,
      workingMemory: this.workingMemory,
      currentMood: this.currentGmiMood,
      userSkillLevel: this.currentUserContext.skillLevel,
      userPreferences: this.currentUserContext.preferences,
      taskHint: this.currentTaskContext.domain,
      taskComplexity: this.currentTaskContext.complexity,
      // language: this.currentUserContext.language, // If available
      // conversationSignals: this.detectConversationSignals(), // If such method exists
    };
    return context;
  }

  /**
   * Determines if RAG retrieval should be triggered based on the current query and persona configuration.
   * @private
   * @param {string} query - The current user query.
   * @returns {boolean} True if RAG should be triggered, false otherwise.
   */
  private shouldTriggerRAGRetrieval(query: string): boolean {
    if (!query || query.trim() === '') return false;

    const ragConfig = this.activePersona.memoryConfig?.ragConfig;
    const retrievalTriggers = ragConfig?.retrievalTriggers;

    if (retrievalTriggers?.onUserQuery) {
      return true;
    }
    // TODO: Implement more sophisticated logic based on other retrievalTriggers
    // (e.g., onIntentDetected, onToolFailure, customLogicFunctionName)
    return false; // Default
  }

  /** @inheritdoc */

  public async *processTurnStream(turnInput: GMITurnInput): AsyncGenerator<GMIOutputChunk, GMIOutput, undefined> {
    this.ensureReady();
    this.state = GMIPrimeState.PROCESSING;
    const turnId = turnInput.interactionId || `turn-${uuidv4()}`;
    // Store turnId on reasoningTrace for current turn
    if (this.reasoningTrace) this.reasoningTrace.turnId = turnId;

    this.addTraceEntry(ReasoningEntryType.INTERACTION_START, `Processing turn '${turnId}' for user '${turnInput.userId}'`,
      { inputType: turnInput.type, inputPreview: String(turnInput.content).substring(0, 100) });

    // Initialize aggregates for the final GMIOutput
    let aggregatedResponseText = "";
    const aggregatedToolCalls: ToolCallRequest[] = [];
    const aggregatedUiCommands: UICommand[] = [];
    const aggregatedUsage: CostAggregator = { totalTokens: 0, promptTokens: 0, completionTokens: 0, breakdown: [] };
    let lastErrorForOutput: GMIOutput['error'] = undefined;

    try {
      if (turnInput.userContextOverride) {
        this.currentUserContext = { ...this.currentUserContext, ...turnInput.userContextOverride };
        await this.workingMemory.set('currentUserContext', this.currentUserContext);
      }
      if (turnInput.taskContextOverride) {
        this.currentTaskContext = { ...this.currentTaskContext, ...turnInput.taskContextOverride };
        await this.workingMemory.set('currentTaskContext', this.currentTaskContext);
      }
      if (turnInput.userId && this.currentUserContext.userId !== turnInput.userId) {
        this.currentUserContext.userId = turnInput.userId;
        await this.workingMemory.set('currentUserContext', this.currentUserContext);
      }
      this.updateConversationHistory(turnInput);

      // Analyze sentiment of user input only when sentiment tracking is enabled
      if (this.activePersona.sentimentTracking?.enabled) {
        const lastMsg = this.conversationHistory.length > 0
          ? this.conversationHistory[this.conversationHistory.length - 1]
          : null;
        if (lastMsg?.role === 'user' && lastMsg?.content) {
          const userInputText = typeof lastMsg.content === 'string'
            ? lastMsg.content
            : JSON.stringify(lastMsg.content);
          await this.analyzeTurnSentiment(turnId, userInputText);
        }
      }

      let safetyBreak = 0;
      main_processing_loop: while (safetyBreak < 5) {
        safetyBreak++;
        let augmentedContextFromRAG = "";
        const injectedLongTermMemoryContext =
          typeof turnInput.metadata?.longTermMemoryContext === 'string'
            ? turnInput.metadata.longTermMemoryContext.trim()
            : "";

        const lastMessage = this.conversationHistory.length > 0 ? this.conversationHistory[this.conversationHistory.length - 1] : null;
        const isUserInitiatedTurn = lastMessage?.role === 'user';

        if (this.retrievalAugmentor && this.activePersona.memoryConfig?.ragConfig?.enabled && isUserInitiatedTurn && lastMessage?.content) {
          const currentQueryForRag = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
          if (this.shouldTriggerRAGRetrieval(currentQueryForRag)) {
            this.addTraceEntry(ReasoningEntryType.RAG_QUERY_START, "RAG retrieval triggered.", { queryPreview: currentQueryForRag.substring(0, 100) });
            const retrievalOptions: RagRetrievalOptions = {
                topK: this.activePersona.memoryConfig?.ragConfig?.defaultRetrievalTopK || 5,
                targetDataSourceIds: this.activePersona.memoryConfig?.ragConfig?.dataSources?.filter(ds => ds.isEnabled).map(ds => ds.dataSourceNameOrId),
                // TODO: Populate other options like metadataFilter, strategy from persona config
            };
            const ragResult = await this.retrievalAugmentor.retrieveContext(currentQueryForRag, retrievalOptions);
            augmentedContextFromRAG = ragResult.augmentedContext;
            this.addTraceEntry(ReasoningEntryType.RAG_QUERY_RESULT, 'RAG context retrieved.', { length: augmentedContextFromRAG.length });
          }
        }

        const promptExecContext = this.buildPromptExecutionContext();
        const baseSystemPrompts = Array.isArray(this.activePersona.baseSystemPrompt)
            ? this.activePersona.baseSystemPrompt
            : typeof this.activePersona.baseSystemPrompt === 'object' && 'template' in this.activePersona.baseSystemPrompt
                ? [{ content: this.activePersona.baseSystemPrompt.template, priority: 1}]
                : typeof this.activePersona.baseSystemPrompt === 'string'
                    ? [{ content: this.activePersona.baseSystemPrompt, priority: 1}]
                    : [];

        const systemPrompts = [...baseSystemPrompts];
        const rollingSummaryText = typeof turnInput.metadata?.rollingSummary?.text === 'string'
          ? turnInput.metadata.rollingSummary.text.trim()
          : '';
        if (rollingSummaryText) {
          systemPrompts.push({
            content: `Rolling Memory Summary (compressed)\n${rollingSummaryText}`,
            priority: 50,
          });
        }
        const promptProfileInstructions = typeof turnInput.metadata?.promptProfile?.systemInstructions === 'string'
          ? turnInput.metadata.promptProfile.systemInstructions.trim()
          : '';
        if (promptProfileInstructions) {
          systemPrompts.push({
            content: promptProfileInstructions,
            priority: 60,
          });
        }

        const durableHistoryForPrompt =
          Array.isArray(turnInput.metadata?.conversationHistoryForPrompt) && turnInput.metadata?.conversationHistoryForPrompt.length > 0
            ? (turnInput.metadata?.conversationHistoryForPrompt as ConversationMessage[])
            : null;

        const promptComponents: PromptComponents = {
          systemPrompts,
          conversationHistory: durableHistoryForPrompt ?? this.buildConversationHistoryForPrompt(),
          userInput: isUserInitiatedTurn && typeof lastMessage?.content === 'string' ? lastMessage.content : null,
          retrievedContext: [augmentedContextFromRAG, injectedLongTermMemoryContext].filter(Boolean).join("\n\n---\n\n"),
          // tools: this.activePersona.embeddedTools, // If ITool[] and PromptComponents.tools takes ITool[]
        };

        const preferredModelIdFromInput = turnInput.metadata?.options?.preferredModelId as string | undefined;
        const modelIdToUse = preferredModelIdFromInput || this.activePersona.defaultModelId || this.config.defaultLlmModelId;
        const providerIdForModel = this.activePersona.defaultProviderId || this.config.defaultLlmProviderId;

        if (!modelIdToUse) {
            throw new GMIError("Could not determine modelId for LLM call.", GMIErrorCode.CONFIGURATION_ERROR, { turnId });
        }

        const modelDetails = await this.llmProviderManager.getModelInfo(modelIdToUse, providerIdForModel);
        const modelTargetInfo: ModelTargetInfo = {
            modelId: modelIdToUse,
            providerId: modelDetails?.providerId || providerIdForModel || this.llmProviderManager.getProviderForModel(modelIdToUse)?.providerId || 'unknown',
            maxContextTokens: modelDetails?.contextWindowSize || 8192, // Default fallback
            capabilities: modelDetails?.capabilities || [],
            promptFormatType: 'openai_chat', // TODO: Determine from modelDetails or provider features
            toolSupport: { supported: modelDetails?.capabilities.includes('tool_use') || false, format: 'openai_functions' }, // TODO: Determine format
        };

        const promptEngineResult: PromptEngineResult = await this.promptEngine.constructPrompt(
          promptComponents, modelTargetInfo, promptExecContext
        );

        promptEngineResult.issues?.forEach(issue => this.addTraceEntry(ReasoningEntryType.WARNING, `Prompt Engine Issue: ${issue.message}`, issue as any));
        this.addTraceEntry(ReasoningEntryType.PROMPT_CONSTRUCTION_COMPLETE, `Prompt constructed for model ${modelTargetInfo.modelId}.`);

        const provider = this.llmProviderManager.getProvider(modelTargetInfo.providerId);
        if (!provider) {
            throw new GMIError(`LLM Provider '${modelTargetInfo.providerId}' not found or not initialized.`, GMIErrorCode.LLM_PROVIDER_UNAVAILABLE);
        }

        const toolsForLLM = await this.toolOrchestrator.listAvailableTools({
          personaId: this.activePersona.id,
          personaCapabilities: this.activePersona.allowedCapabilities || [],
          userContext: this.currentUserContext,
        });
        
        const llmOptions: ModelCompletionOptions = {
          temperature: (turnInput.metadata?.options?.temperature as number) ?? this.activePersona.defaultModelCompletionOptions?.temperature ?? 0.7,
          maxTokens: (turnInput.metadata?.options?.maxTokens as number) ?? this.activePersona.defaultModelCompletionOptions?.maxTokens ?? 2048,
          tools: toolsForLLM.length > 0 ? toolsForLLM.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema }})) : undefined,
          toolChoice: turnInput.metadata?.options?.toolChoice || (toolsForLLM.length > 0 ? "auto" : undefined),
          userId: this.currentUserContext.userId,
          stream: true, // For generateCompletionStream
          responseFormat: turnInput.metadata?.options?.responseFormat,
        };

        this.addTraceEntry(ReasoningEntryType.LLM_CALL_START, `Streaming from ${modelTargetInfo.modelId}. Tools: ${toolsForLLM.length}.`);

        let currentIterationTextResponse = "";
        let currentIterationToolCallRequests: ToolCallRequest[] = [];

        let textDeltaEmitted = false;
        for await (const chunk of provider.generateCompletionStream(modelTargetInfo.modelId, promptEngineResult.prompt as ChatMessage[], llmOptions)) {
          if (chunk.error) {

            throw new GMIError(`LLM stream error: ${chunk.error.message}`, GMIErrorCode.LLM_PROVIDER_ERROR, chunk.error.details);
          }

          if (chunk.responseTextDelta) {
            currentIterationTextResponse += chunk.responseTextDelta;
            aggregatedResponseText += chunk.responseTextDelta; // Aggregate for final output
            yield this.createOutputChunk(turnInput.interactionId, GMIOutputChunkType.TEXT_DELTA, chunk.responseTextDelta, { usage: chunk.usage });
            textDeltaEmitted = true;
          }

          // Handle fully formed tool_calls if present in the chunk's message
          const choice = chunk.choices?.[0];
          if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
            currentIterationToolCallRequests = choice.message.tool_calls.map((tc: any) => ({ // tc is from IProvider.ChatMessage.tool_calls
                id: tc.id || `toolcall-${uuidv4()}`, // Ensure ID
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments,
            }));
            aggregatedToolCalls.push(...currentIterationToolCallRequests); // Aggregate for final output
            yield this.createOutputChunk(turnInput.interactionId, GMIOutputChunkType.TOOL_CALL_REQUEST, [...currentIterationToolCallRequests]);
            this.addTraceEntry(ReasoningEntryType.TOOL_CALL_REQUESTED, `LLM requested tool(s).`, { requests: currentIterationToolCallRequests });
          }
          
          if (chunk.isFinal && choice?.finishReason) {
            this.addTraceEntry(ReasoningEntryType.LLM_CALL_COMPLETE, `LLM stream part finished. Reason: ${choice.finishReason}`, { usage: chunk.usage });
            if (chunk.usage) {
              yield this.createOutputChunk(turnInput.interactionId, GMIOutputChunkType.USAGE_UPDATE, chunk.usage);
              // Aggregate usage
              aggregatedUsage.promptTokens += chunk.usage.promptTokens || 0;
              aggregatedUsage.completionTokens += chunk.usage.completionTokens || 0;
              aggregatedUsage.totalTokens = aggregatedUsage.promptTokens + aggregatedUsage.completionTokens;
              if (chunk.usage.costUSD) aggregatedUsage.totalCostUSD = (aggregatedUsage.totalCostUSD || 0) + chunk.usage.costUSD;
            }
          }
        } // End LLM stream

        // Ensure at least one TEXT_DELTA is emitted for this turn if text was produced
        if (!textDeltaEmitted && aggregatedResponseText) {
          yield this.createOutputChunk(turnInput.interactionId, GMIOutputChunkType.TEXT_DELTA, aggregatedResponseText);
        }

        this.conversationHistory.push({
          role: 'assistant',
          content: currentIterationTextResponse || null,
          tool_calls: currentIterationToolCallRequests.length > 0
            ? currentIterationToolCallRequests.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
              }))
            : undefined,
        });

        if (currentIterationToolCallRequests.length > 0) {
          this.state = GMIPrimeState.AWAITING_TOOL_RESULT;
          const toolExecutionResults: ToolCallResult[] = [];
          for (const toolCallReq of currentIterationToolCallRequests) {
            const requestDetails: ToolExecutionRequestDetails = {
              toolCallRequest: toolCallReq,
              gmiId: this.gmiId, personaId: this.activePersona.id,
              personaCapabilities: this.activePersona.allowedCapabilities || [],
              userContext: this.currentUserContext, correlationId: turnId,
            };
            this.addTraceEntry(ReasoningEntryType.TOOL_EXECUTION_START, `Orchestrating tool: ${toolCallReq.name}`, { reqId: toolCallReq.id });
            const result = await this.toolOrchestrator.processToolCall(requestDetails);
            toolExecutionResults.push(result);
            this.addTraceEntry(ReasoningEntryType.TOOL_EXECUTION_RESULT, `Tool '${toolCallReq.name}' result. Success: ${!result.isError}`, { result });
          }
          toolExecutionResults.forEach(tcResult => this.updateConversationHistoryWithToolResult(tcResult));
          currentIterationTextResponse = ""; // Reset for next iteration if any
          currentIterationToolCallRequests = []; // Reset
          this.state = GMIPrimeState.PROCESSING;
          continue main_processing_loop;
        }
        break main_processing_loop; // Break if no tool calls
      }

      await this.performPostTurnIngestion(
        typeof turnInput.content === 'string' ? turnInput.content : JSON.stringify(turnInput.content),
        aggregatedResponseText
      );

      // Check and trigger all metaprompts (turn_interval, event_based, manual)
      await this.checkAndTriggerMetaprompts(turnId);

      // Prepare the final GMIOutput for the generator's return value
      const finalTurnOutput: GMIOutput = {
        isFinal: true,
        responseText: aggregatedResponseText || null,
        toolCalls: aggregatedToolCalls.length > 0 ? aggregatedToolCalls : undefined,
        uiCommands: aggregatedUiCommands.length > 0 ? aggregatedUiCommands : undefined, // Assuming GMI can populate these
        usage: aggregatedUsage,
        error: lastErrorForOutput,
      };
      return finalTurnOutput; // Return the aggregated output

    } catch (error: any) {

      const gmiError = createGMIErrorFromError(error, GMIErrorCode.GMI_PROCESSING_ERROR, { turnId }, `Error in GMI turn '${turnId}'.`);
      this.state = GMIPrimeState.ERRORED;
      lastErrorForOutput = { code: gmiError.code, message: gmiError.message, details: gmiError.details };
      this.addTraceEntry(ReasoningEntryType.ERROR, `GMI processing error: ${gmiError.message}`, gmiError.toPlainObject());
      console.error(`GMI (ID: ${this.gmiId}) error in turn '${turnId}':`, gmiError);
      yield this.createOutputChunk(turnInput.interactionId, GMIOutputChunkType.ERROR, gmiError.message, { errorDetails: gmiError.toPlainObject() });
      
      // Still need to return a GMIOutput for the generator contract
      return {
        isFinal: true,
        responseText: null,
        error: lastErrorForOutput,
        usage: aggregatedUsage, // Could be partial
      };
    } finally {
      if (this.state !== GMIPrimeState.ERRORED && this.state !== GMIPrimeState.AWAITING_TOOL_RESULT) {
        this.state = GMIPrimeState.READY;
      }
      // This final chunk is part of the stream, not the return value of the generator
      yield this.createOutputChunk(turnInput.interactionId, GMIOutputChunkType.FINAL_RESPONSE_MARKER, 'Turn processing sequence complete.', { isFinal: true });
      this.addTraceEntry(ReasoningEntryType.INTERACTION_END, `Turn '${turnId}' finished. GMI State: ${this.state}.`);
      if (this.reasoningTrace) this.reasoningTrace.turnId = undefined;
    }
  }

  /** @inheritdoc */
  public async handleToolResult(
    toolCallId: string,
    toolName: string,
    resultPayload: ToolResultPayload,
    _userId: string,
    // userApiKeys?: Record<string, string> // Not directly used by GMI, providers handle keys
  ): Promise<GMIOutput> {
    if (!this.isInitialized) {
        throw new GMIError("GMI is not initialized. Cannot handle tool result.", GMIErrorCode.NOT_INITIALIZED);
    }
    // Allow handling tool results if processing or specifically awaiting
    if (this.state !== GMIPrimeState.AWAITING_TOOL_RESULT && this.state !== GMIPrimeState.PROCESSING) {
        this.addTraceEntry(ReasoningEntryType.WARNING, `handleToolResult called when GMI state is ${this.state}. Expected AWAITING_TOOL_RESULT or PROCESSING.`, { toolCallId, toolName });
        // Depending on desired robustness, could throw an error or try to proceed.
    }
    this.state = GMIPrimeState.PROCESSING; // Set state to processing

    // Use current turnId if available, or generate a new interactionId for this specific handling
    const interactionId = this.reasoningTrace?.turnId || `tool_handler_turn_${uuidv4()}`;

    this.addTraceEntry(ReasoningEntryType.TOOL_EXECUTION_RESULT, `Received external tool result for '${toolName}' (ID: ${toolCallId}) to be processed.`,
      { toolCallId, toolName, success: resultPayload.type === 'success', interactionId }
    );

    const toolCallResult: ToolCallResult = {
        toolCallId,
        toolName,
        output: resultPayload.type === 'success' ? resultPayload.result : resultPayload.error,
        isError: resultPayload.type === 'error',
        errorDetails: resultPayload.type === 'error' ? resultPayload.error : undefined,
    };
    this.updateConversationHistoryWithToolResult(toolCallResult);

    // Construct a system turn input to represent the continuation after tool result
    const systemTurnInput: GMITurnInput = {
        interactionId,
        userId: this.currentUserContext.userId, // Use the GMI's current user context
        sessionId: this.reasoningTrace?.sessionId,
        type: GMIInteractionType.SYSTEM_MESSAGE, // Or a specific type for internal continuation
        content: `Internally processing result for tool '${toolName}'.`, // System message content
        metadata: {
            isToolContinuation: true,
            originalToolCallId: toolCallId,
        }
    };
    
    // Collect all chunks from processTurnStream to form a single GMIOutput
    let _aggregatedResponseText = "";
    const aggregatedToolCalls: ToolCallRequest[] = [];
    const aggregatedUsage: CostAggregator = { totalTokens: 0, promptTokens: 0, completionTokens: 0, breakdown: [] };
    let _lastErrorForOutput: GMIOutput['error'] = undefined;

    const stream = this.processTurnStream(systemTurnInput); // This now returns GMIOutput
    const finalGmiOutputFromStream = await (async () => {
        for await (const chunk of stream) {
            // Process chunks as they arrive if needed for intermediate steps,
            // but the final GMIOutput will be the generator's return value.
            // Here, we mainly care about the final returned GMIOutput.
            // However, if processTurnStream itself aggregates, this loop might just be to exhaust it.
             if (chunk.type === GMIOutputChunkType.TEXT_DELTA && typeof chunk.content === 'string') {
                _aggregatedResponseText += chunk.content;
            }
            if (chunk.type === GMIOutputChunkType.TOOL_CALL_REQUEST && Array.isArray(chunk.content)) {
                aggregatedToolCalls.push(...chunk.content);
            }
            if (chunk.usage) {
                aggregatedUsage.promptTokens += chunk.usage.promptTokens || 0;
                aggregatedUsage.completionTokens += chunk.usage.completionTokens || 0;
                aggregatedUsage.totalTokens = aggregatedUsage.promptTokens + aggregatedUsage.completionTokens;
                if (chunk.usage.costUSD) aggregatedUsage.totalCostUSD = (aggregatedUsage.totalCostUSD || 0) + chunk.usage.costUSD;
            }
            if (chunk.type === GMIOutputChunkType.ERROR) {
                 _lastErrorForOutput = chunk.errorDetails || {code: GMIErrorCode.GMI_PROCESSING_ERROR, message: String(chunk.content)};
            }
        }
        // The actual final GMIOutput comes from the generator's return value
        // This requires `processTurnStream` to be `async function* (...) : AsyncGenerator<..., GMIOutput, ...>`
        // and to have a `return finalOutput;` statement.
        // The loop above will collect intermediate chunks, and the 'return' from the generator is the key.
        // This structure is a bit complex with nested generators. Let's assume processTurnStream does return a GMIOutput.
        // The way AsyncGenerator TReturn works, the last value is 'done: true, value: TReturn'.
        // My processTurnStream is modified to return GMIOutput.
        let result = await stream.next();
        while(!result.done){
            // This loop is mainly to exhaust the stream if previous loop didn't fully.
            // The crucial part is what processTurnStream *returns*.
            result = await stream.next();
        }
        return result.value; // This is the GMIOutput
    })();

    this.addTraceEntry(ReasoningEntryType.INTERACTION_END, `Continuation after tool '${toolName}' (ID: ${toolCallId}) processed.`);
    return finalGmiOutputFromStream;
}

  /**
   * Performs post-turn RAG ingestion if configured.
   * @private
   */
  private async performPostTurnIngestion(userInput: string, gmiResponse: string): Promise<void> {
    const ragConfig = this.activePersona.memoryConfig?.ragConfig;

    const ingestionTriggers = ragConfig?.ingestionTriggers as PersonaRagConfigIngestionTrigger | undefined;
    const ingestionProcessingConfig = ragConfig?.ingestionProcessing;

    if (!this.retrievalAugmentor || !ragConfig?.enabled || !ingestionTriggers?.onTurnSummary) {
      return;
    }
    
    try {
      const textToSummarize = `User: ${userInput}\n\nAssistant: ${gmiResponse}`;
      let documentContent = textToSummarize;

      // Summarization is an explicit opt-in; ingestion can be cheap even when enabled.
      const summarizationEnabled = ingestionProcessingConfig?.summarization?.enabled === true;
      if (this.utilityAI && summarizationEnabled) {
        const summarizationOptions: SummarizationOptions = {
          desiredLength: ingestionProcessingConfig?.summarization?.targetLength || 'short',
          method: ingestionProcessingConfig?.summarization?.method || 'abstractive_llm',
          modelId: ingestionProcessingConfig?.summarization?.modelId || this.activePersona.defaultModelId || this.config.defaultLlmModelId,
          providerId: ingestionProcessingConfig?.summarization?.providerId || this.activePersona.defaultProviderId || this.config.defaultLlmProviderId,
        };
        this.addTraceEntry(ReasoningEntryType.RAG_INGESTION_DETAIL, "Summarizing turn for RAG ingestion.", { textLength: textToSummarize.length, options: summarizationOptions });
        documentContent = await this.utilityAI.summarize(textToSummarize, summarizationOptions);
      }
      
      const turnIdForMetadata = this.reasoningTrace.turnId || "unknown_turn"; // Handle undefined turnId

      const docToIngest: RagDocumentInput = {
        id: `turnsummary-${this.gmiId}-${turnIdForMetadata}-${uuidv4()}`, // Ensure unique ID
        content: documentContent,
        metadata: {
          gmiId: this.gmiId, personaId: this.activePersona.id, userId: this.currentUserContext.userId,
          timestamp: new Date().toISOString(), type: "conversation_turn_summary",
          turnId: turnIdForMetadata, // Now guaranteed to be a string
        },
        dataSourceId: ragConfig.defaultIngestionDataSourceId,
      };
      const ingestionOptions: RagIngestionOptions = {
        userId: this.currentUserContext.userId, personaId: this.activePersona.id,
      };

      this.addTraceEntry(ReasoningEntryType.RAG_INGESTION_START, "Ingesting turn summary to RAG.", { documentId: docToIngest.id });
      const ingestionResult = await this.retrievalAugmentor.ingestDocuments(docToIngest, ingestionOptions);
      if (ingestionResult.failedCount > 0) {
        this.addTraceEntry(ReasoningEntryType.WARNING, "Post-turn RAG ingestion encountered errors.", { errors: ingestionResult.errors });
      } else {
        this.addTraceEntry(ReasoningEntryType.RAG_INGESTION_COMPLETE, "Post-turn RAG ingestion successful.", { ingestedIds: ingestionResult.ingestedIds });
      }
    } catch (error: any) {

      const gmiError = createGMIErrorFromError(error, GMIErrorCode.RAG_INGESTION_FAILED, undefined, "Error during post-turn RAG ingestion.");
      this.addTraceEntry(ReasoningEntryType.ERROR, gmiError.message, gmiError.toPlainObject());
      console.error(`GMI (ID: ${this.gmiId}): RAG Ingestion Error - ${gmiError.message}`, gmiError.details);
    }
  }

  /**
   * Analyzes sentiment of user input and updates sentiment history.
   * Triggers event detection based on sentiment patterns.
   *
   * @param turnId - Current turn identifier
   * @param userInput - User's input text
   * @private
   */
  private async analyzeTurnSentiment(turnId: string, userInput: string): Promise<void> {
    // Skip if input is not a string or is empty
    if (!userInput || typeof userInput !== 'string') {
      return;
    }

    try {
      // Analyze sentiment using configurable method from sentimentTracking config
      const stConfig = this.activePersona.sentimentTracking;
      const sentimentResult = await this.utilityAI.analyzeSentiment(userInput, {
        method: stConfig?.method || 'lexicon_based',
        modelId: stConfig?.modelId || this.activePersona.defaultModelId,
        providerId: stConfig?.providerId || this.activePersona.defaultProviderId,
        language: (this.currentUserContext.language as string) || 'en',
      });

      // Update UserContext with current sentiment
      this.currentUserContext.currentSentiment = sentimentResult.polarity;
      await this.workingMemory.set('currentUserContext', this.currentUserContext);

      // Get or initialize sentiment history
      let sentimentHistory = await this.workingMemory.get<SentimentHistoryState>(
        'gmi_sentiment_history'
      );

      if (!sentimentHistory) {
        sentimentHistory = {
          trends: [],
          consecutiveFrustration: 0,
          consecutiveConfusion: 0,
          consecutiveSatisfaction: 0,
        };
      }

      // Add to sentiment trends
      const trend = {
        turnId,
        timestamp: new Date(),
        score: sentimentResult.score,
        polarity: sentimentResult.polarity,
        intensity: sentimentResult.intensity || 0,
        context: userInput.substring(0, 100), // First 100 chars
      };

      sentimentHistory.trends.push(trend);

      // Keep only last N trends (configurable sliding window)
      const historyWindow = stConfig?.historyWindow || 10;
      if (sentimentHistory.trends.length > historyWindow) {
        sentimentHistory.trends.shift();
      }

      // Update consecutive counters based on configurable thresholds
      const frustrationThreshold = stConfig?.frustrationThreshold ?? -0.3;
      const satisfactionThreshold = stConfig?.satisfactionThreshold ?? 0.3;

      if (sentimentResult.score < frustrationThreshold) {
        // Negative sentiment
        sentimentHistory.consecutiveFrustration++;
        sentimentHistory.consecutiveConfusion = 0;
        sentimentHistory.consecutiveSatisfaction = 0;
      } else if (sentimentResult.score > satisfactionThreshold) {
        // Positive sentiment
        sentimentHistory.consecutiveSatisfaction++;
        sentimentHistory.consecutiveFrustration = 0;
        sentimentHistory.consecutiveConfusion = 0;
      } else {
        // Neutral sentiment (or close to it)
        sentimentHistory.consecutiveConfusion++;
        sentimentHistory.consecutiveFrustration = 0;
        sentimentHistory.consecutiveSatisfaction = 0;
      }

      sentimentHistory.lastAnalyzedTurnId = turnId;

      // Store updated sentiment history
      await this.workingMemory.set('gmi_sentiment_history', sentimentHistory);

      this.addTraceEntry(
        ReasoningEntryType.DEBUG,
        'Turn sentiment analyzed',
        {
          sentiment: {
            score: sentimentResult.score,
            polarity: sentimentResult.polarity,
            intensity: sentimentResult.intensity,
          },
          consecutiveCounters: {
            frustration: sentimentHistory.consecutiveFrustration,
            confusion: sentimentHistory.consecutiveConfusion,
            satisfaction: sentimentHistory.consecutiveSatisfaction,
          },
        }
      );

      // Detect and emit events based on sentiment patterns
      await this.detectAndEmitEvents(turnId, userInput, sentimentResult, sentimentHistory);

    } catch (error: any) {
      // Don't fail the turn if sentiment analysis fails - log and continue
      console.error(`GMI (ID: ${this.gmiId}): Sentiment analysis error:`, error);
      this.addTraceEntry(
        ReasoningEntryType.WARNING,
        'Sentiment analysis failed',
        { error: error.message }
      );
    }
  }

  /**
   * Detects emotional patterns and emits appropriate GMI events.
   *
   * @param turnId - Current turn identifier
   * @param userInput - User's input text
   * @param sentimentResult - Sentiment analysis result
   * @param sentimentHistory - Historical sentiment data
   * @private
   */
  private async detectAndEmitEvents(
    turnId: string,
    userInput: string,
    sentimentResult: { score: number; polarity: 'positive' | 'negative' | 'neutral'; intensity?: number; negativeTokens?: any[] },
    sentimentHistory: SentimentHistoryState
  ): Promise<void> {
    // Read configurable thresholds
    const stConfig = this.activePersona.sentimentTracking;
    const frustThreshold = stConfig?.frustrationThreshold ?? -0.3;
    const satisThreshold = stConfig?.satisfactionThreshold ?? 0.3;
    const consecutiveRequired = stConfig?.consecutiveTurnsForTrigger ?? 2;

    // Frustration detection
    if (
      (sentimentResult.score < frustThreshold && (sentimentResult.intensity || 0) > 0.6) ||
      sentimentHistory.consecutiveFrustration >= consecutiveRequired
    ) {
      this.emitEvent(
        createGMIEvent(
          GMIEventType.USER_FRUSTRATED,
          turnId,
          sentimentHistory.consecutiveFrustration >= 2 ? 'high' : 'medium',
          {
            sentimentScore: sentimentResult.score,
            sentimentPolarity: sentimentResult.polarity,
            sentimentIntensity: sentimentResult.intensity,
            consecutiveTurns: sentimentHistory.consecutiveFrustration,
            triggeredBy: 'sentiment',
          }
        )
      );
    }

    // Confusion detection (keyword-based + sentiment)
    const confusionKeywords = [
      'confused',
      "don't understand",
      "dont understand",
      'unclear',
      'what do you mean',
      'explain',
      'clarify',
      'huh',
      '??',
      "doesn't make sense",
      "doesnt make sense",
      'not sure',
    ];

    const lowerInput = userInput.toLowerCase();
    const hasConfusionKeyword = confusionKeywords.some((keyword) =>
      lowerInput.includes(keyword)
    );
    const triggerKeywords = hasConfusionKeyword
      ? confusionKeywords.filter((keyword) => lowerInput.includes(keyword))
      : [];

    if (
      hasConfusionKeyword ||
      (sentimentResult.polarity === 'neutral' &&
        sentimentResult.negativeTokens &&
        sentimentResult.negativeTokens.length > 2)
    ) {
      this.emitEvent(
        createGMIEvent(
          GMIEventType.USER_CONFUSED,
          turnId,
          sentimentHistory.consecutiveConfusion >= 2 ? 'high' : 'medium',
          {
            triggeredBy: hasConfusionKeyword ? 'keyword' : 'sentiment',
            consecutiveTurns: sentimentHistory.consecutiveConfusion,
            evidencePreview: userInput.substring(0, 100),
            triggerKeywords: hasConfusionKeyword ? triggerKeywords : undefined,
          }
        )
      );
    }

    // Satisfaction detection
    if (
      (sentimentResult.score > satisThreshold && (sentimentResult.intensity || 0) > 0.5) ||
      sentimentHistory.consecutiveSatisfaction >= (consecutiveRequired + 1)
    ) {
      this.emitEvent(
        createGMIEvent(
          GMIEventType.USER_SATISFIED,
          turnId,
          'low',
          {
            sentimentScore: sentimentResult.score,
            sentimentPolarity: sentimentResult.polarity,
            sentimentIntensity: sentimentResult.intensity,
            consecutiveTurns: sentimentHistory.consecutiveSatisfaction,
            triggeredBy: 'sentiment',
          }
        )
      );
    }

    // Error threshold detection (check reasoning trace for recent errors)
    const recentErrors = this.reasoningTrace.entries
      .slice(-10)
      .filter((entry) => entry.type === ReasoningEntryType.ERROR);

    if (recentErrors.length >= 2) {
      this.emitEvent(
        createGMIEvent(
          GMIEventType.ERROR_THRESHOLD_EXCEEDED,
          turnId,
          'high',
          {
            triggeredBy: 'error',
            errorCount: recentErrors.length,
            consecutiveTurns: recentErrors.length,
          }
        )
      );
    }

    // Low engagement detection (consecutive neutral with short responses)
    const recentUserMessages = this.conversationHistory
      .slice(-5)
      .filter((msg) => msg.role === 'user');

    const avgLength = recentUserMessages.length > 0
      ? recentUserMessages.reduce(
          (sum, msg) => sum + String(msg.content).length,
          0
        ) / recentUserMessages.length
      : 0;

    if (sentimentHistory.consecutiveConfusion >= 4 && avgLength < 50) {
      this.emitEvent(
        createGMIEvent(
          GMIEventType.LOW_ENGAGEMENT,
          turnId,
          'medium',
          {
            triggeredBy: 'pattern',
            consecutiveTurns: sentimentHistory.consecutiveConfusion,
            evidencePreview: `Avg response length: ${avgLength.toFixed(0)} chars`,
          }
        )
      );
    }
  }

  /**
   * Emits a GMI event and stores it in event history.
   *
   * @param event - The event to emit
   * @private
   */
  private emitEvent(event: GMIEvent): void {
    // Add to pending events (will be consumed by trigger checking)
    this.pendingGMIEvents.add(event.eventType);

    // Add to event history for debugging (circular buffer, max 20)
    this.eventHistory.push(event);
    if (this.eventHistory.length > 20) {
      this.eventHistory.shift();
    }

    this.addTraceEntry(
      ReasoningEntryType.DEBUG,
      `GMI Event Emitted: ${event.eventType}`,
      {
        event: {
          eventType: event.eventType,
          turnId: event.turnId,
          severity: event.severity,
          metadata: event.metadata,
        },
      }
    );
  }

  /**
   * Checks all metaprompt triggers (turn_interval, event_based, manual) and executes triggered ones.
   *
   * @param turnId - Current turn identifier
   * @private
   */
  private async checkAndTriggerMetaprompts(turnId: string): Promise<void> {
    if (!this.activePersona.metaPrompts || this.activePersona.metaPrompts.length === 0) {
      return;
    }

    const triggeredMetaPrompts: import('./personas/IPersonaDefinition').MetaPromptDefinition[] = [];

    for (const metaPrompt of this.activePersona.metaPrompts) {
      if (!metaPrompt.trigger) continue;

      if (metaPrompt.trigger.type === 'turn_interval') {
        // Existing turn_interval logic
        const counter = await this.getMetapromptTurnCounter(metaPrompt.id);
        if (counter >= metaPrompt.trigger.intervalTurns) {
          triggeredMetaPrompts.push(metaPrompt);
          await this.resetMetapromptTurnCounter(metaPrompt.id);
        } else {
          await this.incrementMetapromptTurnCounter(metaPrompt.id);
        }
      } else if (metaPrompt.trigger.type === 'event_based') {
        // NEW: Event-based trigger checking
        const eventName = metaPrompt.trigger.eventName;
        if (this.pendingGMIEvents.has(eventName as GMIEventType)) {
          triggeredMetaPrompts.push(metaPrompt);
          // Consume the event (remove from pending)
          this.pendingGMIEvents.delete(eventName as GMIEventType);
        }
      } else if (metaPrompt.trigger.type === 'manual') {
        // NEW: Manual trigger checking
        // Check for manual trigger flag in working memory
        const manualFlag = await this.workingMemory.get<boolean>(
          `manual_trigger_${metaPrompt.id}`
        );
        if (manualFlag) {
          triggeredMetaPrompts.push(metaPrompt);
          // Clear the flag
          await this.workingMemory.delete(`manual_trigger_${metaPrompt.id}`);
        }
      }
    }

    if (triggeredMetaPrompts.length > 0) {
      this.addTraceEntry(
        ReasoningEntryType.SELF_REFLECTION_TRIGGERED,
        `${triggeredMetaPrompts.length} metaprompt(s) triggered`,
        { ids: triggeredMetaPrompts.map((m) => m.id), turnId }
      );

      // Execute metaprompts (background task, don't block turn)
      this.executeMetaprompts(triggeredMetaPrompts).catch((err) => {
        console.error(`GMI (ID: ${this.gmiId}): Metaprompt execution error:`, err);
        this.addTraceEntry(
          ReasoningEntryType.ERROR,
          'Metaprompt execution failed',
          { error: (err as Error).message }
        );
      });
    }
  }

  /**
   * Gets the turn counter for a specific metaprompt.
   *
   * @param metapromptId - Metaprompt identifier
   * @returns Current counter value
   * @private
   */
  private async getMetapromptTurnCounter(metapromptId: string): Promise<number> {
    const counter = this.metaPromptTriggerCounters.get(metapromptId);
    if (counter !== undefined) {
      return counter;
    }

    // Try loading from working memory (for persistence across GMI instances)
    const storedCounter = await this.workingMemory.get<number>(
      `metaprompt_turn_counter_${metapromptId}`
    );
    return storedCounter || 0;
  }

  /**
   * Increments the turn counter for a specific metaprompt.
   *
   * @param metapromptId - Metaprompt identifier
   * @private
   */
  private async incrementMetapromptTurnCounter(metapromptId: string): Promise<void> {
    const current = await this.getMetapromptTurnCounter(metapromptId);
    const newValue = current + 1;
    this.metaPromptTriggerCounters.set(metapromptId, newValue);
    await this.workingMemory.set(`metaprompt_turn_counter_${metapromptId}`, newValue);
  }

  /**
   * Resets the turn counter for a specific metaprompt to zero.
   *
   * @param metapromptId - Metaprompt identifier
   * @private
   */
  private async resetMetapromptTurnCounter(metapromptId: string): Promise<void> {
    this.metaPromptTriggerCounters.set(metapromptId, 0);
    await this.workingMemory.set(`metaprompt_turn_counter_${metapromptId}`, 0);
  }

  /**
   * Executes multiple metaprompts in parallel or sequence.
   * Replaces the single-metaprompt _triggerAndProcessSelfReflection().
   *
   * @param metaPrompts - Array of metaprompts to execute
   * @private
   */
  private async executeMetaprompts(
    metaPrompts: import('./personas/IPersonaDefinition').MetaPromptDefinition[]
  ): Promise<void> {
    if (metaPrompts.length === 0) return;

    const previousState = this.state;
    this.state = GMIPrimeState.REFLECTING;

    this.addTraceEntry(
      ReasoningEntryType.SELF_REFLECTION_START,
      `Executing ${metaPrompts.length} metaprompt(s)`,
      { ids: metaPrompts.map((m) => m.id) }
    );

    try {
      // Execute metaprompts in parallel using Promise.allSettled
      // This allows all to run even if some fail
      const results = await Promise.allSettled(
        metaPrompts.map((mp) => this.executeMetapromptHandler(mp))
      );

      // Log any failures
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          this.addTraceEntry(
            ReasoningEntryType.ERROR,
            `Metaprompt '${metaPrompts[idx].id}' failed: ${result.reason}`,
            { error: result.reason }
          );
        }
      });
    } catch (error: any) {
      const gmiError = createGMIErrorFromError(
        error,
        GMIErrorCode.GMI_PROCESSING_ERROR,
        undefined,
        'Error during metaprompt execution'
      );
      this.addTraceEntry(
        ReasoningEntryType.ERROR,
        gmiError.message,
        gmiError.toPlainObject()
      );
    } finally {
      // Restore state
      const disallowedStates = new Set([
        GMIPrimeState.IDLE,
        GMIPrimeState.INITIALIZING,
      ]);
      this.state = disallowedStates.has(previousState)
        ? GMIPrimeState.READY
        : previousState;

      this.addTraceEntry(
        ReasoningEntryType.SELF_REFLECTION_COMPLETE,
        'Metaprompt execution cycle complete'
      );
    }
  }

  /**
   * Routes a metaprompt to its appropriate handler based on ID.
   *
   * @param metaPrompt - Metaprompt definition to execute
   * @private
   */
  private async executeMetapromptHandler(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    // Handler routing map
    switch (metaPrompt.id) {
      case 'gmi_self_trait_adjustment':
        return this.handleTraitAdjustment(metaPrompt);
      case 'gmi_frustration_recovery':
        return this.handleFrustrationRecovery(metaPrompt);
      case 'gmi_confusion_clarification':
        return this.handleConfusionClarification(metaPrompt);
      case 'gmi_satisfaction_reinforcement':
        return this.handleSatisfactionReinforcement(metaPrompt);
      case 'gmi_error_recovery':
        return this.handleErrorRecovery(metaPrompt);
      case 'gmi_engagement_boost':
        return this.handleEngagementBoost(metaPrompt);
      default:
        // Generic handler for custom metaprompts
        return this.handleGenericMetaprompt(metaPrompt);
    }
  }

  /**
   * Handler for trait adjustment metaprompt (existing self-reflection logic).
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleTraitAdjustment(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    // Gather evidence for self-reflection
    const evidenceHistory = this.conversationHistory.slice(-10);
    const evidenceTrace = this.reasoningTrace.entries.slice(-20);

    const evidence = {
      recentHistory: evidenceHistory,
      recentReasoning: evidenceTrace,
      currentMood: this.currentGmiMood,
      userContext: this.currentUserContext,
      taskContext: this.currentTaskContext,
    };

    const variables = {
      evidence: JSON.stringify(evidence).substring(0, 4000), // Limit size
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Handler for frustration recovery metaprompt.
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleFrustrationRecovery(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    const sentimentHistory = await this.workingMemory.get<SentimentHistoryState>(
      'gmi_sentiment_history'
    );
    const recentErrors = this.reasoningTrace.entries
      .slice(-10)
      .filter((e) => e.type === ReasoningEntryType.ERROR);

    const variables = {
      current_sentiment: this.currentUserContext.currentSentiment || 'negative',
      sentiment_score: (sentimentHistory?.trends[sentimentHistory.trends.length - 1]?.score || -0.5).toString(),
      consecutive_frustration: (sentimentHistory?.consecutiveFrustration || 1).toString(),
      recent_conversation: JSON.stringify(this.conversationHistory.slice(-5)),
      recent_errors: JSON.stringify(recentErrors.map((e) => e.message)),
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Handler for confusion clarification metaprompt.
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleConfusionClarification(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    const sentimentHistory = await this.workingMemory.get<SentimentHistoryState>(
      'gmi_sentiment_history'
    );

    // Get the last event for confusion keywords
    const lastConfusionEvent = this.eventHistory
      .slice()
      .reverse()
      .find((e) => e.eventType === GMIEventType.USER_CONFUSED);

    const variables = {
      current_sentiment: this.currentUserContext.currentSentiment || 'neutral',
      consecutive_confusion: (sentimentHistory?.consecutiveConfusion || 1).toString(),
      recent_conversation: JSON.stringify(this.conversationHistory.slice(-5)),
      confusion_keywords: lastConfusionEvent?.metadata.triggerKeywords
        ? JSON.stringify(lastConfusionEvent.metadata.triggerKeywords)
        : '[]',
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Handler for satisfaction reinforcement metaprompt.
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleSatisfactionReinforcement(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    const sentimentHistory = await this.workingMemory.get<SentimentHistoryState>(
      'gmi_sentiment_history'
    );

    const variables = {
      current_sentiment: this.currentUserContext.currentSentiment || 'positive',
      sentiment_score: (sentimentHistory?.trends[sentimentHistory.trends.length - 1]?.score || 0.5).toString(),
      consecutive_satisfaction: (sentimentHistory?.consecutiveSatisfaction || 1).toString(),
      recent_conversation: JSON.stringify(this.conversationHistory.slice(-5)),
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Handler for error recovery metaprompt.
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleErrorRecovery(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    const recentErrors = this.reasoningTrace.entries
      .slice(-10)
      .filter((e) => e.type === ReasoningEntryType.ERROR);

    const variables = {
      recent_errors: JSON.stringify(recentErrors.map((e) => ({ message: e.message, details: e.details }))),
      recent_conversation: JSON.stringify(this.conversationHistory.slice(-5)),
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Handler for engagement boost metaprompt.
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleEngagementBoost(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    const sentimentHistory = await this.workingMemory.get<SentimentHistoryState>(
      'gmi_sentiment_history'
    );

    const variables = {
      consecutive_neutral: (sentimentHistory?.consecutiveConfusion || 4).toString(),
      recent_conversation: JSON.stringify(this.conversationHistory.slice(-5)),
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Generic handler for custom metaprompts not in the preset list.
   *
   * @param metaPrompt - Metaprompt definition
   * @private
   */
  private async handleGenericMetaprompt(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition
  ): Promise<void> {
    // Generic handler that provides all available context
    const variables = {
      recent_conversation: JSON.stringify(this.conversationHistory.slice(-5)),
      recent_reasoning: JSON.stringify(this.reasoningTrace.entries.slice(-10)),
      current_mood: this.currentGmiMood,
      user_skill: this.currentUserContext.skillLevel || 'unknown',
      task_complexity: this.currentTaskContext.complexity || 'unknown',
      current_sentiment: this.currentUserContext.currentSentiment || 'neutral',
    };

    const response = await this.executeMetapromptWithVariables(metaPrompt, variables);
    await this.applyMetapromptUpdates(response, metaPrompt.id);
  }

  /**
   * Executes a metaprompt with variable substitution.
   *
   * @param metaPrompt - Metaprompt definition
   * @param variables - Variables to substitute in the template
   * @returns Parsed JSON response from LLM
   * @private
   */
  private async executeMetapromptWithVariables(
    metaPrompt: import('./personas/IPersonaDefinition').MetaPromptDefinition,
    variables: Record<string, string>
  ): Promise<any> {
    // Extract template
    let template: string;
    if (typeof metaPrompt.promptTemplate === 'string') {
      template = metaPrompt.promptTemplate;
    } else {
      template = metaPrompt.promptTemplate.template;
    }

    // Substitute variables
    let finalPrompt = template;
    for (const [key, value] of Object.entries(variables)) {
      finalPrompt = finalPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    // Get model and provider info
    const modelId = metaPrompt.modelId || this.activePersona.defaultModelId;
    const providerId = metaPrompt.providerId || this.activePersona.defaultProviderId;

    if (!modelId || !providerId) {
      throw new GMIError(
        'No model or provider specified for metaprompt',
        GMIErrorCode.CONFIGURATION_ERROR
      );
    }

    // Call LLM
    this.addTraceEntry(
      ReasoningEntryType.DEBUG,
      `Executing metaprompt '${metaPrompt.id}'`,
      { modelId, providerId }
    );

    const completionOptions: ModelCompletionOptions = {
      temperature: metaPrompt.temperature ?? 0.3,
      maxTokens: metaPrompt.maxOutputTokens ?? 512,
      responseFormat: { type: 'json_object' },
    };

    const provider = this.llmProviderManager.getProvider(providerId);
    if (!provider) {
      throw new GMIError(
        `Provider '${providerId}' not found for metaprompt '${metaPrompt.id}'.`,
        GMIErrorCode.LLM_PROVIDER_UNAVAILABLE,
      );
    }

    const result = await provider.generateCompletion(
      modelId,
      [{ role: 'user', content: finalPrompt }],
      completionOptions,
    );

    const responseContent = result.choices?.[0]?.message?.content;
    if (!responseContent || typeof responseContent !== 'string') {
      throw new GMIError(
        `Metaprompt '${metaPrompt.id}' returned no valid content.`,
        GMIErrorCode.LLM_PROVIDER_ERROR,
        { response: result },
      );
    }

    // Parse JSON with LLM-based recovery
    const parseOptions: ParseJsonOptions = {
      attemptFixWithLLM: true,
      llmModelIdForFix: modelId,
      llmProviderIdForFix: providerId,
    };

    const parsedResponse = await this.utilityAI.parseJsonSafe(
      responseContent,
      parseOptions
    );

    return parsedResponse;
  }

  /**
   * Applies metaprompt updates to GMI state (mood, user skill, task complexity, memory).
   *
   * @param updates - Parsed updates from metaprompt response
   * @param metapromptId - ID of the metaprompt that generated these updates
   * @private
   */
  private async applyMetapromptUpdates(updates: any, metapromptId: string): Promise<void> {
    if (!updates) return;

    let stateChanged = false;

    // Mood update
    if (updates.updatedGmiMood && this.currentGmiMood !== updates.updatedGmiMood) {
      // Validate that the mood is a valid GMIMood value
      const validMoods = Object.values(GMIMood);
      if (validMoods.includes(updates.updatedGmiMood.toUpperCase())) {
        this.currentGmiMood = updates.updatedGmiMood.toUpperCase() as GMIMood;
        await this.workingMemory.set('currentGmiMood', this.currentGmiMood);
        stateChanged = true;
      }
    }

    // User skill level update
    if (updates.updatedUserSkillLevel &&
        this.currentUserContext.skillLevel !== updates.updatedUserSkillLevel) {
      this.currentUserContext.skillLevel = updates.updatedUserSkillLevel;
      await this.workingMemory.set('currentUserContext', this.currentUserContext);
      stateChanged = true;
    }

    // Task complexity update
    if (updates.updatedTaskComplexity &&
        this.currentTaskContext.complexity !== updates.updatedTaskComplexity) {
      this.currentTaskContext.complexity = updates.updatedTaskComplexity;
      await this.workingMemory.set('currentTaskContext', this.currentTaskContext);
      stateChanged = true;
    }

    // Memory imprints
    if (updates.newMemoryImprints && Array.isArray(updates.newMemoryImprints)) {
      for (const imprint of updates.newMemoryImprints) {
        if (imprint.key) {
          await this.workingMemory.set(imprint.key, imprint.value);
        }
      }
      if (updates.newMemoryImprints.length > 0) {
        stateChanged = true;
      }
    }

    // Log state change
    if (stateChanged) {
      this.addTraceEntry(
        ReasoningEntryType.STATE_CHANGE,
        `GMI state updated by metaprompt '${metapromptId}'`,
        {
          newMood: this.currentGmiMood,
          newUserSkill: this.currentUserContext.skillLevel,
          newTaskComplexity: this.currentTaskContext.complexity,
          rationale: updates.adjustmentRationale || updates.recoveryStrategy || updates.clarificationStrategy || updates.engagementStrategy || updates.mitigationStrategy,
        }
      );
    }
  }

  /** @inheritdoc */
  public async _triggerAndProcessSelfReflection(): Promise<void> {
    // ... (GMI.ts code for _triggerAndProcessSelfReflection provided by user, with my error fixes)
    // Key fixes to apply within this method based on error list:
    // - Error 32: Use GMIErrorCode.PARSING_ERROR (ensure it's added to errors.ts)
    // - Error 33, 34: GMIError.wrap -> createGMIErrorFromError or new GMIError; PROCESSING_ERROR -> GMI_PROCESSING_ERROR
    // - Error 35: Review logic for `this.state = previousState === ...`
    // - Error 27 (ModelCompletionOptions.modelId): Fix in getModelAndProviderForLLMCall or here if directly accessed.
    // - Error 31 (PROVIDER_ERROR): Change to LLM_PROVIDER_ERROR.

    const reflectionMetaPromptDef = this.activePersona.metaPrompts?.find(mp => mp.id === 'gmi_self_trait_adjustment');
    if (!reflectionMetaPromptDef?.promptTemplate) {
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_SKIPPED, "Self-reflection disabled or no 'gmi_self_trait_adjustment' meta-prompt.");
      return;
    }
    if (this.state === GMIPrimeState.REFLECTING) {
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_SKIPPED, "Self-reflection already in progress.");
      return;
    }

    const previousState = this.state;
    this.state = GMIPrimeState.REFLECTING;
    this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_START, "Starting self-reflection cycle.");

    try {
      const evidence = {
        recentConversation: this.conversationHistory.slice(-10),
        recentTraceEntries: this.reasoningTrace.entries.slice(-20),
        currentMood: this.currentGmiMood,
        currentUserContext: this.currentUserContext,
        currentTaskContext: this.currentTaskContext,
      };
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_DETAIL, "Gathered evidence for reflection.", {
        conversationSampleCount: evidence.recentConversation.length,
        traceSampleCount: evidence.recentTraceEntries.length
      });

      let metaPromptText = (typeof reflectionMetaPromptDef.promptTemplate === 'string')
          ? reflectionMetaPromptDef.promptTemplate
          : reflectionMetaPromptDef.promptTemplate.template;

      metaPromptText = metaPromptText
        .replace(/\{\{\s*evidence\s*\}\}/gi, JSON.stringify(evidence).substring(0, 4000) + "...")
        .replace(/\{\{\s*current_mood\s*\}\}/gi, this.currentGmiMood)
        .replace(/\{\{\s*user_skill\s*\}\}/gi, this.currentUserContext.skillLevel || "unknown")
        .replace(/\{\{\s*task_complexity\s*\}\}/gi, this.currentTaskContext.complexity || "unknown");
      
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_DETAIL, "Constructed meta-prompt.", { preview: metaPromptText.substring(0,100) });

      const { modelId, providerId } = this.getModelAndProviderForLLMCall(
        reflectionMetaPromptDef.modelId,
        reflectionMetaPromptDef.providerId,
        this.activePersona.defaultModelId || this.config.defaultLlmModelId,
        this.activePersona.defaultProviderId || this.config.defaultLlmProviderId
      );
      const provider = this.llmProviderManager.getProvider(providerId);
      if (!provider) {
        throw new GMIError(`Provider '${providerId}' not found for self-reflection.`, GMIErrorCode.LLM_PROVIDER_UNAVAILABLE);
      }

      // Using generateCompletion as generate is often for older text completion models
      const llmResponse = await provider.generateCompletion(modelId, [{role: 'user', content: metaPromptText}], {
        maxTokens: reflectionMetaPromptDef.maxOutputTokens || 512,
        temperature: reflectionMetaPromptDef.temperature || 0.3,
        responseFormat: { type: "json_object" } // Request JSON output
      });

      const responseContent = llmResponse.choices?.[0]?.message?.content;
      if (!responseContent || typeof responseContent !== 'string') {

        throw new GMIError("Self-reflection LLM call returned no valid content.", GMIErrorCode.LLM_PROVIDER_ERROR, { response: llmResponse });
      }
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_DETAIL, "LLM response for reflection received.", { preview: responseContent.substring(0,100) });

      const parseOptions: ParseJsonOptions = {
        attemptFixWithLLM: true,
        llmModelIdForFix: reflectionMetaPromptDef.modelId || modelId,
        llmProviderIdForFix: reflectionMetaPromptDef.providerId || providerId,
      };
      type ExpectedReflectionOutput = {
        updatedGmiMood?: GMIMood; updatedUserSkillLevel?: string; updatedTaskComplexity?: string;
        adjustmentRationale?: string; newMemoryImprints?: Array<{key: string; value: any; description?: string}>;
      };
      const parsedUpdates = await this.utilityAI.parseJsonSafe<ExpectedReflectionOutput>(responseContent, parseOptions);

      if (!parsedUpdates) {

        throw new GMIError("Failed to parse/fix JSON from self-reflection LLM.", GMIErrorCode.PARSING_ERROR, { responseText: responseContent });
      }
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_DETAIL, "Parsed trait update suggestions.", { suggestions: parsedUpdates });

      let stateChanged = false;
      // ... (Apply updates as in the original GMI.ts code, ensuring null checks if needed)
      if (parsedUpdates.updatedGmiMood && Object.values(GMIMood).includes(parsedUpdates.updatedGmiMood) && this.currentGmiMood !== parsedUpdates.updatedGmiMood) {
        this.currentGmiMood = parsedUpdates.updatedGmiMood;
        await this.workingMemory.set('currentGmiMood', this.currentGmiMood); stateChanged = true;
      }
      if (parsedUpdates.updatedUserSkillLevel && this.currentUserContext.skillLevel !== parsedUpdates.updatedUserSkillLevel) {
        this.currentUserContext.skillLevel = parsedUpdates.updatedUserSkillLevel;
        await this.workingMemory.set('currentUserContext', this.currentUserContext); stateChanged = true;
      }
      if (parsedUpdates.updatedTaskComplexity && this.currentTaskContext.complexity !== parsedUpdates.updatedTaskComplexity) {
        this.currentTaskContext.complexity = parsedUpdates.updatedTaskComplexity;
        await this.workingMemory.set('currentTaskContext', this.currentTaskContext); stateChanged = true;
      }
      if (parsedUpdates.newMemoryImprints && parsedUpdates.newMemoryImprints.length > 0) {
          for (const imprint of parsedUpdates.newMemoryImprints) {
              if (imprint.key) await this.workingMemory.set(imprint.key, imprint.value);
          }
          stateChanged = true;
          this.addTraceEntry(ReasoningEntryType.STATE_CHANGE, "New memory imprints added from self-reflection.", { imprints: parsedUpdates.newMemoryImprints.map(i=>i.key) });
      }

      if (stateChanged) {
        this.addTraceEntry(ReasoningEntryType.STATE_CHANGE, "GMI state updated via self-reflection.", {
          newMood: this.currentGmiMood, newUserSkill: this.currentUserContext.skillLevel, newTaskComplexity: this.currentTaskContext.complexity,
          rationale: parsedUpdates.adjustmentRationale
        });
      } else {
        this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_DETAIL, "No state changes applied from self-reflection.", { rationale: parsedUpdates.adjustmentRationale });
      }
    } catch (error: any) {

      const gmiError = createGMIErrorFromError(error, GMIErrorCode.GMI_PROCESSING_ERROR, undefined, `Error during self-reflection.`);
      this.addTraceEntry(ReasoningEntryType.ERROR, `Self-reflection failed: ${gmiError.message}`, gmiError.toPlainObject());
      console.error(`GMI (ID: ${this.gmiId}) self-reflection error:`, gmiError);
    } finally {

      // Or, if specific state is needed, previousState should be one of the valid non-reflecting states.
      const disallowedStates = new Set<GMIPrimeState>([GMIPrimeState.IDLE, GMIPrimeState.INITIALIZING]);
      this.state = disallowedStates.has(previousState) ? GMIPrimeState.READY : previousState;
      this.addTraceEntry(ReasoningEntryType.SELF_REFLECTION_COMPLETE, "Self-reflection cycle finished.");
    }
  }

  /**
   * Helper to determine model and provider for internal LLM calls.
   * @private
   */
  private getModelAndProviderForLLMCall(
    preferredModelId?: string, preferredProviderId?: string,
    systemDefaultModelId?: string, systemDefaultProviderId?: string
  ): { modelId: string; providerId: string } {
    let modelId = preferredModelId || this.activePersona.defaultModelId || systemDefaultModelId;
    let providerId = preferredProviderId || this.activePersona.defaultProviderId || systemDefaultProviderId;

    if (!modelId) {
      const defaultProvider = this.llmProviderManager.getDefaultProvider();
      modelId = defaultProvider?.defaultModelId;
      if (!providerId && modelId) { // If modelId found from default provider, use that providerId
          providerId = defaultProvider?.providerId;
      }
      if (!modelId) { // Still no modelId after all fallbacks
        throw new GMIError("Cannot determine modelId for LLM call: No preferred, persona default, system default, or provider default found.", GMIErrorCode.CONFIGURATION_ERROR);
      }
    }

    if (!providerId && modelId.includes('/')) {
      const parts = modelId.split('/');
      if (parts.length >= 2) { // Can be "openai/gpt-3.5-turbo" or "ollama/modelname/variant"
        providerId = parts[0];
        // modelId = parts.slice(1).join('/'); // Keep full model name if provider prefix was there
      }
    }

    if (!providerId) {
      const foundProvider = this.llmProviderManager.getProviderForModel(modelId);
      if (foundProvider) {
        providerId = foundProvider.providerId;
      } else {

        throw new GMIError(`Cannot determine providerId for model '${modelId}'. No explicit providerId, unable to infer from modelId, and no default provider found for it.`, GMIErrorCode.CONFIGURATION_ERROR, {modelId});
      }
    }
     // Ensure modelId doesn't contain the provider prefix if providerId is now set
     if (modelId.startsWith(providerId + '/')) {
        modelId = modelId.substring(providerId.length + 1);
    }

    return { modelId, providerId };
  }

  /** @inheritdoc */
  public async onMemoryLifecycleEvent(event: MemoryLifecycleEvent): Promise<LifecycleActionResponse> {
    this.ensureReady();
    this.addTraceEntry(ReasoningEntryType.MEMORY_LIFECYCLE_EVENT_RECEIVED, `Received memory lifecycle event: ${event.type}`, { eventId: event.eventId, itemId: event.itemId });
    
    const personaLifecycleConf = this.activePersona.memoryConfig?.lifecycleConfig;
    let gmiDecision: LifecycleAction = event.proposedAction;
    let rationale = 'GMI default action: align with MemoryLifecycleManager proposal.';

    if (personaLifecycleConf?.negotiationEnabled && event.negotiable) {
      this.addTraceEntry(ReasoningEntryType.MEMORY_LIFECYCLE_NEGOTIATION_START, "GMI negotiation for memory item.", { event });

      if (event.category === RagMemoryCategory.USER_EXPLICIT_MEMORY.toString() &&
          (event.type === 'DELETION_PROPOSED' || event.type === 'EVICTION_PROPOSED') &&
          event.proposedAction === 'DELETE') {
        gmiDecision = 'PREVENT_ACTION';
        rationale = 'GMI policy: User explicit memory requires careful review; preventing immediate deletion/eviction.';
      }
    }
    const response: LifecycleActionResponse = {
      gmiId: this.gmiId, eventId: event.eventId, actionTaken: gmiDecision, rationale,
    };
    this.addTraceEntry(ReasoningEntryType.MEMORY_LIFECYCLE_RESPONSE_SENT, `Responding to memory event: ${response.actionTaken}`, { response });
    return response;
  }

  /** @inheritdoc */
  public async analyzeAndReportMemoryHealth(): Promise<GMIHealthReport['memoryHealth']> {
    this.ensureReady();
    this.addTraceEntry(ReasoningEntryType.HEALTH_CHECK_REQUESTED, "Analyzing GMI memory health.");
    const workingMemorySize = await this.workingMemory.size();
    const ragHealth = this.retrievalAugmentor ? await this.retrievalAugmentor.checkHealth() : { isHealthy: true, details: "RAG not configured." };

    const memoryHealthReport: GMIHealthReport['memoryHealth'] = { // Explicit type
      overallStatus: ragHealth.isHealthy ? 'OPERATIONAL' : 'DEGRADED',
      workingMemoryStats: { itemCount: workingMemorySize },
      ragSystemStats: ragHealth,
      issues: [],
    };
    if (!ragHealth.isHealthy) memoryHealthReport.issues?.push({severity: 'warning', component: 'RetrievalAugmentor', description: "RAG system health check failed.", details: ragHealth.details});
    this.addTraceEntry(ReasoningEntryType.HEALTH_CHECK_RESULT, "Memory health analysis complete.", { status: memoryHealthReport.overallStatus });
    return memoryHealthReport;
  }

  /** @inheritdoc */
  public async getOverallHealth(): Promise<GMIHealthReport> {
    this.addTraceEntry(ReasoningEntryType.HEALTH_CHECK_REQUESTED, "Overall GMI health check.");
    const memoryHealth = await this.analyzeAndReportMemoryHealth();
    const dependenciesStatus: GMIHealthReport['dependenciesStatus'] = [];

    // Example extended dependency check
    const checkDep = async (name: string, service?: { checkHealth?: () => Promise<{isHealthy: boolean, details?: any}> }): Promise<void> => {
        if (!service || typeof service.checkHealth !== 'function') {
            dependenciesStatus.push({ componentName: name, status: 'UNKNOWN', details: `${name} service not configured or has no health check.`});
            return;
        }
        try {
            const health = await service.checkHealth();
            dependenciesStatus.push({ componentName: name, status: health.isHealthy ? 'HEALTHY' : 'UNHEALTHY', details: health.details });
        } catch (e: any) {
            dependenciesStatus.push({ componentName: name, status: 'ERROR', details: e.message });
        }
    };

    await Promise.all([
        checkDep('AIModelProviderManager', this.llmProviderManager as any), // Cast if AIModelProviderManager doesn't directly implement checkHealth
        checkDep('ToolOrchestrator', this.toolOrchestrator),
        checkDep('UtilityAI', this.utilityAI as any), // Cast if IUtilityAI doesn't have checkHealth
        checkDep('PromptEngine', this.promptEngine as any), // Cast if IPromptEngine doesn't have checkHealth
        // retrievalAugmentor already included in memoryHealth
    ]);
    
    let overallSystemHealthy = memoryHealth?.overallStatus === 'OPERATIONAL';
    dependenciesStatus.forEach(dep => { if (dep.status !== 'HEALTHY') overallSystemHealthy = false; });

    const report: GMIHealthReport = {
        gmiId: this.gmiId,
        personaId: this.activePersona?.id || 'uninitialized',
        timestamp: new Date(),
        overallStatus: overallSystemHealthy ? 'HEALTHY' : 'DEGRADED',
        currentState: this.state,
        memoryHealth,
        dependenciesStatus,
        recentErrors: this.reasoningTrace.entries.filter(e => e.type === ReasoningEntryType.ERROR).slice(-5),
        // uptimeSeconds, activeTurnsProcessed would need dedicated tracking if required
    };
    this.addTraceEntry(ReasoningEntryType.HEALTH_CHECK_RESULT, "Overall GMI health check complete.", { status: report.overallStatus });
    return report;
  }

  /** @inheritdoc */
  public async shutdown(): Promise<void> {
    if (this.state === GMIPrimeState.SHUTDOWN || (this.state === GMIPrimeState.IDLE && !this.isInitialized)) {
      console.log(`GMI (ID: ${this.gmiId}) already shut down or was never fully initialized.`);
      this.state = GMIPrimeState.SHUTDOWN; return;
    }
    this.state = GMIPrimeState.SHUTTING_DOWN;
    this.addTraceEntry(ReasoningEntryType.LIFECYCLE, "GMI shutting down.");
    try {
      await this.workingMemory?.close?.();
      // Shared dependencies (tool orchestrator, retrieval augmentor, utility AI, etc.) are owned by
      // the host (AgentOS/GMIManager) and may be shared across GMIs. Do not shut them down here,
      // otherwise deactivating one idle GMI can break other active sessions.
    } catch (error: any) {
        const shutdownError = createGMIErrorFromError(error, GMIErrorCode.INTERNAL_SERVER_ERROR, undefined, "Error during GMI component shutdown.");
        this.addTraceEntry(ReasoningEntryType.ERROR, shutdownError.message, shutdownError.toPlainObject());
        console.error(`GMI (ID: ${this.gmiId}): Error during component shutdown:`, shutdownError);
    } finally {
      this.state = GMIPrimeState.SHUTDOWN;
      this.isInitialized = false; // Mark as not initialized
      this.addTraceEntry(ReasoningEntryType.LIFECYCLE, "GMI shutdown complete.");
      console.log(`GMI (ID: ${this.gmiId}) shut down.`);
    }
  }
}

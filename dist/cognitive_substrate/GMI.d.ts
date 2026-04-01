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
 * @see ../nlp/ai_utilities/IUtilityAI.ts for utility functions.
 */
import { IGMI, GMIBaseConfig, GMITurnInput, GMIOutputChunk, GMIPrimeState, ReasoningTrace, GMIHealthReport, MemoryLifecycleEvent, LifecycleActionResponse, ToolCallResult, ToolResultPayload, GMIOutput } from './IGMI';
import { IPersonaDefinition } from './personas/IPersonaDefinition';
import { ConversationMessage } from '../core/conversation/ConversationMessage';
import type { ICognitiveMemoryManager } from '../memory/CognitiveMemoryManager.js';
/**
 * @class GMI
 * @implements {IGMI}
 * The core implementation of the Generalized Mind Instance, orchestrating
 * perception, cognition, action, and adaptation.
 */
export declare class GMI implements IGMI {
    readonly gmiId: string;
    readonly creationTimestamp: Date;
    private activePersona;
    private config;
    private workingMemory;
    private promptEngine;
    private retrievalAugmentor?;
    private toolOrchestrator;
    private llmProviderManager;
    private utilityAI;
    private cognitiveMemory?;
    private state;
    private isInitialized;
    private currentGmiMood;
    private currentUserContext;
    private currentTaskContext;
    private reasoningTrace;
    private conversationHistoryManager;
    private memoryBridge;
    private sentimentTracker;
    private metapromptExecutor;
    /**
     * Constructs a GMI instance.
     * The GMI is not fully operational until `initialize` is called.
     * @param {string} [gmiId] - Optional ID for the GMI. If not provided, a UUID will be generated.
     */
    constructor(gmiId?: string);
    /**
     * @inheritdoc
     */
    initialize(persona: IPersonaDefinition, config: GMIBaseConfig): Promise<void>;
    /**
     * Validates the essential inputs for GMI initialization.
     * @param {IPersonaDefinition} persona - The persona definition.
     * @param {GMIBaseConfig} config - The base configuration for the GMI.
     * @private
     * @throws {GMIError} if validation fails.
     */
    private validateInitializationInputs;
    /**
     * Loads initial operational state from working memory or persona defaults.
     * @private
     */
    private loadStateFromMemoryAndPersona;
    /** @inheritdoc */
    getPersona(): IPersonaDefinition;
    /** @inheritdoc */
    getCurrentPrimaryPersonaId(): string;
    /** @inheritdoc */
    getGMIId(): string;
    /** @inheritdoc */
    getCurrentState(): GMIPrimeState;
    /** @inheritdoc */
    getReasoningTrace(): Readonly<ReasoningTrace>;
    /** @inheritdoc */
    getWorkingMemorySnapshot(): Promise<Record<string, any>>;
    /** @inheritdoc */
    getCognitiveMemoryManager(): ICognitiveMemoryManager | undefined;
    /**
     * Adds an entry to the GMI's reasoning trace.
     * @private
     */
    private addTraceEntry;
    private stringifyTurnContent;
    private getConversationIdForTurn;
    private getOrganizationIdForTurn;
    private buildToolSessionData;
    /**
     * Ensures the GMI is initialized and in a READY state.
     * @private
     */
    private ensureReady;
    /**
     * Creates a standardized GMIOutputChunk.
     * @private
     */
    private createOutputChunk;
    hydrateConversationHistory(conversationHistory: ConversationMessage[]): void;
    hydrateTurnContext(context: {
        sessionId?: string;
        conversationId?: string;
        organizationId?: string;
    }): void;
    /**
     * Builds the PromptExecutionContext for the PromptEngine.
     * @private
     * @returns {PromptExecutionContext} The context for prompt construction.
     */
    private buildPromptExecutionContext;
    /**
     * Determines if RAG retrieval should be triggered based on the current query and persona configuration.
     * @private
     * @param {string} query - The current user query.
     * @returns {boolean} True if RAG should be triggered, false otherwise.
     */
    private shouldTriggerRAGRetrieval;
    /**
     * Determines the prompt format type based on model provider.
     * @param modelDetails - Model metadata from the provider manager.
     * @param providerId - The provider identifier.
     * @returns The prompt format type string.
     */
    private determinePromptFormat;
    /**
     * Determines the tool calling format based on model provider.
     * @param modelDetails - Model metadata from the provider manager.
     * @param providerId - The provider identifier.
     * @returns The tool format string.
     */
    private determineToolFormat;
    /** @inheritdoc */
    processTurnStream(turnInput: GMITurnInput): AsyncGenerator<GMIOutputChunk, GMIOutput, undefined>;
    /** @inheritdoc */
    handleToolResult(toolCallId: string, toolName: string, resultPayload: ToolResultPayload, userId: string): Promise<GMIOutput>;
    /** @inheritdoc */
    handleToolResults(toolResults: ToolCallResult[], _userId: string): Promise<GMIOutput>;
    /**
     * Performs post-turn RAG ingestion if configured.
     * @private
     */
    private performPostTurnIngestion;
    /** @inheritdoc */
    _triggerAndProcessSelfReflection(): Promise<void>;
    /**
     * Helper to determine model and provider for internal LLM calls.
     * @private
     */
    private getModelAndProviderForLLMCall;
    /** @inheritdoc */
    onMemoryLifecycleEvent(event: MemoryLifecycleEvent): Promise<LifecycleActionResponse>;
    /** @inheritdoc */
    analyzeAndReportMemoryHealth(): Promise<GMIHealthReport['memoryHealth']>;
    /** @inheritdoc */
    getOverallHealth(): Promise<GMIHealthReport>;
    /** @inheritdoc */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=GMI.d.ts.map
/**
 * @fileoverview Provides an abstract base class, `AgentCore`, for all agents in AgentOS.
 * This class implements the `IAgent` interface and offers foundational functionalities
 * common to most agents, such as configuration management, basic state handling,
 * interaction with the PromptEngine, AI Model Providers, and an optional UtilityAI service.
 *
 * Concrete agent implementations (e.g., a `SimpleChatAgent`, `ToolUsingAgent`, or `AgentPoolAgent`)
 * should extend `AgentCore` and implement the abstract `processTurn` method, which defines
 * the agent's primary turn-taking logic. `AgentCore` provides protected helper methods
 * for common tasks like LLM calls and response parsing, promoting code reuse and consistency.
 *
 * The design emphasizes:
 * - Clear separation of concerns: Agent logic is distinct from orchestration or tool execution.
 * - Configurability: Agents are defined by an `AgentConfig` object.
 * - Extensibility: Easy to create new agent types by inheriting from `AgentCore`.
 * - Dependency Injection: Core services (PromptEngine, ProviderManager, etc.) are injected.
 * @module backend/agentos/agents/definitions/AgentCore
 */
import { IAgent, AgentOutput, AgentToolCall } from './IAgent';
import { ConversationContext } from '../../core/conversation/ConversationContext';
import { IProvider, ModelCompletionOptions, ModelCompletionResponse, MessageContent } from '../../core/llm/providers/IProvider';
import { IPromptEngine, PromptComponents, ModelTargetInfo } from '../../core/llm/IPromptEngine';
import type { Tool, ToolDefinition } from './tools/Tool';
import type { UIComponentSpecification } from '../../core/utils/IUIComponent';
import { IUtilityAI } from '../../nlp/ai_utilities/IUtilityAI';
import { AgentPoolConfig } from './AgentPoolConfig';
import { IAgentFactory } from './IAgentFactory';
/**
 * Defines the type of an agent, used for categorization and potentially for
 * determining specific handling or factory instantiation logic.
 * @enum {string}
 */
export declare enum AgentType {
    /** A standard, general-purpose agent. */
    STANDARD = "standard",
    /** An agent that manages a pool of other sub-agents (e.g., a router or mixture-of-experts). */
    POOL = "pool",
    /** A specialized agent focused on a particular task or domain. */
    SPECIALIZED = "specialized",
    /** An agent primarily designed for research or experimental purposes. */
    RESEARCH = "research"
}
/**
 * Configuration options for an agent instance extending `AgentCore`.
 * This rich configuration object defines all aspects of an agent's behavior and capabilities.
 * @interface AgentConfig
 */
export interface AgentConfig {
    /**
     * Unique identifier for the agent configuration.
     * This ID is used by the `AgentFactory` to load and instantiate the agent.
     * @type {string}
     * @example "customer_service_agent_v1"
     */
    id: string;
    /**
     * Human-readable name of the agent.
     * @type {string}
     * @example "Friendly Customer Service Bot"
     */
    name: string;
    /**
     * A detailed description of the agent's purpose, capabilities, typical use cases,
     * and any notable characteristics or limitations.
     * @type {string}
     */
    description: string;
    /**
     * The type of agent this configuration describes (e.g., 'standard', 'pool').
     * This helps in categorizing agents and can be used by factories or orchestrators.
     * @type {AgentType}
     * @default AgentType.STANDARD
     */
    type?: AgentType;
    /**
     * The system prompt defining the agent's core role, personality, high-level instructions,
     * constraints, and desired output format. This is fundamental to guiding the LLM's behavior.
     * It can be a single string or an array of prioritized messages for more complex system instructions.
     * @type {string | Array<{ content: string; priority?: number }>}
     * @example "You are a helpful assistant that speaks like a pirate."
     */
    systemPrompt: string | Array<{
        content: string;
        priority?: number;
    }>;
    /**
     * Information about the primary AI model (LLM) this agent prefers or is optimized for.
     * This is used by the `PromptEngine` for formatting and by the `AIModelProviderManager`
     * (via `AgentFactory`) to select the appropriate `IProvider` instance for this agent.
     * @type {ModelTargetInfo}
     */
    modelTargetInfo: ModelTargetInfo;
    /**
     * Default completion options to use when calling the LLM provider for this agent.
     * These can include parameters like temperature, max_tokens, top_p, etc.
     * These defaults can be overridden on a per-call basis if needed.
     * @type {Partial<ModelCompletionOptions>}
     * @optional
     */
    defaultModelCompletionOptions?: Partial<ModelCompletionOptions>;
    /**
     * An array of tool IDs that this agent is configured and permitted to use.
     * The `AgentOrchestrator` or `ToolExecutor` will provide actual `Tool` instances based on these IDs.
     * @type {string[]}
     * @optional
     * @example ["web_search", "calculator", "database_query_tool"]
     */
    toolIds?: string[];
    /**
     * Optional: Name of a specific prompt template registered with the `IPromptEngine`
     * that this agent should use by default. If not provided, the `PromptEngine`'s
     * system-wide default template will be used.
     * @type {string}
     * @optional
     */
    promptTemplateName?: string;
    /**
     * Agent-specific overrides for the global `PromptEngine` configuration.
     * This allows fine-tuning of prompt construction aspects like history truncation
     * or summarization strategies specifically for this agent.
     * @type {Partial<import('../../core/llm/IPromptEngine').PromptEngineConfig>}
     * @optional
     */
    promptEngineConfigOverrides?: Partial<import('../../core/llm/IPromptEngine').PromptEngineConfig>;
    /**
     * Optional: Identifier for a specific `IUtilityAI` service instance that this agent
     * might use directly for utility tasks (e.g., advanced text analysis, classification)
     * not handled by the `PromptEngine` or standard tools.
     * @type {string}
     * @optional
     */
    utilityAIServiceId?: string;
    /**
     * Configuration specific to an agent operating as an Agent Pool.
     * This field is only present and relevant if `type` is `AgentType.POOL`.
     * @type {AgentPoolConfig}
     * @optional
     */
    agentPoolOptions?: AgentPoolConfig;
    /**
     * Optional: A meta-system prompt specifically for guiding the agent when it encounters
     * unexpected situations, errors from tools, or ambiguous user inputs. This helps the
     * agent to explain issues gracefully or ask for clarification.
     * @type {string}
     * @optional
     * @example "If a tool fails or you don't understand, politely explain the issue and ask the user for more details or an alternative approach."
     */
    metaSystemPromptForUnexpectedSituations?: string;
    /**
     * Optional provenance system configuration.
     * Controls storage immutability, signed event logging, and autonomy enforcement.
     * Use `profiles.mutableDev()`, `profiles.revisionedVerified()`, or
     * `profiles.sealedAutonomous()` for preset configurations.
     * @optional
     */
    provenanceConfig?: import('../../provenance/types.js').ProvenanceSystemConfig;
    /**
     * Allows for adding any other agent-specific custom settings or metadata.
     * This provides an extension point for future or specialized agent properties.
     * @type {{ [key: string]: any }}
     * @optional
     */
    [key: string]: any;
}
/**
 * Custom error class for issues specific to AgentCore operations.
 * @class AgentCoreError
 * @extends {Error}
 */
export declare class AgentCoreError extends Error {
    /**
     * A specific error code related to AgentCore.
     * @type {string}
     */
    readonly code: string;
    /**
     * Optional details or the underlying error.
     * @type {any}
     * @optional
     */
    readonly details?: any;
    /**
     * Creates an instance of AgentCoreError.
     * @param {string} message - The error message.
     * @param {string} code - The error code (e.g., 'LLM_CALL_FAILED', 'PROMPT_PARSE_ERROR').
     * @param {any} [details] - Additional error details.
     */
    constructor(message: string, code: string, details?: any);
}
/**
 * Provides a foundational abstract class for creating specialized agents.
 * It manages configuration, interaction with the `PromptEngine`, `IProvider` (LLM),
 * and an optional `IUtilityAI` service. Concrete agents must implement `processTurn`.
 *
 * @class AgentCore
 * @abstract
 * @implements {IAgent}
 */
export declare abstract class AgentCore implements IAgent {
    /** @inheritdoc */
    readonly id: string;
    /** @inheritdoc */
    readonly name: string;
    /** @inheritdoc */
    readonly description: string;
    /** @inheritdoc */
    readonly agentConfig: AgentConfig;
    /**
     * An instance of the `IPromptEngine` used for constructing prompts.
     * @protected
     * @type {IPromptEngine}
     */
    protected promptEngine: IPromptEngine;
    /**
     * The primary `IProvider` (LLM provider) instance configured for this agent.
     * @protected
     * @type {IProvider}
     */
    protected llmProvider: IProvider;
    /**
     * An optional instance of an `IUtilityAI` service for auxiliary AI tasks.
     * @protected
     * @type {IUtilityAI | undefined}
     */
    protected utilityAI?: IUtilityAI;
    /**
     * An optional instance of `IAgentFactory`. This is typically injected if this agent
     * (e.g., an `AgentPoolAgent`) needs to create or manage sub-agents.
     * @protected
     * @type {IAgentFactory | undefined}
     */
    protected agentFactory?: IAgentFactory;
    /**
     * Indicates if the agent has been successfully initialized.
     * @protected
     * @type {boolean}
     */
    protected isInitialized: boolean;
    /**
     * Constructs an `AgentCore` instance.
     *
     * @param {AgentConfig} config - The configuration for this agent. Must include `id`, `name`,
     * `description`, `systemPrompt`, and `modelTargetInfo`.
     * @param {IPromptEngine} promptEngine - An instance of the `IPromptEngine`.
     * @param {IProvider} llmProvider - The primary AI model provider for this agent.
     * @param {IUtilityAI} [utilityAI] - Optional. An instance of an `IUtilityAI` service.
     * @param {IAgentFactory} [agentFactory] - Optional. An instance of `IAgentFactory`,
     * primarily for agents that manage other agents (e.g., `AgentPoolAgent`).
     * @throws {AgentCoreError} If essential configuration or dependencies are missing.
     */
    constructor(config: AgentConfig, promptEngine: IPromptEngine, llmProvider: IProvider, utilityAI?: IUtilityAI, agentFactory?: IAgentFactory);
    /**
     * Ensures the agent has been initialized before performing operations that depend on it.
     * @protected
     * @throws {AgentCoreError} If the agent is not initialized.
     */
    protected ensureInitialized(): void;
    /**
     * Abstract method that concrete agent classes must implement to process a turn.
     */
    abstract processTurn(userInput: string | null, conversationContext: ConversationContext, availableTools?: Tool[]): Promise<AgentOutput>;
    /**
     * Handles results from tool calls requested by this agent.
     *
     * Subclasses can override this when they need tool-specific handling logic.
     *
     * @throws {AgentCoreError} If adding the tool result to context fails or if the LLM call for explanation fails.
     */
    handleToolResult(toolCallId: string, toolOutput: any, toolName: string, conversationContext: ConversationContext): Promise<AgentOutput>;
    /**
     * Initializes the agent with optional configuration overrides.
     */
    initialize(config?: Record<string, any>): Promise<void>;
    /**
     * Resets any agent-specific state between conversations or sessions.
     */
    reset(): void;
    /**
     * Provides a default implementation for handling internal agent errors.
     *
     * This method leverages the agent's primary LLM to generate a user-friendly explanation
     * of the error and potentially ask for user guidance.
     *
     * @throws {AgentCoreError} If the LLM call for error explanation itself fails.
     */
    handleInternalAgentError(internalErrorDescriptionOrError: string | Error, conversationContext: ConversationContext, isFatalForTurn?: boolean): Promise<AgentOutput>;
    /**
     * Protected helper to construct prompt components for the `PromptEngine`.
     * Gathers system prompt, conversation history, user input, and tool schemas based on agent configuration.
     *
     * @protected
     * @param {string | null} userInput - The current user input.
     * @param {ConversationContext} conversationContext - The conversation context.
     * @param {Tool[]} [availableTools] - Tools available for this turn.
     * @param {Array<{ content: string; priority?: number }>} [additionalSystemPrompts] - Optional additional system prompts to layer in.
     * @returns {Promise<Partial<PromptComponents>>} The assembled prompt components.
     * @throws {AgentCoreError} If `PromptEngine`'s configuration cannot be accessed.
     */
    protected gatherPromptComponents(userInput: string | null, conversationContext: ConversationContext, availableTools?: Tool[], additionalSystemPrompts?: Array<{
        content: string;
        priority?: number;
    }>): Promise<Partial<PromptComponents>>;
    /**
     * Protected helper method to make a call to the LLM provider via the `PromptEngine`.
     *
     * @protected
     * @param {IProvider} llmProvider - The LLM provider instance to use for this call.
     * @param {Partial<PromptComponents>} promptComponents - Components to build the prompt.
     * @param {Partial<ModelCompletionOptions>} [overrideOptions] - Options to override agent's defaults for this specific call.
     * @returns {Promise<ModelCompletionResponse>} The LLM's full response.
     * @throws {AgentCoreError} If prompt construction fails with an error, or if the LLM call itself fails.
     */
    protected callLLM(llmProvider: IProvider, // Allow specifying provider for advanced scenarios (e.g. utility LLM call)
    promptComponents: Partial<PromptComponents>, overrideOptions?: Partial<ModelCompletionOptions>): Promise<ModelCompletionResponse>;
    /**
     * Protected helper to parse an LLM response, extracting the primary text content and any tool calls.
     * It handles parsing of tool call arguments from their typical JSON string format into objects.
     *
     * @protected
     * @param {ModelCompletionResponse} llmResponse - The complete response object from the LLM provider.
     * @returns {{ responseText: string | null; toolCalls?: AgentToolCall[]; rawResponseMessage?: any; }}
     * An object containing:
     * - `responseText`: The main textual content from the LLM, or `null` if none.
     * - `toolCalls`: An array of `AgentToolCall` objects if the LLM requested tool executions, `undefined` otherwise.
     * - `rawResponseMessage`: The actual message object from the LLM's first choice, for debugging or advanced needs.
     * @throws {AgentCoreError} If no valid choice is found in the LLM response.
     */
    protected parseLLMResponse(llmResponse: ModelCompletionResponse): {
        responseText: string | null;
        toolCalls?: AgentToolCall[];
        rawResponseMessage?: any;
    };
    /**
     * Normalizes a provider message content payload into plain text where possible.
     */
    protected extractTextFromMessageContent(content: MessageContent | null | undefined): string | null;
    /**
     * Protected helper to get `ToolDefinition`s for a list of tool IDs.
     * Used internally when `callLLM` needs to pass tool schemas.
     * This assumes tools are registered with a `ToolRegistry` or accessible via `AgentOrchestrator`
     * or similar mechanism that can provide `Tool` instances.
     * For `AgentCore`, it needs a way to access these definitions.
     * A simple approach is to assume `this.agentConfig.toolIds` refers to tools
     * whose definitions can be fetched. This detail depends on how tools are managed globally.
     * For now, this is a placeholder and might require a `ToolRegistry` dependency.
     *
     * @param _toolIds List of tool IDs.
     * @returns Array of ToolDefinitions.
     */
    protected getAvailableToolDefinitions(_toolIds: string[]): Promise<ToolDefinition[] | undefined>;
    /**
     * Creates a standard text-only agent output.
     * @param {string} text - The textual response from the agent.
     * @param {boolean} [isComplete=true] - Indicates if the agent's turn is complete with this output.
     * @param {Record<string, any>} [metadata] - Optional metadata to include.
     * @returns {AgentOutput} The structured agent output.
     */
    protected textOutput(text: string, isComplete?: boolean, metadata?: Record<string, any>): AgentOutput;
    /**
     * Creates an agent output that requests UI components to be rendered by the client.
     * @param {UIComponentSpecification[]} components - An array of UI component specifications.
     * @param {string} [responseText] - Optional accompanying textual response.
     * @param {boolean} [isComplete=true] - Indicates if the agent's turn is complete.
     * @param {Record<string, any>} [metadata] - Optional metadata.
     * @returns {AgentOutput} The structured agent output.
     */
    protected uiOutput(components: UIComponentSpecification[], responseText?: string, isComplete?: boolean, metadata?: Record<string, any>): AgentOutput;
    /**
     * Creates an agent output that requests one or more tool calls to be executed.
     * This typically means the agent's turn is **not yet complete** (`isComplete: false`),
     * as it will await the results of these tool calls.
     *
     * @param {AgentToolCall[]} toolCalls - An array of tool call objects.
     * @param {string} [responseText] - Optional interim text to provide to the user
     * (e.g., "Okay, I will search the web for that information.").
     * @param {Record<string, any>} [metadata] - Optional metadata.
     * @returns {AgentOutput} The structured agent output.
     * @throws {AgentCoreError} If `toolCalls` array is empty or not provided.
     */
    protected toolCallOutput(toolCalls: AgentToolCall[], responseText?: string, metadata?: Record<string, any>): AgentOutput;
}
//# sourceMappingURL=AgentCore.d.ts.map
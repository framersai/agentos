/**
 * @fileoverview Implements the `AgentPoolAgent`, a specialized type of `AgentCore`
 * that functions as a manager or orchestrator for a collection of other "sub-agents".
 * This agent embodies strategies like routing requests to the most suitable sub-agent,
 * synthesizing responses from multiple sub-agents (mixture of experts), or delegating
 * tasks directly.
 *
 * The `AgentPoolAgent` uses an `IAgentFactory` to instantiate its sub-agents based on
 * IDs provided in its `AgentPoolConfig`. Its behavior is primarily dictated by the
 * `AgentPoolStrategy` defined in its configuration.
 *
 * Key functionalities:
 * - Loads and initializes a set of sub-agents.
 * - Implements various strategies for sub-agent interaction and output generation.
 * - Can maintain a "unified persona" for user-facing interactions, even if sub-agents
 * have distinct characteristics.
 * - Utilizes its own LLM provider and prompt engine for meta-tasks like routing
 * decisions or synthesizing sub-agent outputs.
 * @module backend/agentos/agents/definitions/AgentPoolAgent
 */
import { AgentCore, AgentConfig, AgentType } from './AgentCore';
import { IAgent, AgentOutput } from './IAgent';
import { AgentPoolConfig } from './AgentPoolConfig';
import { ConversationContext } from '../../core/conversation/ConversationContext';
import { IProvider } from '../../core/llm/providers/IProvider';
import { IPromptEngine } from '../../core/llm/IPromptEngine';
import { Tool } from './tools/Tool';
import { IUtilityAI } from '../../nlp/ai_utilities/IUtilityAI';
import { IAgentFactory, AgentDependencies } from './IAgentFactory';
/**
 * Configuration specific to an `AgentPoolAgent`.
 * It extends the base `AgentConfig` and mandates that the `type` is `AgentType.POOL`,
 * and that `agentPoolOptions` (defined by `AgentPoolConfig`) are provided.
 * @interface AgentPoolAgentConfig
 * @extends {AgentConfig}
 */
export interface AgentPoolAgentConfig extends AgentConfig {
    /**
     * Specifies the type of this agent, which must be `AgentType.POOL`.
     * @type {AgentType.POOL}
     */
    type: AgentType.POOL;
    /**
     * Configuration settings specific to the agent pool's operation,
     * including sub-agent IDs and interaction strategy.
     * @type {AgentPoolConfig}
     */
    agentPoolOptions: AgentPoolConfig;
}
/**
 * A concrete agent implementation that acts as an intelligent coordinator or router
 * for a collection of sub-agents. It encapsulates the logic for selecting,
 * dispatching tasks to, and synthesizing results from its managed sub-agents,
 * all based on a configured `AgentPoolStrategy`.
 *
 * @class AgentPoolAgent
 * @extends {AgentCore}
 * @implements {IAgent}
 */
export declare class AgentPoolAgent extends AgentCore implements IAgent {
    /**
     * The specific configuration for this agent pool's operations.
     * @private
     * @type {AgentPoolConfig}
     */
    private readonly poolConfig;
    /**
     * A map storing the instantiated sub-agent instances, keyed by their agent IDs.
     * @private
     * @type {Map<string, IAgent>}
     */
    private subAgents;
    /**
     * Snapshot of the dependencies originally supplied by the orchestrator/factory.
     * Needed so the pool can instantiate sub-agents with the same services.
     */
    private agentDependencies?;
    /**
     * Stores tools that are available to the pool agent itself. These might be
     * different from tools available to individual sub-agents.
     * @private
     * @type {Tool[]}
     */
    private availablePoolTools;
    /**
     * Constructs an `AgentPoolAgent` instance.
     *
     * @param {AgentPoolAgentConfig} config - The configuration for this agent pool.
     * Must specify `type` as `AgentType.POOL` and include `agentPoolOptions`.
     * @param {IPromptEngine} promptEngine - An instance of the `IPromptEngine`.
     * @param {IProvider} llmProvider - The primary AI model provider for the pool agent's
     * own meta-tasks (e.g., routing, synthesis).
     * @param {IUtilityAI | undefined} utilityAI - Optional. An instance of an `IUtilityAI` service.
     * @param {IAgentFactory} agentFactory - The `IAgentFactory` instance, which is **required**
     * for the `AgentPoolAgent` to load and instantiate its sub-agents.
     * @throws {AgentCoreError} If the configuration is invalid (e.g., missing `agentPoolOptions`)
     * or if the `agentFactory` dependency is not provided.
     */
    constructor(config: AgentPoolAgentConfig, promptEngine: IPromptEngine, llmProvider: IProvider, utilityAI: IUtilityAI | undefined, agentFactory: IAgentFactory);
    /**
     * Allows the orchestrator/factory to provide the dependency bundle that was used
     * to construct this pool agent so it can reuse them when instantiating sub-agents.
     */
    setAgentDependencies(dependencies: AgentDependencies): void;
    /**
     * Initializes the `AgentPoolAgent`. This involves:
     * 1. Calling the base class `initialize` method.
     * 2. Using the injected `IAgentFactory` to load and initialize all sub-agents
     * specified in `this.poolConfig.subAgentIds`.
     *
     * @override
     * @param {Record<string, any>} [configOverrides] - Optional configuration overrides applied during initialization.
     * @returns {Promise<void>}
     * @throws {AgentCoreError} If the `agentFactory` is missing or if any sub-agent fails to load or initialize.
     */
    initialize(configOverrides?: Record<string, any>): Promise<void>;
    /**
     * Resets the `AgentPoolAgent`'s internal state and propagates the reset call
     * to all its managed sub-agents.
     * @override
     */
    reset(): void;
    /**
     * Overrides the `processTurn` method from `AgentCore` to implement the specific
     * orchestration logic of the `AgentPoolAgent` based on its configured strategy.
     * This method will route tasks to, or synthesize results from, its sub-agents.
     *
     * @override
     * @param {string | null} userInput - The latest input from the user.
     * @param {ConversationContext} conversationContext - The current conversation context.
     * @param {Tool[]} [availableTools] - Tools available to the pool agent itself (these might also
     * be passed down to sub-agents depending on the strategy and sub-agent capabilities).
     * @returns {Promise<AgentOutput>} The agent's response and actions, which could be a direct
     * response, a synthesized response from sub-agents, or tool calls.
     * @throws {AgentCoreError} If an unhandled error occurs within the chosen strategy.
     */
    processTurn(userInput: string | null, conversationContext: ConversationContext, availableTools?: Tool[]): Promise<AgentOutput>;
    /**
     * Implements the `UNIFIED_PERSONA_ROUTING` strategy.
     * This involves using an LLM (the pool agent's own) to select the most appropriate sub-agent
     * based on the user input and sub-agent descriptions. The selected sub-agent's output
     * is then rephrased by the pool agent to maintain a consistent unified persona.
     *
     * @private
     * @param {string | null} userInput - The user's input.
     * @param {ConversationContext} conversationContext - The current conversation context.
     * @returns {Promise<AgentOutput>} The synthesized and persona-aligned output.
     */
    private handleUnifiedPersonaRouting;
    /**
     * Implements the `MIXTURE_OF_EXPERTS_SYNTHESIS` strategy.
     * Consults multiple (or all) sub-agents and then uses the pool's LLM to synthesize
     * their contributions into a single, coherent response.
     *
     * @private
     * @param {string | null} userInput - The user's input.
     * @param {ConversationContext} conversationContext - The current conversation context.
     * @returns {Promise<AgentOutput>} The synthesized output from the mixture of experts.
     */
    private handleMixtureOfExpertsSynthesis;
    /**
     * Implements the `DIRECT_DELEGATION` strategy.
     * Selects a single sub-agent (e.g., based on simple routing logic or configuration)
     * and directly forwards its response without significant modification by the pool agent.
     *
     * @private
     * @param {string | null} userInput - The user's input.
     * @param {ConversationContext} conversationContext - The current conversation context.
     * @returns {Promise<AgentOutput>} The output from the delegated sub-agent.
     */
    private handleDirectDelegation;
    /**
     * Implements the `EXPLORATORY_GENERATION` strategy. (Placeholder - complex to fully implement here)
     * Spawns sub-agents to explore different approaches for a problem, then evaluates
     * and synthesizes their outputs. This is a more advanced strategy.
     *
     * @private
     * @param {string | null} userInput - The user's input.
     * @param {ConversationContext} conversationContext - The current conversation context.
     * @returns {Promise<AgentOutput>} The synthesized result of the exploratory generation.
     */
    private handleExploratoryGeneration;
    /**
     * Generates a prompt for the pool agent's internal LLM to perform routing to a sub-agent.
     * The prompt includes descriptions of available sub-agents and the user's query.
     *
     * @private
     * @param {string | null} userInput - The user's current input.
     * @param {ConversationContext} conversationContext - For history and broader context.
     * @param {IAgent[]} subAgents - The list of available sub-agents to choose from.
     * @returns {Partial<PromptComponents>} The components for constructing the routing prompt.
     */
    private generateRoutingPrompt;
    /**
     * Parses the LLM's response when it was tasked with routing, expecting just an agent ID or "NONE".
     *
     * @private
     * @param {ModelCompletionResponse} llmResponse - The response from the routing LLM call.
     * @param {string[]} validAgentIds - An array of valid sub-agent IDs for validation.
     * @returns {string | null} The chosen agent ID, or `null` if parsing fails or "NONE" is returned.
     */
    private parseLLMResponseForRouting;
    /**
     * Generates a prompt for the pool agent's internal LLM to synthesize outputs from multiple expert sub-agents.
     *
     * @private
     * @param {string | null} originalUserInput - The initial user input that led to expert consultation.
     * @param {ConversationContext} conversationContext - For overall context.
     * @param {Array<{ agentId: string; agentName: string; agentDescription: string; output: AgentOutput; }>} expertResults - The outputs from consulted sub-agents.
     * @returns {Partial<PromptComponents>} The components for constructing the synthesis prompt.
     */
    private generateSynthesisPrompt;
    /**
     * A helper method to potentially rephrase or wrap a sub-agent's output to align
     * with the pool's unified persona, if one is configured. Also finalizes metadata.
     *
     * @private
     * @param {AgentOutput} subAgentOutput - The output from the sub-agent.
     * @param {IAgent} sourceAgent - The sub-agent that produced the output.
     * @param {ConversationContext} conversationContext - For context if rephrasing LLM call is needed.
     * @param {string} internalActionDescription - Description of the pool's internal action (e.g., "Routed to expert").
     * @param {boolean} [isDirectDelegation=false] - If true, rephrasing might be lighter or skipped.
     * @returns {Promise<AgentOutput>} The finalized (potentially rephrased) `AgentOutput`.
     */
    private synthesizeAndFinalizeOutput;
    /**
     * Overrides `handleToolResult` from `AgentCore`.
     * This method is called when a tool initiated by the `AgentPoolAgent` itself completes.
     * (Tools initiated by sub-agents are handled by their respective `handleToolResult` methods,
     * and the orchestrator delivers the result to that sub-agent).
     *
     * The `AgentPoolAgent` might use tools for its meta-tasks, like a "SubAgentSelectionTool"
     * or a "ContentAnalysisTool" to help in routing or synthesis.
     *
     * @override
     * @param {string} toolCallId - The ID of the tool call this result pertains to.
     * @param {any} toolOutput - The output from the tool execution.
     * @param {string} toolName - The name of the tool that was called.
     * @param {ConversationContext} conversationContext - The current conversation context.
     * @returns {Promise<AgentOutput>} The pool agent's subsequent output after processing its own tool's result.
     */
    handleToolResult(toolCallId: string, toolOutput: any, toolName: string, conversationContext: ConversationContext): Promise<AgentOutput>;
}
//# sourceMappingURL=AgentPoolAgent.d.ts.map
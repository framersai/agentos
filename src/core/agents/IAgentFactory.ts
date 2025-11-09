/**
 * @fileoverview Defines the IAgentFactory interface, which outlines the contract
 * for creating and managing agent instances within AgentOS. An Agent Factory is a
 * critical component for abstracting the instantiation logic of agents, allowing
 * for a flexible and extensible system where agents can be configured and created
 * dynamically with all their required dependencies injected.
 *
 * The factory pattern employed here promotes loose coupling between the agent
 * consumers (e.g., an orchestrator) and the concrete agent implementations.
 * @module backend/agentos/core/agents/IAgentFactory
 */

import { IAgent } from './IAgent';
import { AgentConfig } from './AgentCore';
import { IPromptEngine } from '../llm/IPromptEngine';
import { IProvider } from '../llm/providers/IProvider';
import { IUtilityAI } from '../ai_utilities/IUtilityAI';
import { AIModelProviderManager } from '../llm/providers/AIModelProviderManager';

/**
 * Defines the set of shared dependencies that an agent instance typically requires.
 * The `IAgentFactory` uses this structure to ensure that all necessary services
 * are provided to an agent upon its creation.
 * @interface AgentDependencies
 */
export interface AgentDependencies {
  /**
   * An instance of the `IPromptEngine`, used by agents for constructing
   * dynamic and context-aware prompts for LLMs.
   * @type {IPromptEngine}
   */
  promptEngine: IPromptEngine;

  /**
   * An instance of the `AIModelProviderManager`. The factory uses this manager
   * to resolve the specific primary `IProvider` (LLM provider) for an agent
   * based on the agent's configuration (specifically `AgentConfig.modelTargetInfo.providerId`).
   * @type {AIModelProviderManager}
   */
  providerManager: AIModelProviderManager;

  /**
   * Optional. An instance of an `IUtilityAI` service, which agents might use
   * for auxiliary AI tasks such as text summarization, classification,
   * sentiment analysis, etc., beyond direct LLM interactions.
   * @type {IUtilityAI | undefined}
   * @optional
   */
  utilityAI?: IUtilityAI;

  /**
   * Optional. An instance of the `IAgentFactory` itself. This is crucial for
   * agents that need to instantiate or manage other sub-agents (e.g., an `AgentPoolAgent`
   * creating its pool members). This enables hierarchical agent structures.
   * @type {IAgentFactory | undefined}
   * @optional
   */
  agentFactory?: IAgentFactory;

  // Future considerations:
  // - IEventBus: For agents to publish or subscribe to system-wide events.
  // - IMemoryManager: If agents need more direct or complex interaction with memory systems beyond conversation context.
  // - IToolRegistry: If agents need to dynamically query or load tools beyond what's provided by an orchestrator.
}

/**
 * Defines the expected signature for an agent class constructor that the `IAgentFactory`
 * will use to instantiate new agent objects. Agents intended to be created by the factory,
 * particularly those extending `AgentCore`, should generally adhere to this constructor signature.
 *
 * @template TExtendsAgentConfig - Allows for specific agent configurations if needed, defaulting to `AgentConfig`.
 * @param {TExtendsAgentConfig} config - The agent's configuration object.
 * @param {IPromptEngine} promptEngine - The prompt engine instance.
 * @param {IProvider} llmProvider - The primary LLM provider instance resolved for this agent.
 * @param {IUtilityAI} [utilityAI] - Optional utility AI service instance.
 * @param {IAgentFactory} [agentFactory] - Optional agent factory instance (for creating sub-agents).
 * @returns {IAgent} An instance of an object implementing the `IAgent` interface.
 */
export type AgentClassConstructor<TExtendsAgentConfig extends AgentConfig = AgentConfig> = new (
  config: TExtendsAgentConfig,
  promptEngine: IPromptEngine,
  llmProvider: IProvider,
  utilityAI?: IUtilityAI,
  agentFactory?: IAgentFactory
) => IAgent;

/**
 * Defines the contract for a factory responsible for creating and managing agent instances.
 * The factory centralizes agent instantiation logic, making the system more modular and
 * easier to extend with new agent types.
 * @interface IAgentFactory
 */
export interface IAgentFactory {
  /**
   * Initializes the AgentFactory. This typically involves loading all available agent
   * configurations (e.g., from files or a database) and registering the corresponding
   * agent implementation classes that can be instantiated.
   *
   * @async
   * @param {Record<string, AgentConfig>} agentConfigs - A map where keys are unique agent IDs
   * (e.g., "customerSupportAgentV1") and values are their `AgentConfig` objects.
   * These configurations define the properties and behaviors of the agents.
   * @param {Record<string, AgentClassConstructor<any>>} agentClassMap - A map where keys are
   * agent type identifiers (typically a string from `AgentConfig.type`, e.g., "standard", "pool_agent")
   * and values are the constructor functions for the agent classes.
   * @returns {Promise<void>} A promise that resolves when the factory has been successfully initialized.
   * @throws {Error} If initialization fails (e.g., invalid configurations, issues loading classes).
   */
  initialize(
    agentConfigs: Record<string, AgentConfig>,
    agentClassMap: Record<string, AgentClassConstructor<any>> // `any` allows for AgentPoolAgentConfig etc.
  ): Promise<void>;

  /**
   * Retrieves, and typically creates and initializes, an instance of an agent specified by its unique ID.
   * The factory ensures that the agent is instantiated with all its required dependencies,
   * as defined in `AgentDependencies`.
   *
   * @async
   * @param {string} agentId - The unique ID of the agent to get or create. This ID must correspond
   * to an entry in the `agentConfigs` provided during factory initialization.
   * @param {AgentDependencies} dependencies - An object containing shared dependencies (like `promptEngine`,
   * `providerManager`, etc.) that will be injected into the newly created agent instance.
   * @returns {Promise<IAgent | undefined>} A promise that resolves to the `IAgent` instance
   * if successfully created and initialized. Returns `undefined` if the `agentId` is not found,
   * the corresponding agent class is not registered, or if creation/initialization fails gracefully.
   * @throws {AgentInstantiationError | Error} If critical errors occur during agent instantiation
   * that prevent its creation (e.g., missing provider, class constructor error). Custom `AgentInstantiationError` preferred.
   */
  getAgent(agentId: string, dependencies: AgentDependencies): Promise<IAgent | undefined>;

  /**
   * Lists all agent configurations currently known to the factory.
   * This is useful for discovery mechanisms, allowing UIs or other system components
   * to understand what types of agents are available for instantiation.
   *
   * @async
   * @returns {Promise<Readonly<AgentConfig[]>>} A promise that resolves to a read-only array
   * of `AgentConfig` objects. The array is read-only to prevent external modification of the
   * factory's internal state.
   * @throws {Error} If the factory is not initialized or cannot access its configurations.
   */
  listAvailableAgentConfigs(): Promise<Readonly<AgentConfig[]>>;

  /**
   * Allows for the dynamic registration of a new agent type and its corresponding constructor
   * with the factory after initial `initialize` call. This is particularly useful for plugin systems
   * or scenarios where agent classes are loaded or defined at runtime.
   *
   * @async
   * @param {string} agentType - The type identifier for the agent (e.g., "ResearchAgent_v3", "SummarizationPool").
   * This type identifier should match the `type` field that would be used in an `AgentConfig`
   * for agents of this class.
   * @param {AgentClassConstructor<any>} constructor - The class constructor function for this new agent type.
   * @returns {Promise<void>} A promise that resolves when the agent class has been successfully registered.
   * @throws {Error} If the factory is not initialized, or if `agentType` or `constructor` are invalid,
   * or if an agent type with the same identifier is already registered (behavior for overwrite vs. error can be implementation-specific).
   */
  registerAgentClass(agentType: string, constructor: AgentClassConstructor<any>): Promise<void>;
}
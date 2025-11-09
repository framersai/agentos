/**
 * @fileoverview Implements the `IAgentFactory` interface, providing a robust
 * mechanism for creating and managing agent instances within AgentOS.
 * This factory is responsible for:
 * - Loading and storing agent configurations (`AgentConfig`).
 * - Mapping agent type identifiers (from `AgentConfig.type`) to their corresponding
 * agent class constructors (`AgentClassConstructor`).
 * - Instantiating agents by their unique IDs, ensuring all necessary dependencies
 * (like `IPromptEngine`, `AIModelProviderManager`, `IUtilityAI`, and the `IAgentFactory` itself)
 * are correctly injected.
 * - Handling the initialization lifecycle of newly created agents.
 * - Allowing dynamic registration of new agent types.
 *
 * This centralized approach to agent creation promotes modularity, testability,
 * and simplifies the process of extending the system with new agent types.
 * @module backend/agentos/core/agents/AgentFactory
 */

import { IAgentFactory, AgentDependencies, AgentClassConstructor } from './IAgentFactory';
import { IAgent } from './IAgent';
import { AgentConfig, AgentType } from './AgentCore'; // AgentConfig and AgentType
import { IPromptEngine } from '../llm/IPromptEngine';
import { IProvider } from '../llm/providers/IProvider';
import { IUtilityAI } from '../ai_utilities/IUtilityAI';
import { AIModelProviderManager } from '../llm/providers/AIModelProviderManager';

/**
 * Custom error class for issues specific to agent instantiation or configuration
 * within the `AgentFactory`. This helps in distinguishing factory-related errors
 * from other system errors.
 * @class AgentFactoryError
 * @extends {Error}
 */
export class AgentFactoryError extends Error {
  /**
   * A specific error code related to AgentFactory operations.
   * @type {string}
   */
  public readonly code: string;

  /**
   * The ID of the agent involved in the error, if applicable.
   * @type {string | undefined}
   * @optional
   */
  public readonly agentId?: string;

  /**
   * The underlying error that caused this factory error, if any.
   * @type {Error | undefined}
   * @optional
   */
  public readonly underlyingError?: Error;

  /**
   * Creates an instance of `AgentFactoryError`.
   * @param {string} message - The human-readable error message.
   * @param {string} code - A unique code for the error type (e.g., 'CONFIG_NOT_FOUND', 'CLASS_NOT_REGISTERED', 'INSTANTIATION_FAILED').
   * @param {string} [agentId] - Optional. The ID of the agent associated with this error.
   * @param {Error} [underlyingError] - Optional. The original error that was caught and wrapped.
   */
  constructor(message: string, code: string, agentId?: string, underlyingError?: Error) {
    super(message);
    this.name = "AgentFactoryError";
    this.code = code;
    this.agentId = agentId;
    this.underlyingError = underlyingError;

    if (underlyingError && underlyingError.stack) {
      this.stack = `${this.message}\nCaused by: ${underlyingError.stack}`;
    }
    Object.setPrototypeOf(this, AgentFactoryError.prototype);
  }
}

/**
 * A concrete implementation of `IAgentFactory`.
 * This class is responsible for instantiating `IAgent` implementations based on
 * loaded `AgentConfig` data and a map of registered agent classes. It ensures
 * that agents are created with all their required dependencies.
 *
 * @class AgentFactory
 * @implements {IAgentFactory}
 */
export class AgentFactory implements IAgentFactory {
  /**
   * Stores agent configurations, keyed by their unique agent ID.
   * @private
   * @type {Record<string, AgentConfig>}
   */
  private agentConfigs: Record<string, AgentConfig> = {};

  /**
   * Maps agent type identifiers (strings) to their corresponding class constructors.
   * @private
   * @type {Record<string, AgentClassConstructor<any>>}
   */
  private agentClassMap: Record<string, AgentClassConstructor<any>> = {};

  /**
   * Flag indicating whether the factory has been successfully initialized.
   * @private
   * @type {boolean}
   */
  private isInitialized: boolean = false;

  /**
   * Constructs an `AgentFactory`.
   * Initialization (loading configs and classes) is performed via the `initialize` method.
   */
  constructor() {
    // console.log("AgentFactory instance created. Awaiting initialization.");
  }

  /**
   * Ensures that the factory has been initialized before any operational methods are called.
   * @private
   * @throws {AgentFactoryError} If the factory is not initialized.
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new AgentFactoryError(
        "AgentFactory is not initialized. Call initialize() with agent configurations and class map first.",
        'FACTORY_NOT_INITIALIZED'
      );
    }
  }

  /**
   * @inheritdoc
   * Initializes the `AgentFactory` by loading agent configurations and mapping agent types
   * to their respective class constructors.
   * @throws {AgentFactoryError} If `agentConfigs` or `agentClassMap` is null/undefined.
   */
  public async initialize(
    agentConfigs: Record<string, AgentConfig>,
    agentClassMap: Record<string, AgentClassConstructor<any>>
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn("AgentFactory is already initialized. Re-initializing will overwrite existing configurations and class mappings.");
      // Resetting state for re-initialization
      this.agentConfigs = {};
      this.agentClassMap = {};
    }

    if (!agentConfigs) {
        throw new AgentFactoryError("Agent configurations (agentConfigs) must be provided for initialization.", 'INIT_NO_CONFIGS');
    }
    if (!agentClassMap) {
        throw new AgentFactoryError("Agent class map (agentClassMap) must be provided for initialization.", 'INIT_NO_CLASSMAP');
    }

    // Store copies to prevent external modification of the provided objects.
    this.agentConfigs = { ...agentConfigs };
    this.agentClassMap = { ...agentClassMap };
    this.isInitialized = true;

    const configCount = Object.keys(this.agentConfigs).length;
    const classCount = Object.keys(this.agentClassMap).length;

    if (configCount > 0 || classCount > 0) {
    //   console.log(`AgentFactory initialized successfully with ${configCount} agent configurations and ${classCount} registered agent classes.`);
    } else {
      console.warn("AgentFactory initialized, but no agent configurations or agent classes were provided. The factory may not be able to create agents.");
    }
  }

  /**
   * @inheritdoc
   * Dynamically registers an agent type and its constructor with the factory.
   * This allows for adding new agent implementations at runtime or via a plugin system.
   * @throws {AgentFactoryError} If `agentType` or `constructor` is invalid, or if an agent type is already registered and overwrite is not intended.
   */
  public async registerAgentClass(agentType: string, constructor: AgentClassConstructor<any>): Promise<void> {
    this.ensureInitialized();

    if (!agentType || typeof agentType !== 'string' || agentType.trim() === '') {
      throw new AgentFactoryError("Invalid agentType: Must be a non-empty string.", 'REGISTER_INVALID_AGENT_TYPE');
    }
    if (!constructor || typeof constructor !== 'function') {
      throw new AgentFactoryError(`Invalid constructor provided for agentType '${agentType}'. Must be a class constructor.`, 'REGISTER_INVALID_CONSTRUCTOR', agentType);
    }

    if (this.agentClassMap[agentType]) {
      console.warn(`AgentFactory: Agent type '${agentType}' is already registered. The existing constructor will be overwritten.`);
    }
    this.agentClassMap[agentType] = constructor;
    // console.log(`AgentFactory: Agent type '${agentType}' registered successfully.`);
  }

  /**
   * @inheritdoc
   * Retrieves (and typically creates and initializes) an agent instance by its ID.
   * It resolves the agent's primary LLM provider using the `AIModelProviderManager` from `dependencies`.
   * @throws {AgentFactoryError} If critical errors occur during instantiation, such as missing configuration,
   * unregistered class, or failure to resolve the LLM provider.
   */
  public async getAgent(agentId: string, dependencies: AgentDependencies): Promise<IAgent | undefined> {
    this.ensureInitialized();

    if (!agentId) {
        throw new AgentFactoryError("agentId must be provided to getAgent.", 'GET_AGENT_NO_ID');
    }
    if (!dependencies || !dependencies.promptEngine || !dependencies.providerManager) {
      throw new AgentFactoryError(
        "Missing critical dependencies (promptEngine, providerManager) required to create agent.",
        'GET_AGENT_MISSING_DEPS',
        agentId
      );
    }
    // Destructure all dependencies for clarity
    const { promptEngine, providerManager, utilityAI, agentFactory: selfFactory } = dependencies;


    const config = this.agentConfigs[agentId];
    if (!config) {
      console.warn(`AgentFactory: No AgentConfig found for agentId '${agentId}'. Cannot create agent.`);
      return undefined; // Gracefully return undefined if config not found
    }

    // Determine the agent's primary LLM provider using modelTargetInfo from its config
    const providerIdToUse = config.modelTargetInfo?.providerId;
    if (!providerIdToUse) {
      throw new AgentFactoryError(
        `AgentConfig for '${agentId}' is missing 'modelTargetInfo.providerId'. Cannot determine primary LLM provider.`,
        'GET_AGENT_NO_PROVIDER_ID',
        agentId
      );
    }

    const agentPrimaryProvider = providerManager.getProvider(providerIdToUse);
    if (!agentPrimaryProvider) {
      throw new AgentFactoryError(
        `Could not resolve primary LLM provider '${providerIdToUse}' for agent '${agentId}' using the provided AIModelProviderManager. Ensure the provider is configured and initialized in the manager.`,
        'GET_AGENT_PROVIDER_RESOLUTION_FAILED',
        agentId
      );
    }

    // Determine the AgentClass constructor to use.
    // `config.type` (e.g., AgentType.POOL) is the key for agentClassMap.
    const agentTypeKey = config.type || AgentType.STANDARD; // Default to STANDARD if type not specified
    const AgentClass = this.agentClassMap[agentTypeKey];

    if (!AgentClass) {
      throw new AgentFactoryError(
        `No implementing class registered for agent type '${agentTypeKey}' (referenced by agentId '${agentId}'). Agent cannot be created. Ensure the class is registered with the factory using registerAgentClass(). Known types: [${Object.keys(this.agentClassMap).join(', ')}].`,
        'GET_AGENT_CLASS_NOT_REGISTERED',
        agentId
      );
    }

    let agentInstance: IAgent;
    try {
      // Instantiate the agent, passing all resolved dependencies.
      // Note: `selfFactory` (which is `dependencies.agentFactory`) is passed here.
      agentInstance = new AgentClass(config, promptEngine, agentPrimaryProvider, utilityAI, selfFactory);
    } catch (error: any) {
      console.error(`AgentFactory: Error during instantiation of agent '${agentId}' (type '${agentTypeKey}'): ${error.message}`, error);
      throw new AgentFactoryError(
        `Failed to instantiate agent '${agentId}' of type '${agentTypeKey}'. Constructor threw an error: ${error.message}`,
        'GET_AGENT_CONSTRUCTION_FAILED',
        agentId,
        error
      );
    }

    // Give the agent a chance to capture the dependency bundle if it supports it.
    if (typeof (agentInstance as any).setAgentDependencies === 'function') {
      try {
        (agentInstance as any).setAgentDependencies(dependencies);
      } catch (depError: any) {
        console.warn(`AgentFactory: Agent '${agentId}' threw while receiving dependencies: ${depError.message}`, depError);
      }
    }

    // Call the agent's own initialize method, if it exists and is a function.
    // This allows the agent to perform any specific asynchronous setup post-construction.
    if (typeof agentInstance.initialize === 'function') {
      try {
        await agentInstance.initialize();
      } catch (initError: any) {
        console.error(`AgentFactory: Error during agent.initialize() for '${agentId}': ${initError.message}`, initError);
        throw new AgentFactoryError(
          `Agent '${agentId}' was instantiated but failed during its own initialize() method: ${initError.message}`,
          'GET_AGENT_INITIALIZATION_FAILED',
          agentId,
          initError
        );
      }
    }
    // console.log(`AgentFactory: Successfully created and initialized agent '${agentId}' of type '${agentTypeKey}'.`);
    return agentInstance;
  }

  /**
   * @inheritdoc
   * Lists all available agent configurations known to the factory.
   * Returns deep copies of the configurations to prevent external modification.
   */
  public async listAvailableAgentConfigs(): Promise<Readonly<AgentConfig[]>> {
    this.ensureInitialized();
    // Return deep copies to ensure immutability of the factory's internal state.
    // JSON.parse(JSON.stringify(...)) is a common way to deep copy plain objects.
    try {
        return Object.freeze(
            Object.values(this.agentConfigs).map(config => JSON.parse(JSON.stringify(config)))
        );
    } catch (error: any) {
        console.error("AgentFactory: Failed to deep copy agent configurations for listing.", error);
        throw new AgentFactoryError(
            `Failed to list available agent configurations due to a cloning error: ${error.message}`,
            'LIST_CONFIGS_CLONE_FAILED',
            undefined,
            error
        );
    }
  }
}

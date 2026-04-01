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
 * @module backend/agentos/agents/definitions/AgentFactory
 */
import { IAgentFactory, AgentDependencies, AgentClassConstructor } from './IAgentFactory';
import { IAgent } from './IAgent';
import { AgentConfig } from './AgentCore';
/**
 * Custom error class for issues specific to agent instantiation or configuration
 * within the `AgentFactory`. This helps in distinguishing factory-related errors
 * from other system errors.
 * @class AgentFactoryError
 * @extends {Error}
 */
export declare class AgentFactoryError extends Error {
    /**
     * A specific error code related to AgentFactory operations.
     * @type {string}
     */
    readonly code: string;
    /**
     * The ID of the agent involved in the error, if applicable.
     * @type {string | undefined}
     * @optional
     */
    readonly agentId?: string;
    /**
     * The underlying error that caused this factory error, if any.
     * @type {Error | undefined}
     * @optional
     */
    readonly underlyingError?: Error;
    /**
     * Creates an instance of `AgentFactoryError`.
     * @param {string} message - The human-readable error message.
     * @param {string} code - A unique code for the error type (e.g., 'CONFIG_NOT_FOUND', 'CLASS_NOT_REGISTERED', 'INSTANTIATION_FAILED').
     * @param {string} [agentId] - Optional. The ID of the agent associated with this error.
     * @param {Error} [underlyingError] - Optional. The original error that was caught and wrapped.
     */
    constructor(message: string, code: string, agentId?: string, underlyingError?: Error);
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
export declare class AgentFactory implements IAgentFactory {
    /**
     * Stores agent configurations, keyed by their unique agent ID.
     * @private
     * @type {Record<string, AgentConfig>}
     */
    private agentConfigs;
    /**
     * Maps agent type identifiers (strings) to their corresponding class constructors.
     * @private
     * @type {Record<string, AgentClassConstructor<any>>}
     */
    private agentClassMap;
    /**
     * Flag indicating whether the factory has been successfully initialized.
     * @private
     * @type {boolean}
     */
    private isInitialized;
    /**
     * Constructs an `AgentFactory`.
     * Initialization (loading configs and classes) is performed via the `initialize` method.
     */
    constructor();
    /**
     * Ensures that the factory has been initialized before any operational methods are called.
     * @private
     * @throws {AgentFactoryError} If the factory is not initialized.
     */
    private ensureInitialized;
    /**
     * Initializes the factory with agent configurations and agent class mappings.
     *
     * @throws {AgentFactoryError} If `agentConfigs` or `agentClassMap` is null/undefined.
     */
    initialize(agentConfigs: Record<string, AgentConfig>, agentClassMap: Record<string, AgentClassConstructor<any>>): Promise<void>;
    /**
     * Dynamically registers an agent type and its constructor with the factory.
     *
     * @throws {AgentFactoryError} If `agentType` or `constructor` is invalid.
     */
    registerAgentClass(agentType: string, constructor: AgentClassConstructor<any>): Promise<void>;
    /**
     * Retrieves and initializes an agent instance by its ID.
     *
     * @throws {AgentFactoryError} If critical errors occur during instantiation.
     */
    getAgent(agentId: string, dependencies: AgentDependencies): Promise<IAgent | undefined>;
    /**
     * Lists all agent configurations known to the factory.
     *
     * Returns deep copies of the configurations to prevent external modification.
     */
    listAvailableAgentConfigs(): Promise<Readonly<AgentConfig[]>>;
}
//# sourceMappingURL=AgentFactory.d.ts.map
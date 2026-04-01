/**
 * @fileoverview Implements the ToolOrchestrator class, which serves as the central
 * hub for managing, discovering, authorizing, and orchestrating the execution of tools
 * within the AgentOS system.
 *
 * The ToolOrchestrator acts as a facade over the `ToolPermissionManager` and `ToolExecutor`.
 * It provides a unified and simplified interface for higher-level components, such as GMIs
 * (Generalized Mind Instances) or the main AgentOS orchestrator, to interact with the tool ecosystem.
 *
 * Key Responsibilities:
 * - Tool Registration: Manages an internal registry of available `ITool` instances.
 * - Tool Discovery: Provides methods like `listAvailableTools()` to get tool definitions
 * suitable for LLM consumption (e.g., for function calling).
 * - Permission Enforcement: Collaborates with `IToolPermissionManager` to authorize tool calls
 * based on Persona capabilities, user subscriptions, or other defined policies.
 * - Execution Delegation: Delegates the actual tool execution (including argument validation)
 * to the `ToolExecutor`.
 * - Result Formatting: Standardizes and returns tool execution results (`ToolCallResult` for GMIs).
 * - Lifecycle Management: Handles initialization and shutdown of itself and potentially registered tools.
 *
 * @module backend/agentos/core/tools/ToolOrchestrator
 * @see ./IToolOrchestrator.ts for the interface definition.
 * @see ./ITool.ts for the core tool contract and related types like ToolExecutionResult.
 * @see ./IToolPermissionManager.ts for permission management logic and related types.
 * @see ./ToolExecutor.ts for the component that directly executes tools.
 * @see ../../config/ToolOrchestratorConfig.ts for configuration options.
 * @see ../../cognitive_substrate/IGMI.ts for GMI-related types like ToolCallRequest, ToolCallResult, UserContext.
 */
import { IToolOrchestrator, ToolDefinitionForLLM } from './IToolOrchestrator';
import { ITool } from './ITool';
import { IToolPermissionManager } from './permissions/IToolPermissionManager';
import { ToolExecutor, ToolExecutionRequestDetails } from './ToolExecutor';
import { ToolOrchestratorConfig } from '../../config/ToolOrchestratorConfig';
import { ToolCallResult, UserContext } from '../../cognitive_substrate/IGMI';
import type { IHumanInteractionManager } from '../../orchestration/hitl/IHumanInteractionManager';
import type { EmergentConfig, EmergentTool } from '../../emergent/types.js';
import { EmergentCapabilityEngine } from '../../emergent/EmergentCapabilityEngine.js';
import type { IStorageAdapter as EmergentStorageAdapter } from '../../emergent/EmergentToolRegistry.js';
import type { SelfImprovementToolDeps } from '../../emergent/EmergentCapabilityEngine.js';
/**
 * @class ToolOrchestrator
 * @implements {IToolOrchestrator}
 * @description The central component responsible for the comprehensive management of tools.
 * It orchestrates their registration, discovery, permission-based authorization, and execution,
 * acting as a crucial facade for higher-level system components like GMIs.
 */
export declare class ToolOrchestrator implements IToolOrchestrator {
    /**
     * A unique identifier for this ToolOrchestrator instance, useful for logging and telemetry.
     * @public
     * @readonly
     * @type {string}
     */
    readonly orchestratorId: string;
    /**
     * Holds the resolved configuration for this orchestrator instance, merging defaults with user-provided settings.
     * @private
     * @type {Readonly<Required<ToolOrchestratorConfig>>}
     */
    private config;
    /**
     * An instance of the permission manager used to authorize tool calls.
     * @private
     * @type {IToolPermissionManager}
     */
    private permissionManager;
    /**
     * An instance of the tool executor responsible for the actual invocation of tool logic.
     * @private
     * @type {ToolExecutor}
     */
    private toolExecutor;
    /**
     * Optional human-in-the-loop manager used to gate risky tool executions.
     */
    private hitlManager?;
    /**
     * The emergent capability engine instance, created when `emergent: true`.
     * Manages runtime tool creation via the forge pipeline.
     * @private
     */
    private emergentEngine?;
    private emergentDiscoveryIndexer?;
    /**
     * A flag indicating whether the orchestrator has been successfully initialized and is ready for operation.
     * @private
     * @type {boolean}
     */
    private isInitialized;
    /**
     * Default configuration values for the ToolOrchestrator.
     * These are applied if specific values are not provided during initialization, ensuring robust default behavior.
     * @private
     * @static
     * @readonly
     */
    private static readonly DEFAULT_CONFIG;
    /**
     * Constructs a ToolOrchestrator instance.
     * The orchestrator is not operational until the `initialize` method has been successfully called.
     * An `orchestratorId` is generated upon construction.
     */
    constructor();
    /**
     * @inheritdoc
     */
    initialize(config: ToolOrchestratorConfig | undefined, // Can be undefined
    permissionManager: IToolPermissionManager, toolExecutor: ToolExecutor, initialTools?: ITool[], hitlManager?: IHumanInteractionManager, emergentOptions?: {
        /** Enable emergent capability creation. */
        enabled: boolean;
        /** Partial emergent config to merge with defaults. */
        config?: Partial<EmergentConfig>;
        /**
         * LLM text generation callback for the EmergentJudge.
         * When omitted the judge rejects all tools (safe fallback).
         */
        generateText?: (model: string, prompt: string) => Promise<string>;
        /** Optional persistent storage adapter for the emergent registry. */
        storageAdapter?: EmergentStorageAdapter;
        /**
         * Runtime hooks for the self-improvement tools (adapt_personality,
         * manage_skills, create_workflow, self_evaluate).
         *
         * Only used when `config.selfImprovement.enabled` is `true`.
         * When omitted and self-improvement is enabled, the engine still
         * attempts tool creation but any deps-dependent tools are skipped.
         */
        selfImprovementDeps?: SelfImprovementToolDeps;
    }): Promise<void>;
    private registerInitialTool;
    private classifySideEffectCategory;
    /**
     * Ensures the ToolOrchestrator instance has been initialized before allowing operations.
     * @private
     * @throws {GMIError} if the orchestrator is not initialized (`GMIErrorCode.NOT_INITIALIZED`).
     */
    private ensureInitialized;
    /**
     * @inheritdoc
     */
    registerTool(tool: ITool): Promise<void>;
    /**
     * @inheritdoc
     */
    unregisterTool(toolName: string): Promise<boolean>;
    /**
     * @inheritdoc
     */
    getTool(toolName: string): Promise<ITool | undefined>;
    /**
     * @inheritdoc
     */
    listAvailableTools(context?: {
        personaId?: string;
        personaCapabilities?: string[];
        userContext?: UserContext;
    }): Promise<ToolDefinitionForLLM[]>;
    /**
     * Lists only the tools that appear in a CapabilityDiscoveryResult.
     * Filters the full tool registry to only include tools whose names
     * match capabilities in the Tier 1 or Tier 2 results.
     *
     * This dramatically reduces the tool list sent to the LLM,
     * preventing context rot from unused tool schemas.
     */
    listDiscoveredTools(discoveryResult: import('../../discovery/types').CapabilityDiscoveryResult, context?: {
        personaId?: string;
        personaCapabilities?: string[];
        userContext?: UserContext;
    }): Promise<ToolDefinitionForLLM[]>;
    /**
     * @inheritdoc
     */
    processToolCall(requestDetails: ToolExecutionRequestDetails): Promise<ToolCallResult>;
    /**
     * Returns the underlying emergent capability engine instance, or
     * `undefined` if emergent capabilities were not enabled at initialization.
     *
     * Callers can use this to access engine methods like `getSessionTools()`,
     * `getAgentTools()`, or `checkPromotion()` that are not exposed through
     * the orchestrator's own API.
     *
     * @returns The engine instance, or `undefined`.
     */
    getEmergentEngine(): EmergentCapabilityEngine | undefined;
    /**
     * Clean up all emergent session-scoped tools for a given session.
     *
     * Delegates to the emergent engine's `cleanupSession()` method. This should
     * be called when a conversation/session ends to free session-tier tools.
     *
     * No-op if emergent capabilities are not enabled.
     *
     * @param sessionId - The session identifier to clean up.
     */
    cleanupEmergentSession(sessionId: string): void;
    /**
     * Register a dynamically forged emergent tool with the orchestrator so the
     * agent can use it in subsequent turns within the same session.
     *
     * This is the bridge between the emergent capability engine (which
     * stores tool metadata) and the `ToolOrchestrator` (which the LLM
     * tool-call pipeline queries). After forge_tool produces a new tool, call
     * this method to make it appear in `listAvailableTools()`.
     *
     * @param tool - An `ITool` instance wrapping the emergent tool.
     */
    registerForgedTool(tool: ITool): Promise<void>;
    setEmergentDiscoveryIndexer(indexer: (tools: EmergentTool[]) => Promise<void>): void;
    /**
     * Dynamically load an extension at runtime and register its tools.
     *
     * Used by the discovery engine when the agent encounters a request
     * outside its loaded toolset. The extension is loaded for the current
     * session only — it does not persist to config.
     *
     * @param extensionId - The extension ID from the tool catalog (e.g., 'omdb').
     * @returns The names of newly registered tools, or empty array on failure.
     */
    loadExtensionAtRuntime(extensionId: string): Promise<string[]>;
    /**
     * @inheritdoc
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * Shuts down all registered tools that implement the `shutdown` method.
     * Prefers using `ToolExecutor.shutdownAllTools()` if available.
     * @private
     * @async
     */
    private shutdownRegisteredTools;
    /**
     * @inheritdoc
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=ToolOrchestrator.d.ts.map
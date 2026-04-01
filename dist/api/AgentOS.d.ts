/**
 * @file AgentOS.ts
 * @module backend/agentos/api/AgentOS
 * @version 1.1.0
 *
 * @description
 * This file implements the primary public-facing service facade for the AgentOS platform,
 * the `AgentOS` class. It acts as the unified entry point for all high-level interactions
 * with the AI agent ecosystem. The `AgentOS` class orchestrates operations by delegating
 * to specialized managers and services such as `AgentOSOrchestrator`, `GMIManager`,
 * `StreamingManager`, and others.
 *
 * The architecture emphasizes:
 * - **Interface-Driven Design:** `AgentOS` implements the `IAgentOS` interface, ensuring
 * a clear contract for its consumers.
 * - **Robust Initialization:** A comprehensive initialization sequence configures all core
 * components and dependencies.
 * - **Streaming-First Operations:** Core interaction methods (`processRequest`, `handleToolResult`)
 * are designed as asynchronous generators, enabling real-time, chunked data flow.
 * - **Structured Error Handling:** Custom error types (`AgentOSServiceError`) derived from
 * a base `GMIError` provide detailed and context-aware error reporting.
 * - **Comprehensive Configuration:** The system's behavior is managed through a detailed
 * `AgentOSConfig` object.
 *
 * Key responsibilities of this module include:
 * - Managing the lifecycle of the AgentOS service.
 * - Providing methods for initiating chat turns, handling tool results, listing personas,
 * retrieving conversation history, and processing user feedback.
 * - Bridging the gap between high-level API calls and the underlying orchestration and
 * cognitive processing layers.
 * - Ensuring adherence to TypeScript best practices, including strict type safety,
 * comprehensive JSDoc documentation, and robust error management.
 *
 * @see {@link IAgentOS} for the public interface contract.
 * @see {@link AgentOSOrchestrator} for the orchestration logic.
 * @see {@link GMIManager} for GMI lifecycle management.
 * See `StreamingManager` for real-time data streaming internals.
 * See `@framers/agentos/utils/errors` for shared error definitions.
 */
import { IAgentOS } from './interfaces/IAgentOS';
import { AgentOSInput, UserFeedbackPayload } from './types/AgentOSInput';
import type { AgentOSPendingExternalToolRequest, AgentOSResumeExternalToolRequestOptions } from './types/AgentOSExternalToolRequest';
import type { AgentOSToolResultInput } from './types/AgentOSToolResult';
import { AgentOSResponse } from './types/AgentOSResponse';
import { type AgentOSOrchestratorConfig, type ITaskOutcomeTelemetryStore } from './runtime/AgentOSOrchestrator';
import { GMIManager, GMIManagerConfig } from '../cognitive_substrate/GMIManager';
import { AIModelProviderManager, AIModelProviderManagerConfig } from '../core/llm/providers/AIModelProviderManager';
import { PromptEngineConfig, IPromptEngineUtilityAI } from '../core/llm/IPromptEngine';
import { IToolOrchestrator, type ToolDefinitionForLLM } from '../core/tools/IToolOrchestrator';
import { ToolOrchestratorConfig } from '../core/config/ToolOrchestratorConfig';
import { ToolPermissionManagerConfig } from '../core/tools/permissions/IToolPermissionManager';
import type { IAuthService, ISubscriptionService } from '../types/auth';
import type { IHumanInteractionManager } from '../orchestration/hitl/IHumanInteractionManager';
import { IUtilityAI } from '../nlp/ai_utilities/IUtilityAI';
import { ConversationManager, ConversationManagerConfig } from '../core/conversation/ConversationManager';
import { ConversationContext } from '../core/conversation/ConversationContext';
import type { IRollingSummaryMemorySink } from '../core/conversation/IRollingSummaryMemorySink';
import type { ILongTermMemoryRetriever } from '../core/conversation/ILongTermMemoryRetriever';
import type { IRetrievalAugmentor } from '../rag/IRetrievalAugmentor';
import type { EmbeddingManagerConfig } from '../config/EmbeddingManagerConfiguration';
import type { RetrievalAugmentorServiceConfig } from '../config/RetrievalAugmentorConfiguration';
import type { RagDataSourceConfig, VectorStoreManagerConfig } from '../config/VectorStoreConfiguration';
import type { PrismaClient } from '../core/storage/prismaClient.js';
import type { StorageAdapter } from '@framers/sql-storage-adapter';
import { IPersonaDefinition } from '../cognitive_substrate/personas/IPersonaDefinition';
import { StreamingManagerConfig, StreamId } from '../core/streaming/StreamingManager';
import { ILogger } from '../logging/ILogger';
import { type AgentOSObservabilityConfig } from '../evaluation/observability/otel';
import type { IGuardrailService } from '../safety/guardrails/IGuardrailService';
import type { EmergentConfig } from '../emergent/types.js';
import type { IPersonaLoader } from '../cognitive_substrate/personas/IPersonaLoader';
import { ExtensionManager, type ExtensionManifest, type ExtensionOverrides } from '../extensions';
import type { MemoryToolsExtensionOptions } from '../memory/io/extension/MemoryToolsExtension.js';
import type { Memory } from '../memory/io/facade/Memory.js';
import type { StandaloneMemoryLongTermRetrieverOptions, StandaloneMemoryRollingSummarySinkOptions } from '../memory/io/integration/StandaloneMemoryBridge.js';
import { type ExternalToolRegistry } from './runtime/externalToolRegistry';
import { type AdaptableToolInput } from './runtime/toolAdapter';
import type { TurnPlannerConfig } from '../orchestration/turn-planner/TurnPlanner';
import type { CapabilityDescriptor, CapabilityDiscoveryConfig, CapabilityIndexSources, ICapabilityDiscoveryEngine, PresetCoOccurrence } from '../discovery/types';
import type { WorkflowEngineConfig } from '../orchestration/workflows/IWorkflowEngine';
import type { WorkflowDefinition, WorkflowInstance, WorkflowProgressUpdate, WorkflowStatus } from '../orchestration/workflows/WorkflowTypes';
import type { IWorkflowStore, WorkflowQueryOptions, WorkflowTaskUpdate } from '../orchestration/workflows/storage/IWorkflowStore';
export { AgentOSServiceError } from './errors';
export interface AgentOSCapabilityDiscoverySources {
    skills?: CapabilityIndexSources['skills'];
    extensions?: CapabilityIndexSources['extensions'];
    channels?: CapabilityIndexSources['channels'];
    manifests?: CapabilityDescriptor[];
    presetCoOccurrences?: PresetCoOccurrence[];
}
export interface AgentOSTurnPlanningConfig extends TurnPlannerConfig {
    discovery?: NonNullable<TurnPlannerConfig['discovery']> & {
        /**
         * Optional pre-built discovery engine. If provided, AgentOS uses this and
         * skips auto-initialization.
         */
        engine?: ICapabilityDiscoveryEngine;
        /**
         * When true, AgentOS automatically creates a capability discovery engine
         * using active tools/extensions/channels.
         */
        autoInitializeEngine?: boolean;
        /**
         * Register the `discover_capabilities` meta-tool after engine initialization.
         */
        registerMetaTool?: boolean;
        /**
         * Optional override for discovery embedding model.
         */
        embeddingModelId?: string;
        /**
         * Optional embedding dimension override.
         */
        embeddingDimension?: number;
        /**
         * Optional low-level discovery engine tuning.
         */
        config?: Partial<CapabilityDiscoveryConfig>;
        /**
         * Optional explicit capability sources to merge with runtime-derived sources.
         */
        sources?: AgentOSCapabilityDiscoverySources;
    };
}
export interface AgentOSMemoryToolsConfig extends MemoryToolsExtensionOptions {
    /**
     * Enable or disable automatic memory-tool registration.
     * Default: true when this block is provided.
     */
    enabled?: boolean;
    /**
     * Standalone memory backend whose `createTools()` output should be exposed
     * through the shared AgentOS tool registry.
     */
    memory: Pick<Memory, 'createTools'> & Partial<Pick<Memory, 'close'>>;
    /**
     * If true, AgentOS will call `memory.close()` during shutdown via the loaded
     * extension pack's deactivation hook.
     * Default: false (caller manages lifecycle).
     */
    manageLifecycle?: boolean;
    /**
     * Optional extension-pack identifier override.
     * @default 'config-memory-tools'
     */
    identifier?: string;
}
export interface AgentOSStandaloneMemoryConfig {
    /**
     * Enable or disable standalone-memory integration.
     * Default: true when this block is provided.
     */
    enabled?: boolean;
    /**
     * Standalone memory backend used to derive one or more AgentOS integrations.
     */
    memory: Pick<Memory, 'remember' | 'recall' | 'forget'> & Partial<Pick<Memory, 'createTools' | 'health' | 'close'>>;
    /**
     * If true, AgentOS closes the standalone memory backend during shutdown
     * unless `memoryTools.manageLifecycle` already owns that lifecycle.
     * Default: false.
     */
    manageLifecycle?: boolean;
    /**
     * When provided, AgentOS derives `memoryTools` from this standalone memory
     * backend unless `memoryTools` was already supplied explicitly.
     */
    tools?: boolean | Omit<AgentOSMemoryToolsConfig, 'memory' | 'enabled' | 'manageLifecycle'>;
    /**
     * When provided, AgentOS derives `longTermMemoryRetriever` from this
     * standalone memory backend unless one was already supplied explicitly.
     */
    longTermRetriever?: boolean | StandaloneMemoryLongTermRetrieverOptions;
    /**
     * When provided, AgentOS derives `rollingSummaryMemorySink` from this
     * standalone memory backend unless one was already supplied explicitly.
     */
    rollingSummarySink?: boolean | StandaloneMemoryRollingSummarySinkOptions;
}
/**
 * @interface AgentOSConfig
 * @description Defines the comprehensive configuration structure required to initialize and operate
 * the `AgentOS` service. This configuration object aggregates settings for all major
 * sub-components and dependencies of the AgentOS platform.
 */
export interface AgentOSConfig {
    /** Configuration for the {@link GMIManager}. */
    gmiManagerConfig: GMIManagerConfig;
    /** Configuration for the {@link AgentOSOrchestrator}. */
    orchestratorConfig: AgentOSOrchestratorConfig;
    /**
     * Optional sink for persisting rolling-memory outputs (`summary_markdown` + `memory_json`)
     * into an external long-term store (RAG / knowledge graph / database).
     */
    rollingSummaryMemorySink?: IRollingSummaryMemorySink;
    /**
     * Optional retriever for injecting durable long-term memory context into prompts
     * (e.g. user/org/persona memories stored in a RAG/KG).
     */
    longTermMemoryRetriever?: ILongTermMemoryRetriever;
    /**
     * Optional persistence store for task outcome KPI windows.
     * When provided, rolling task-outcome telemetry survives orchestrator restarts.
     */
    taskOutcomeTelemetryStore?: ITaskOutcomeTelemetryStore;
    /**
     * Optional retrieval augmentor enabling vector-based RAG and/or GraphRAG.
     * When provided, it is passed into GMIs via the GMIManager.
     *
     * Notes:
     * - This is separate from `longTermMemoryRetriever`, which injects pre-formatted
     *   memory text into prompts.
     * - The augmentor instance is typically shared across GMIs; do not shut it down
     *   from individual GMIs.
     */
    retrievalAugmentor?: IRetrievalAugmentor;
    /**
     * If true, AgentOS will call `retrievalAugmentor.shutdown()` during `AgentOS.shutdown()`.
     * Default: false (caller manages lifecycle).
     */
    manageRetrievalAugmentorLifecycle?: boolean;
    /**
     * Optional configuration for AgentOS-managed RAG subsystem initialization.
     *
     * When provided and enabled, AgentOS will:
     * - Initialize an `EmbeddingManager` with `EmbeddingManagerConfig`
     * - Initialize a `VectorStoreManager` with `VectorStoreManagerConfig` and `RagDataSourceConfig`
     * - Initialize a `RetrievalAugmentor` with `RetrievalAugmentorServiceConfig`
     * - Pass the resulting {@link IRetrievalAugmentor} into GMIs via the {@link GMIManager}
     *
     * Notes:
     * - If `retrievalAugmentor` is provided, it takes precedence and this config is ignored.
     * - By default, when AgentOS creates the RAG subsystem it also manages lifecycle and will
     *   shut it down during {@link AgentOS.shutdown}.
     */
    ragConfig?: {
        /** Enable or disable AgentOS-managed RAG initialization. Default: true. */
        enabled?: boolean;
        /** Embedding manager configuration (must include at least one embedding model). */
        embeddingManagerConfig: EmbeddingManagerConfig;
        /** Vector store manager configuration (providers). */
        vectorStoreManagerConfig: VectorStoreManagerConfig;
        /** Logical data sources mapped onto vector store providers. */
        dataSourceConfigs: RagDataSourceConfig[];
        /** Retrieval augmentor configuration (category behaviors, defaults). */
        retrievalAugmentorConfig: RetrievalAugmentorServiceConfig;
        /**
         * If true, AgentOS will shut down the augmentor and any owned vector store providers
         * during {@link AgentOS.shutdown}. Default: true.
         */
        manageLifecycle?: boolean;
        /**
         * When true (default), AgentOS injects its `storageAdapter` into SQL vector-store providers
         * that did not specify `adapter` or `storage`. This keeps vector persistence colocated with
         * the host database by default.
         */
        bindToStorageAdapter?: boolean;
    };
    /** Configuration for the prompt engine. */
    promptEngineConfig: PromptEngineConfig;
    /** Configuration for the tool orchestrator. */
    toolOrchestratorConfig: ToolOrchestratorConfig;
    /** Optional human-in-the-loop manager for approvals/clarifications. */
    hitlManager?: IHumanInteractionManager;
    /** Configuration for the tool permission manager. */
    toolPermissionManagerConfig: ToolPermissionManagerConfig;
    /** Configuration for the {@link ConversationManager}. */
    conversationManagerConfig: ConversationManagerConfig;
    /** Configuration for the internal streaming manager. */
    streamingManagerConfig: StreamingManagerConfig;
    /** Configuration for the {@link AIModelProviderManager}. */
    modelProviderManagerConfig: AIModelProviderManagerConfig;
    /** The default Persona ID to use if none is specified in an interaction. */
    defaultPersonaId: string;
    /** An instance of the Prisma client for database interactions.
     *
     * **Optional when `storageAdapter` is provided:**
     * - If `storageAdapter` is provided, Prisma is only used for server-side features (auth, subscriptions).
     * - If `storageAdapter` is omitted, Prisma is required for all database operations.
     *
     * **Client-side usage:**
     * ```typescript
     * const storage = await createAgentOSStorage({ platform: 'web' });
     * await agentos.initialize({
     *   storageAdapter: storage.getAdapter(),
     *   prisma: mockPrisma,  // Stub for compatibility (can be minimal mock)
     *   // ...
     * });
     * ```
     */
    prisma: PrismaClient;
    /** Optional authentication service implementing `IAuthService`. Provide via the auth extension or your own adapter. */
    authService?: IAuthService;
    /** Optional subscription service implementing `ISubscriptionService`. Provide via the auth extension or your own adapter. */
    subscriptionService?: ISubscriptionService;
    /** Optional guardrail service implementation used for policy enforcement. */
    guardrailService?: IGuardrailService;
    /** Optional map of secretId -> value for extension/tool credentials. */
    extensionSecrets?: Record<string, string>;
    /**
     * Optional standalone-memory tool registration.
     *
     * When provided, AgentOS will load the standalone memory editor tools as an
     * extension pack during initialization, making them immediately available to
     * the shared `ToolExecutor`/`ToolOrchestrator`.
     */
    memoryTools?: AgentOSMemoryToolsConfig;
    /**
     * Optional unified standalone-memory bridge.
     *
     * This derives one or more AgentOS integrations from a single standalone
     * `Memory` instance:
     * - memory tools
     * - long-term memory retriever
     * - rolling-summary sink
     */
    standaloneMemory?: AgentOSStandaloneMemoryConfig;
    /**
     * Optional runtime-level registered tools.
     *
     * These tools are normalized during initialization and registered into the
     * shared `ToolOrchestrator`, making them directly available to `processRequest()`
     * and other full-runtime flows without helper wrappers.
     *
     * Accepts:
     * - a named high-level tool map
     * - an `ExternalToolRegistry` (`Record`, `Map`, or iterable)
     * - a prompt-only `ToolDefinitionForLLM[]`
     */
    tools?: AdaptableToolInput;
    /**
     * Optional stable registry of host-managed external tools.
     *
     * This is the runtime-level default for helper APIs such as
     * `processRequestWithRegisteredTools(...)` and
     * `resumeExternalToolRequestWithRegisteredTools(...)`.
     *
     * Per-call `externalTools` passed into those helpers override entries from
     * this configured registry by tool name.
     */
    externalTools?: ExternalToolRegistry;
    /**
     * Optional: enable schema-on-demand meta tools for lazy tool schema loading.
     *
     * When enabled, AgentOS registers three meta tools:
     * - `extensions_list`
     * - `extensions_enable` (side effects)
     * - `extensions_status`
     *
     * These tools allow an agent to load additional extension packs at runtime,
     * so newly-enabled tool schemas appear in the next `listAvailableTools()` call.
     */
    schemaOnDemandTools?: {
        enabled?: boolean;
        /**
         * Allow enabling packs by explicit npm package name (source='package').
         * Default: true in non-production, false in production.
         */
        allowPackages?: boolean;
        /** Allow enabling packs by local module specifier/path (source='module'). Default: false. */
        allowModules?: boolean;
        /**
         * When true, only allow extension packs present in the official
         * `@framers/agentos-extensions-registry` catalog (if installed).
         *
         * Default: true.
         */
        officialRegistryOnly?: boolean;
    };
    /**
     * Optional per-turn planning configuration.
     * Defaults:
     * - `defaultToolFailureMode = fail_open`
     * - discovery-driven tool selection enabled when discovery is available.
     */
    turnPlanning?: AgentOSTurnPlanningConfig;
    /**
     * Optional. An instance of a utility AI service.
     * This service should conform to `IUtilityAI` for general utility tasks.
     * If the prompt engine is used and requires specific utility functions (like advanced
     * summarization for prompt construction), this service *must* also fulfill the contract
     * of {@link IPromptEngineUtilityAI}.
     * It's recommended that the concrete class for this service implements both interfaces if needed.
     */
    utilityAIService?: IUtilityAI & IPromptEngineUtilityAI;
    /** Optional extension manifest describing packs to load. */
    extensionManifest?: ExtensionManifest;
    /** Declarative overrides applied after packs are loaded. */
    extensionOverrides?: ExtensionOverrides;
    /**
     * Optional registry configuration for loading extensions and personas from custom sources.
     * Allows self-hosted registries and custom git repositories.
     *
     * @example
     * ```typescript
     * registryConfig: {
     *   registries: {
     *     'extensions': {
     *       type: 'github',
     *       location: 'your-org/your-extensions',
     *       branch: 'main',
     *     },
     *     'personas': {
     *       type: 'github',
     *       location: 'your-org/your-personas',
     *       branch: 'main',
     *     }
     *   },
     *   defaultRegistries: {
     *     tool: 'extensions',
     *     persona: 'personas',
     *   }
     * }
     * ```
     */
    registryConfig?: import('../extensions/RegistryConfig').MultiRegistryConfig;
    /** Optional workflow engine configuration. */
    workflowEngineConfig?: WorkflowEngineConfig;
    /** Optional workflow store implementation. Defaults to the in-memory store if omitted. */
    workflowStore?: IWorkflowStore;
    /** Optional multilingual configuration enabling detection, negotiation, translation. */
    languageConfig?: import('../nlp/language').AgentOSLanguageConfig;
    /** Optional custom persona loader (useful for browser/local runtimes). */
    personaLoader?: IPersonaLoader;
    /**
     * Optional cross-platform storage adapter for client-side persistence.
     * Enables fully offline AgentOS in browsers (IndexedDB), desktop (SQLite), mobile (Capacitor).
     *
     * **Platform Support:**
     * - Web: IndexedDB (recommended) or sql.js
     * - Electron: better-sqlite3 (native) or sql.js (fallback)
     * - Capacitor: @capacitor-community/sqlite (native) or IndexedDB
     * - Node: better-sqlite3 or PostgreSQL
     *
     * **Usage:**
     * ```typescript
     * import { createAgentOSStorage } from '@framers/sql-storage-adapter/agentos';
     *
     * const storage = await createAgentOSStorage({ platform: 'auto' });
     *
     * await agentos.initialize({
     *   storageAdapter: storage.getAdapter(),
     *   // ... other config
     * });
     * ```
     *
     * **Graceful Degradation:**
     * - If omitted, AgentOS falls back to Prisma (server-side only).
     * - If provided, AgentOS uses storageAdapter for conversations, Prisma only for auth/subscriptions.
     * - Recommended: Always provide storageAdapter for cross-platform compatibility.
     */
    storageAdapter?: StorageAdapter;
    /**
     * Enable emergent capability creation. When true, the agent gains access
     * to the `forge_tool` meta-tool and can create new tools at runtime.
     * @default false
     */
    emergent?: boolean;
    /**
     * Configuration for the emergent capability engine.
     * Only applies when `emergent: true`.
     */
    emergentConfig?: Partial<EmergentConfig>;
    /**
     * Optional observability config for tracing, metrics, and log correlation.
     * Default: disabled (opt-in).
     */
    observability?: AgentOSObservabilityConfig;
}
export interface AgentOSActiveConversationSnapshot {
    sessionId: string;
    userId?: string;
    gmiInstanceId?: string;
    activePersonaId?: string;
    createdAt: number;
    lastActiveAt?: number;
    messageCount: number;
}
export interface AgentOSActiveGMISnapshot {
    gmiId: string;
    personaId: string;
    state: string;
    createdAt: string;
    hasCognitiveMemory: boolean;
    reasoningTraceEntries: number;
    workingMemoryKeys: number;
    cognitiveMemory?: {
        totalTraces: number;
        activeTraces: number;
        workingMemorySlots: number;
        workingMemoryCapacity: number;
        prospectiveCount: number;
    };
}
export interface AgentOSRuntimeSnapshot {
    initialized: boolean;
    services: {
        conversationManager: boolean;
        extensionManager: boolean;
        toolOrchestrator: boolean;
        modelProviderManager: boolean;
        retrievalAugmentor: boolean;
        workflowEngine: boolean;
    };
    providers: {
        configured: string[];
        defaultProvider?: string | null;
    };
    extensions: {
        loadedPacks: string[];
        toolCount: number;
        workflowCount: number;
        guardrailCount: number;
    };
    conversations: {
        activeCount: number;
        items: AgentOSActiveConversationSnapshot[];
    };
    gmis: {
        activeCount: number;
        items: AgentOSActiveGMISnapshot[];
    };
}
/**
 * @class AgentOS
 * @implements {IAgentOS}
 * @description
 * The `AgentOS` class is the SOTA public-facing service facade for the entire AI agent platform.
 * It provides a unified API for interacting with the system, managing the lifecycle of core
 * components, and orchestrating complex AI interactions. This class ensures that all
 * operations adhere to the defined architectural tenets, including robust error handling,
 * comprehensive documentation, and strict type safety.
 */
export declare class AgentOS implements IAgentOS {
    private readonly logger;
    private initialized;
    private config;
    private selfImprovementManager;
    private modelProviderManager;
    private utilityAIService;
    private promptEngine;
    private toolPermissionManager;
    private toolExecutor;
    private toolOrchestrator;
    private extensionManager;
    private conversationManager;
    private streamingManager;
    private gmiManager;
    private agentOSOrchestrator;
    private languageService?;
    private guardrailService?;
    private workflowFacade?;
    private discoveryInitializer?;
    private ragMemoryInitializer;
    private authService?;
    private subscriptionService?;
    private prisma;
    /**
     * Constructs an `AgentOS` instance. The instance is not operational until
     * `initialize()` is called and successfully completes.
     */
    constructor(logger?: ILogger);
    /**
     * Initializes the `AgentOS` service and all its core dependencies.
     * This method must be called and successfully awaited before any other operations
     * can be performed on the `AgentOS` instance. It sets up configurations,
     * instantiates managers, and prepares the system for operation.
     *
     * @public
     * @async
     * @param {AgentOSConfig} config - The comprehensive configuration object for AgentOS.
     * @returns {Promise<void>} A promise that resolves when initialization is complete.
     * @throws {AgentOSServiceError} If configuration validation fails or if any critical
     * dependency fails to initialize.
     */
    initialize(config: AgentOSConfig): Promise<void>;
    /**
     * Validates the provided `AgentOSConfig` to ensure all mandatory sub-configurations
     * and dependencies are present.
     *
     * @private
     * @param {AgentOSConfig} config - The configuration object to validate.
     * @throws {AgentOSServiceError} If any required configuration parameter is missing,
     * with `code` set to `GMIErrorCode.CONFIGURATION_ERROR`.
     */
    private validateConfiguration;
    private registerConfigGuardrailService;
    private getActiveGuardrailServices;
    private ensureUtilityAIService;
    private buildDefaultUtilityAI;
    /**
     * Ensures that the `AgentOS` service has been successfully initialized before
     * attempting to perform any operations.
     *
     * @private
     * @throws {AgentOSServiceError} If the service is not initialized, with `code`
     * set to `GMIErrorCode.NOT_INITIALIZED`.
     */
    private ensureInitialized;
    getRuntimeSnapshot(): Promise<AgentOSRuntimeSnapshot>;
    getConversationManager(): ConversationManager;
    getGMIManager(): GMIManager;
    getExtensionManager(): ExtensionManager;
    getToolOrchestrator(): IToolOrchestrator;
    getExternalToolRegistry(): ExternalToolRegistry | undefined;
    listExternalToolsForLLM(): ToolDefinitionForLLM[];
    getModelProviderManager(): AIModelProviderManager;
    /**
     * Processes a single interaction turn with an AI agent. This is an asynchronous generator
     * that yields {@link AgentOSResponse} chunks as they become available.
     *
     * This method orchestrates:
     * 1. Retrieval or creation of a {@link StreamId} via the {@link AgentOSOrchestrator}.
     * 2. Registration of a temporary, request-scoped stream client to the internal streaming manager.
     * 3. Yielding of {@link AgentOSResponse} chunks received by this client.
     * 4. Ensuring the temporary client is deregistered upon completion or error.
     *
     * The underlying {@link AgentOSOrchestrator} handles the GMI interaction and pushes
     * chunks to the internal streaming manager. This method acts as the bridge to make these
     * chunks available as an `AsyncGenerator` to the caller (e.g., an API route handler).
     *
     * @public
     * @async
     * @generator
     * @param {AgentOSInput} input - The comprehensive input for the current interaction turn.
     * @yields {AgentOSResponse} Chunks of the agent's response as they are processed.
     * @returns {AsyncGenerator<AgentOSResponse, void, undefined>} An asynchronous generator
     * that yields response chunks. The generator completes when the interaction is finalized
     * or a terminal error occurs.
     * @throws {AgentOSServiceError} If a critical error occurs during setup or if the
     * service is not initialized. Errors during GMI processing are typically yielded as
     * `AgentOSErrorChunk`s.
     */
    processRequest(input: AgentOSInput): AsyncGenerator<AgentOSResponse, void, undefined>;
    /**
     * Handles the result of an externally executed tool and continues the agent interaction.
     * This method is an asynchronous generator that yields new {@link AgentOSResponse} chunks
     * resulting from the GMI processing the tool's output.
     *
     * It functions similarly to `processRequest` by:
     * 1. Delegating to {@link AgentOSOrchestrator.orchestrateToolResult}, which pushes new
     * chunks to the *existing* `streamId`.
     * 2. Registering a temporary, request-scoped stream client (bridge) to this `streamId`.
     * 3. Yielding {@link AgentOSResponse} chunks received by this bridge.
     * 4. Ensuring the bridge client is deregistered.
     *
     * @public
     * @async
     * @generator
     * @param {StreamId} streamId - The ID of the existing stream to which the tool result pertains.
     * @param {string} toolCallId - The ID of the specific tool call being responded to.
     * @param {string} toolName - The name of the tool that was executed.
     * @param {any} toolOutput - The output data from the tool execution.
     * @param {boolean} isSuccess - Indicates whether the tool execution was successful.
     * @param {string} [errorMessage] - An error message if `isSuccess` is `false`.
     * @yields {AgentOSResponse} New response chunks from the agent after processing the tool result.
     * @returns {AsyncGenerator<AgentOSResponse, void, undefined>} An asynchronous generator for new response chunks.
     * @throws {AgentOSServiceError} If a critical error occurs during setup or if the service is not initialized.
     * Errors during GMI processing are yielded as `AgentOSErrorChunk`s.
     */
    handleToolResult(streamId: StreamId, toolCallId: string, toolName: string, toolOutput: any, isSuccess: boolean, errorMessage?: string): AsyncGenerator<AgentOSResponse, void, undefined>;
    handleToolResults(streamId: StreamId, toolResults: AgentOSToolResultInput[]): AsyncGenerator<AgentOSResponse, void, undefined>;
    listWorkflowDefinitions(): WorkflowDefinition[];
    startWorkflow(definitionId: string, input: AgentOSInput, options?: {
        workflowId?: string;
        conversationId?: string;
        createdByUserId?: string;
        context?: Record<string, unknown>;
        roleAssignments?: Record<string, string>;
        metadata?: Record<string, unknown>;
    }): Promise<WorkflowInstance>;
    getWorkflow(workflowId: string): Promise<WorkflowInstance | null>;
    listWorkflows(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]>;
    getWorkflowProgress(workflowId: string, sinceTimestamp?: string): Promise<WorkflowProgressUpdate | null>;
    updateWorkflowStatus(workflowId: string, status: WorkflowStatus): Promise<WorkflowInstance | null>;
    applyWorkflowTaskUpdates(workflowId: string, updates: WorkflowTaskUpdate[]): Promise<WorkflowInstance | null>;
    /**
     * Lists all available personas that the requesting user (if specified) has access to.
     *
     * @public
     * @async
     * @param {string} [userId] - Optional. The ID of the user making the request. If provided,
     * persona availability will be filtered based on the user's subscription tier and permissions.
     * If omitted, all generally public personas might be listed (behavior determined by `GMIManager`).
     * @returns {Promise<Partial<IPersonaDefinition>[]>} A promise that resolves to an array of
     * persona definitions (or partial definitions suitable for public listing).
     * @throws {AgentOSServiceError} If the service is not initialized.
     */
    listAvailablePersonas(userId?: string): Promise<Partial<IPersonaDefinition>[]>;
    /**
     * Retrieves the conversation history for a specific conversation ID, subject to user authorization.
     *
     * @public
     * @async
     * @param {string} conversationId - The unique identifier of the conversation to retrieve.
     * @param {string} userId - The ID of the user requesting the history. Authorization checks
     * are performed to ensure the user has access to this conversation.
     * @returns {Promise<ConversationContext | null>} A promise that resolves to the
     * `ConversationContext` object if found and accessible, or `null` otherwise.
     * @throws {AgentOSServiceError} If the service is not initialized or if a critical error
     * occurs during history retrieval (permission errors might result in `null` or specific error type).
     */
    getConversationHistory(conversationId: string, userId: string): Promise<ConversationContext | null>;
    getPendingExternalToolRequest(conversationId: string, userId: string): Promise<AgentOSPendingExternalToolRequest | null>;
    resumeExternalToolRequest(pendingRequest: AgentOSPendingExternalToolRequest, toolResults: AgentOSToolResultInput[], options?: AgentOSResumeExternalToolRequestOptions): AsyncGenerator<AgentOSResponse, void, undefined>;
    /**
     * Receives and processes user feedback related to a specific interaction or persona.
     * The exact handling of feedback (e.g., storage, GMI adaptation) is determined by
     * the configured `GMIManager` and underlying GMI implementations.
     *
     * @public
     * @async
     * @param {string} userId - The ID of the user providing the feedback.
     * @param {string} sessionId - The session ID to which the feedback pertains.
     * @param {string} personaId - The persona ID involved in the interaction being reviewed.
     * @param {UserFeedbackPayload} feedbackPayload - The structured feedback data.
     * @returns {Promise<void>} A promise that resolves when the feedback has been processed.
     * @throws {AgentOSServiceError} If the service is not initialized or if an error occurs
     * during feedback processing (e.g., `GMIErrorCode.GMI_FEEDBACK_ERROR`).
     */
    receiveFeedback(userId: string, sessionId: string, personaId: string, feedbackPayload: UserFeedbackPayload): Promise<void>;
    /**
     * Initiates a graceful shutdown of the `AgentOS` service and all its components.
     * This includes shutting down managers, clearing caches, and releasing resources.
     *
     * @public
     * @async
     * @returns {Promise<void>} A promise that resolves when the shutdown sequence is complete.
     * @throws {AgentOSServiceError} If an error occurs during the shutdown of any critical component.
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=AgentOS.d.ts.map
// File: backend/agentos/api/AgentOS.ts
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
import type {
  AgentOSPendingExternalToolRequest,
  AgentOSResumeExternalToolRequestOptions,
} from './types/AgentOSExternalToolRequest';
import { AGENTOS_PENDING_EXTERNAL_TOOL_REQUEST_METADATA_KEY } from './types/AgentOSExternalToolRequest';
import type { AgentOSToolResultInput } from './types/AgentOSToolResult';
import {
  AgentOSResponse,
  AgentOSErrorChunk,
  AgentOSResponseChunkType,
  isActionableToolCallRequestChunk,
} from './types/AgentOSResponse';
import {
  AgentOSOrchestrator,
  type AgentOSOrchestratorDependencies,
  type AgentOSOrchestratorConfig,
  type ITaskOutcomeTelemetryStore,
} from './AgentOSOrchestrator';
import { GMIManager, GMIManagerConfig } from '../cognitive_substrate/GMIManager';
import {
  AIModelProviderManager,
  AIModelProviderManagerConfig,
} from '../core/llm/providers/AIModelProviderManager';
import { PromptEngine } from '../core/llm/PromptEngine';
import { PromptEngineConfig, IPromptEngineUtilityAI } from '../core/llm/IPromptEngine';
import type { ITool } from '../core/tools/ITool';
import { IToolOrchestrator, type ToolDefinitionForLLM } from '../core/tools/IToolOrchestrator';
import { ToolOrchestratorConfig } from '../config/ToolOrchestratorConfig';
import { ToolOrchestrator } from '../core/tools/ToolOrchestrator';
import { ToolExecutor } from '../core/tools/ToolExecutor';
import {
  IToolPermissionManager,
  ToolPermissionManagerConfig,
} from '../core/tools/permissions/IToolPermissionManager';
import { ToolPermissionManager } from '../core/tools/permissions/ToolPermissionManager';
import type { IAuthService, ISubscriptionService } from '../types/auth';
import type { IHumanInteractionManager } from '../core/hitl/IHumanInteractionManager';
import { IUtilityAI } from '../core/ai_utilities/IUtilityAI';
import { LLMUtilityAI } from '../core/ai_utilities/LLMUtilityAI';
import {
  ConversationManager,
  ConversationManagerConfig,
} from '../core/conversation/ConversationManager';
import { ConversationContext } from '../core/conversation/ConversationContext';
import type { IRollingSummaryMemorySink } from '../core/conversation/IRollingSummaryMemorySink';
import type { ILongTermMemoryRetriever } from '../core/conversation/ILongTermMemoryRetriever';
import type { IRetrievalAugmentor } from '../rag/IRetrievalAugmentor';
import type { IVectorStoreManager } from '../rag/IVectorStoreManager';
import type { EmbeddingManagerConfig } from '../config/EmbeddingManagerConfiguration';
import type { RetrievalAugmentorServiceConfig } from '../config/RetrievalAugmentorConfiguration';
import type {
  RagDataSourceConfig,
  VectorStoreManagerConfig,
} from '../config/VectorStoreConfiguration';
import type { PrismaClient } from '@prisma/client';
import type { StorageAdapter } from '@framers/sql-storage-adapter';
import { IPersonaDefinition } from '../cognitive_substrate/personas/IPersonaDefinition';
import {
  StreamingManager,
  StreamingManagerConfig,
  StreamId,
} from '../core/streaming/StreamingManager';
import { IStreamClient, StreamClientId } from '../core/streaming/IStreamClient';
import { GMIError, GMIErrorCode } from '@framers/agentos/utils/errors';
import { uuidv4 } from '@framers/agentos/utils/uuid';
import { ILogger } from '../logging/ILogger';
import { createLogger } from '../logging/loggerFactory';
import {
  configureAgentOSObservability,
  type AgentOSObservabilityConfig,
} from '../core/observability/otel';
import type { IGuardrailService, GuardrailContext } from '../core/guardrails/IGuardrailService';
import type { EmergentConfig } from '../emergent/types.js';
import type { SelfImprovementToolDeps } from '../emergent/EmergentCapabilityEngine.js';
import { PersonalityMutationStore } from '../emergent/PersonalityMutationStore.js';
import { resolveSelfImprovementSessionKey } from '../emergent/sessionScope.js';
import { GuardrailAction } from '../core/guardrails/IGuardrailService';
import {
  evaluateInputGuardrails,
  createGuardrailBlockedStream,
  wrapOutputGuardrails,
} from '../core/guardrails/guardrailDispatcher';
import type { IPersonaLoader } from '../cognitive_substrate/personas/IPersonaLoader';
import {
  ExtensionManager,
  EXTENSION_KIND_GUARDRAIL,
  EXTENSION_KIND_MESSAGING_CHANNEL,
  EXTENSION_KIND_PROVENANCE,
  EXTENSION_KIND_TOOL,
  EXTENSION_KIND_WORKFLOW,
  type ExtensionLifecycleContext,
  type ExtensionManifest,
  type ExtensionOverrides,
  type ExtensionEvent,
  type ExtensionEventListener,
} from '../extensions';
import { createMemoryToolsPack } from '../memory/extension/MemoryToolsExtension.js';
import type { MemoryToolsExtensionOptions } from '../memory/extension/MemoryToolsExtension.js';
import {
  createStandaloneMemoryLongTermRetriever,
  createStandaloneMemoryRollingSummarySink,
} from '../memory/integration/StandaloneMemoryBridge.js';
import type { Memory } from '../memory/facade/Memory.js';
import type {
  StandaloneMemoryLongTermRetrieverOptions,
  StandaloneMemoryRollingSummarySinkOptions,
} from '../memory/integration/StandaloneMemoryBridge.js';
import {
  listExternalToolDefinitionsForLLM,
  normalizeExternalToolRegistry,
  type ExternalToolRegistry,
} from './externalToolRegistry';
import { adaptTools, adaptToolsToMap, type AdaptableToolInput } from './toolAdapter';
import { createSchemaOnDemandPack } from '../extensions/packs/schema-on-demand-pack.js';
import { WorkflowRuntime } from '../core/workflows/runtime/WorkflowRuntime';
import { AgencyRegistry } from '../core/agency/AgencyRegistry';
import {
  AgentOSTurnPlanner,
  type ITurnPlanner,
  type TurnPlannerConfig,
} from '../core/orchestration/TurnPlanner';
import { CapabilityDiscoveryEngine, createDiscoverCapabilitiesTool } from '../discovery';
import type {
  CapabilityDescriptor,
  CapabilityDiscoveryConfig,
  CapabilityIndexSources,
  ICapabilityDiscoveryEngine,
  PresetCoOccurrence,
} from '../discovery/types';
import { EmbeddingManager } from '../rag/EmbeddingManager';
import { InMemoryVectorStore } from '../rag/implementations/vector_stores/InMemoryVectorStore';
import type { WorkflowDescriptor } from '../extensions/types';
import { WorkflowEngine } from '../core/workflows/WorkflowEngine';
import type {
  WorkflowEngineConfig,
  WorkflowEngineEventListener,
} from '../core/workflows/IWorkflowEngine';
import type {
  WorkflowDefinition,
  WorkflowDescriptorPayload,
  WorkflowEvent,
  WorkflowInstance,
  WorkflowProgressUpdate,
  WorkflowStatus,
} from '../core/workflows/WorkflowTypes';
import type {
  IWorkflowStore,
  WorkflowQueryOptions,
  WorkflowTaskUpdate,
} from '../core/workflows/storage/IWorkflowStore';
import { InMemoryWorkflowStore } from '../core/workflows/storage/InMemoryWorkflowStore';
import type { MessagingChannelPayload } from '../extensions/MessagingChannelPayload';
import {
  applySelfImprovementSessionOverrides as applySessionRuntimeOverrides,
  buildSelfImprovementSkillPromptContext as buildSessionSkillPromptContext,
  buildSelfImprovementSessionRuntimeKey as buildSessionRuntimeKey,
  disableSelfImprovementSessionSkill as disableSessionSkill,
  enableSelfImprovementSessionSkill as enableSessionSkill,
  getSelfImprovementRuntimeParam as getSessionRuntimeParam,
  listSelfImprovementDisabledSkillIds as listDisabledSessionSkillIds,
  listSelfImprovementSessionSkills as listSessionSkills,
  type SelfImprovementSkillDescriptor,
  type SelfImprovementSessionRuntimeState,
  setSelfImprovementRuntimeParam as setSessionRuntimeParam,
} from './selfImprovementRuntime.js';

type StorageWriteHookContext = {
  readonly operation: 'run' | 'batch';
  statement: string;
  parameters?: unknown;
  affectedTables?: string[];
  readonly inTransaction?: boolean;
  operationId: string;
  startTime: number;
  adapterKind?: string;
  metadata?: Record<string, unknown>;
};

type StorageWriteHookResult = StorageWriteHookContext | undefined | void;

type StorageWriteHooks = {
  onBeforeWrite?: (context: StorageWriteHookContext) => Promise<StorageWriteHookResult>;
  onAfterWrite?: (
    context: StorageWriteHookContext,
    result: { changes: number; lastInsertRowid?: unknown }
  ) => Promise<void>;
};

type AgentOSConfiguredSkill = NonNullable<CapabilityIndexSources['skills']>[number] & {
  id?: string;
};

function wrapStorageAdapterWithWriteHooks(
  adapter: StorageAdapter,
  hooks: StorageWriteHooks,
  options?: { inTransaction?: boolean; logger?: ILogger }
): StorageAdapter {
  const inTransaction = options?.inTransaction === true;

  const runWithHooks: StorageAdapter['run'] = async (statement, parameters) => {
    const startTime = Date.now();
    const operationId = uuidv4();
    const context: StorageWriteHookContext = {
      operation: 'run',
      statement,
      parameters,
      inTransaction,
      operationId,
      startTime,
      adapterKind: adapter.kind,
    };

    if (hooks.onBeforeWrite) {
      const hookResult = await hooks.onBeforeWrite(context);
      if (hookResult === undefined) {
        return { changes: 0, lastInsertRowid: null };
      }
      Object.assign(context, hookResult);
    }

    const result = await adapter.run(context.statement, context.parameters as any);
    try {
      await hooks.onAfterWrite?.(context, result);
    } catch (error: any) {
      options?.logger?.error?.('[AgentOS][StorageHooks] onAfterWrite failed', {
        error: error?.message ?? error,
      });
    }

    return result;
  };

  return {
    kind: adapter.kind,
    capabilities: adapter.capabilities,
    open: (opts) => adapter.open(opts),
    close: () => adapter.close(),
    exec: (script) => adapter.exec(script),
    get: (statement, parameters) => adapter.get(statement, parameters),
    all: (statement, parameters) => adapter.all(statement, parameters),
    run: runWithHooks,
    transaction: async <T>(fn: (trx: StorageAdapter) => Promise<T>): Promise<T> => {
      return adapter.transaction(async (trx) => {
        const wrappedTrx = wrapStorageAdapterWithWriteHooks(trx, hooks, {
          inTransaction: true,
          logger: options?.logger,
        });
        return fn(wrappedTrx);
      });
    },
    batch: adapter.batch
      ? async (operations) => {
          const results: any[] = [];
          const errors: Array<{ index: number; error: Error }> = [];
          let successful = 0;
          let failed = 0;

          for (let i = 0; i < operations.length; i += 1) {
            const op = operations[i];
            try {
              const result = await runWithHooks(op.statement, op.parameters);
              results.push(result);
              successful += 1;
            } catch (error: any) {
              results.push({ changes: 0, lastInsertRowid: null });
              failed += 1;
              errors.push({
                index: i,
                error: error instanceof Error ? error : new Error(String(error)),
              });
            }
          }

          return {
            successful,
            failed,
            results,
            errors: errors.length > 0 ? errors : undefined,
          } as any;
        }
      : undefined,
    prepare: adapter.prepare ? (statement) => adapter.prepare!(statement) : undefined,
  };
}

// Re-export from extracted module
import { AgentOSServiceError } from './errors';
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

const DISCOVERY_EMBEDDING_DEFAULTS: Record<string, { modelId: string; dimension: number }> = {
  openai: { modelId: 'text-embedding-3-small', dimension: 1536 },
  openrouter: { modelId: 'openai/text-embedding-3-small', dimension: 1536 },
  ollama: { modelId: 'nomic-embed-text', dimension: 768 },
};

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
  memory: Pick<Memory, 'remember' | 'recall' | 'forget'> &
    Partial<Pick<Memory, 'createTools' | 'health' | 'close'>>;

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
  languageConfig?: import('../core/language').AgentOSLanguageConfig;
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
export class AgentOS implements IAgentOS {
  private initialized: boolean = false;
  private config!: Readonly<AgentOSConfig>;
  private managedStandaloneMemoryClosers: Array<() => Promise<void>> = [];
  private readonly selfImprovementSessionRuntime = new Map<string, SelfImprovementSessionRuntimeState>();

  private modelProviderManager!: AIModelProviderManager;
  private utilityAIService!: IUtilityAI & IPromptEngineUtilityAI;
  private promptEngine!: PromptEngine;
  private toolPermissionManager!: IToolPermissionManager;
  private toolExecutor!: ToolExecutor;
  private toolOrchestrator!: IToolOrchestrator;
  private extensionManager!: ExtensionManager;
  private conversationManager!: ConversationManager;
  private streamingManager!: StreamingManager;
  private gmiManager!: GMIManager;
  private agentOSOrchestrator!: AgentOSOrchestrator;
  private languageService?: import('../core/language').LanguageService;
  private guardrailService?: IGuardrailService;
  private workflowEngine!: WorkflowEngine;
  private workflowStore!: IWorkflowStore;
  private workflowEngineListener?: WorkflowEngineEventListener;
  private workflowExtensionListener?: ExtensionEventListener;
  private workflowRuntime?: WorkflowRuntime;
  private agencyRegistry?: AgencyRegistry;
  private turnPlanner?: ITurnPlanner;
  private capabilityDiscoveryEngine?: ICapabilityDiscoveryEngine;
  private discoveryEmbeddingManager?: EmbeddingManager;
  private discoveryVectorStore?: InMemoryVectorStore;

  private retrievalAugmentor?: IRetrievalAugmentor;
  private ragVectorStoreManager?: IVectorStoreManager;
  private manageRetrievalAugmentorLifecycle: boolean = false;

  private authService?: IAuthService;

  private subscriptionService?: ISubscriptionService;
  private prisma!: PrismaClient;

  /**
   * Constructs an `AgentOS` instance. The instance is not operational until
   * `initialize()` is called and successfully completes.
   */
  constructor(private readonly logger: ILogger = createLogger('AgentOS')) {}

  private buildSelfImprovementSessionRuntimeKey(sessionId: string): string {
    return buildSessionRuntimeKey(sessionId);
  }

  private getSelfImprovementRuntimeParam(
    sessionKey: string,
    param: string,
  ): unknown {
    return getSessionRuntimeParam(this.selfImprovementSessionRuntime, sessionKey, param);
  }

  private setSelfImprovementRuntimeParam(
    sessionKey: string,
    param: string,
    value: unknown,
  ): void {
    setSessionRuntimeParam(this.selfImprovementSessionRuntime, sessionKey, param, value);
  }

  private applySelfImprovementSessionOverrides(input: AgentOSInput): AgentOSInput {
    return applySessionRuntimeOverrides(this.selfImprovementSessionRuntime, input);
  }

  private getConfiguredDiscoverySkills(): AgentOSConfiguredSkill[] {
    try {
      const turnPlanningSkills = this.config.turnPlanning?.discovery?.sources?.skills;
      if (Array.isArray(turnPlanningSkills)) {
        return turnPlanningSkills as AgentOSConfiguredSkill[];
      }

      const legacySkills = (this.config as any).capabilityDiscovery?.sources?.skills;
      if (Array.isArray(legacySkills)) {
        return legacySkills as AgentOSConfiguredSkill[];
      }
    } catch {
      // Fall through to empty set.
    }

    return [];
  }

  private normalizeConfiguredSkill(
    skill: Partial<AgentOSConfiguredSkill>,
    fallbackId?: string,
  ): SelfImprovementSkillDescriptor {
    const skillId = String(skill.id ?? skill.name ?? fallbackId ?? 'unknown');
    return {
      skillId,
      name: String(skill.name ?? fallbackId ?? skillId),
      category: String(skill.category ?? 'general'),
      ...(typeof skill.description === 'string' ? { description: skill.description } : {}),
      ...(typeof skill.content === 'string' ? { content: skill.content } : {}),
      ...(typeof skill.sourcePath === 'string' ? { sourcePath: skill.sourcePath } : {}),
    };
  }

  private resolveConfiguredSelfImprovementSkill(
    skillId: string,
  ): SelfImprovementSkillDescriptor | undefined {
    const configured = this.getConfiguredDiscoverySkills().find(
      (skill) => String(skill.id ?? skill.name ?? '') === skillId,
    );
    return configured ? this.normalizeConfiguredSkill(configured, skillId) : undefined;
  }

  private listSelfImprovementSessionSkills(sessionKey: string): SelfImprovementSkillDescriptor[] {
    return listSessionSkills(this.selfImprovementSessionRuntime, sessionKey);
  }

  private listSelfImprovementDisabledSkillIds(sessionKey: string): string[] {
    return listDisabledSessionSkillIds(this.selfImprovementSessionRuntime, sessionKey);
  }

  private buildSelfImprovementSkillPromptContext(sessionId: string): string | undefined {
    const sessionKey = this.buildSelfImprovementSessionRuntimeKey(sessionId);
    return buildSessionSkillPromptContext(this.selfImprovementSessionRuntime, sessionKey);
  }

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
  public async initialize(config: AgentOSConfig): Promise<void> {
    if (this.initialized) {
      this.logger.warn('AgentOS initialize() called more than once; skipping.');
      return;
    }

    this.validateConfiguration(config);
    const resolvedConfig = this.resolveStandaloneMemoryConfig(config);
    const normalizedConfigTools = adaptToolsToMap(resolvedConfig.tools);
    const normalizedExternalTools = normalizeExternalToolRegistry(resolvedConfig.externalTools);
    const {
      externalTools: _externalTools,
      tools: _tools,
      ...resolvedConfigWithoutNormalizedTools
    } = resolvedConfig;
    // Make the configuration immutable after validation to prevent runtime changes.
    this.config = Object.freeze({
      ...resolvedConfigWithoutNormalizedTools,
      ...(Object.keys(normalizedConfigTools).length > 0 ? { tools: normalizedConfigTools } : {}),
      ...(normalizedExternalTools ? { externalTools: normalizedExternalTools } : {}),
    });
    this.configureManagedStandaloneMemory();

    // Observability is opt-in (config + env). Safe no-op if OTEL is not installed by host.
    configureAgentOSObservability(this.config.observability);

    // Initialize LanguageService early if configured so downstream orchestration can use it.
    if (config.languageConfig) {
      try {
        // Dynamic import may fail under certain bundler path resolutions; using explicit relative path.
        const { LanguageService } = await import('../core/language');
        this.languageService = new LanguageService(config.languageConfig);
        await this.languageService.initialize();
        this.logger.info('AgentOS LanguageService initialized');
      } catch (langErr: any) {
        this.logger.error(
          'Failed initializing LanguageService; continuing without multilingual features',
          { error: langErr?.message || langErr }
        );
      }
    }

    // Assign core services from configuration
    this.authService = this.config.authService;
    this.subscriptionService = this.config.subscriptionService;
    this.prisma = this.config.prisma; // Optional - only needed for auth/subscriptions
    this.guardrailService = this.config.guardrailService;

    // Validate that either storageAdapter or prisma is provided
    if (!this.config.storageAdapter && !this.config.prisma) {
      throw new AgentOSServiceError(
        'Either storageAdapter or prisma must be provided. Use storageAdapter for client-side (IndexedDB/SQLite) or prisma for server-side (PostgreSQL).',
        GMIErrorCode.CONFIGURATION_ERROR,
        'AgentOS.initialize'
      );
    }

    this.logger.info('AgentOS initialization sequence started');

    this.extensionManager = new ExtensionManager({
      manifest: this.config.extensionManifest,
      secrets: this.config.extensionSecrets,
      overrides: this.config.extensionOverrides,
    });
    const extensionLifecycleContext: ExtensionLifecycleContext = { logger: this.logger };
    await this.extensionManager.loadManifest(extensionLifecycleContext);
    await this.registerConfigGuardrailService(extensionLifecycleContext);

    if (this.config.schemaOnDemandTools?.enabled === true) {
      const allowPackages =
        typeof this.config.schemaOnDemandTools.allowPackages === 'boolean'
          ? this.config.schemaOnDemandTools.allowPackages
          : process.env.NODE_ENV !== 'production';

      const pack = createSchemaOnDemandPack({
        extensionManager: this.extensionManager,
        options: {
          allowPackages,
          allowModules: this.config.schemaOnDemandTools.allowModules,
          officialRegistryOnly: this.config.schemaOnDemandTools.officialRegistryOnly,
        },
      });
      await this.extensionManager.loadPackFromFactory(
        pack,
        'schema-on-demand',
        undefined,
        extensionLifecycleContext
      );
      this.logger.info('[AgentOS] Schema-on-demand tools enabled');
    }

    await this.registerConfigMemoryTools(extensionLifecycleContext);

    let storageAdapter = this.config.storageAdapter;
    if (storageAdapter) {
      try {
        const provenanceDescriptor = this.extensionManager
          .getRegistry<any>(EXTENSION_KIND_PROVENANCE)
          .getActive('provenance-system');
        const provenanceHooks = (provenanceDescriptor as any)?.payload?.result?.hooks;
        if (provenanceHooks) {
          storageAdapter = wrapStorageAdapterWithWriteHooks(storageAdapter, provenanceHooks, {
            logger: this.logger,
          });
          this.logger.info('[AgentOS][Provenance] Storage write hooks enabled');
        }
      } catch (error: any) {
        this.logger.warn?.('[AgentOS][Provenance] Failed to apply storage write hooks', {
          error: error?.message ?? error,
        });
      }
    }

    try {
      await this.initializeWorkflowRuntime(extensionLifecycleContext);
      // Initialize AI Model Provider Manager
      this.modelProviderManager = new AIModelProviderManager();
      await this.modelProviderManager.initialize(this.config.modelProviderManagerConfig);
      console.log('AgentOS: AIModelProviderManager initialized.');
      await this.ensureUtilityAIService();
      await this.initializeRagSubsystem(storageAdapter);

      // Initialize Prompt Engine
      this.promptEngine = new PromptEngine();
      const peUtility = this.utilityAIService;
      if (
        typeof peUtility.summarizeConversationHistory !== 'function' ||
        typeof peUtility.summarizeRAGContext !== 'function'
      ) {
        const warningMsg =
          'AgentOS WARNING: The provided utilityAIService does not fully implement the IPromptEngineUtilityAI interface (missing summarizeConversationHistory or summarizeRAGContext). PromptEngine functionality may be impaired.';
        console.warn(warningMsg);
      }
      await this.promptEngine.initialize(this.config.promptEngineConfig, this.utilityAIService);
      console.log('AgentOS: PromptEngine initialized.');

      // Initialize Tool Permission Manager
      this.toolPermissionManager = new ToolPermissionManager();
      await this.toolPermissionManager.initialize(
        this.config.toolPermissionManagerConfig,
        this.authService,
        this.subscriptionService
      );
      console.log('AgentOS: ToolPermissionManager initialized.');

      // Initialize Tool Orchestrator
      const toolRegistry = this.extensionManager.getRegistry<ITool>(EXTENSION_KIND_TOOL);
      this.toolExecutor = new ToolExecutor(
        this.authService,
        this.subscriptionService,
        toolRegistry
      );
      this.toolOrchestrator = new ToolOrchestrator();
      // Build emergent options from config when emergent: true.
      const emergentOptions = this.config.emergent
        ? {
            enabled: true,
            config: this.config.emergentConfig,
            generateText: async (model: string, prompt: string): Promise<string> => {
              const provider = this.modelProviderManager.getDefaultProvider();
              if (!provider) {
                throw new Error('No LLM provider available for the emergent judge.');
              }
              const response = await provider.generateCompletion(
                model,
                [{ role: 'user', content: prompt }],
                {}
              );
              const firstContent = response.choices?.[0]?.message?.content ?? '';
              return typeof firstContent === 'string' ? firstContent : JSON.stringify(firstContent);
            },
            storageAdapter: storageAdapter
              ? {
                  run: async (sql: string, params?: unknown[]) =>
                    storageAdapter.run(sql, params as any),
                  get: async (sql: string, params?: unknown[]) =>
                    storageAdapter.get(sql, params as any),
                  all: async (sql: string, params?: unknown[]) =>
                    storageAdapter.all(sql, params as any),
                  exec: async (sql: string) => storageAdapter.exec(sql),
                }
              : undefined,

            // ---------------------------------------------------------------
            // Self-improvement deps — only assembled when the feature is
            // enabled. All hooks are lazy closures that resolve against the
            // fully initialised runtime at tool-call time (NOT at bootstrap).
            // ---------------------------------------------------------------
            selfImprovementDeps:
              this.config.emergentConfig?.selfImprovement?.enabled
                ? ((): SelfImprovementToolDeps => {
                    // PersonalityMutationStore reuses the same storage adapter
                    // that the EmergentToolRegistry already depends on.
                    const mutationStore = storageAdapter
                      ? new PersonalityMutationStore({
                          run: async (sql: string, params?: unknown[]) =>
                            storageAdapter.run(sql, params as any),
                          get: async (sql: string, params?: unknown[]) =>
                            storageAdapter.get(sql, params as any),
                          all: async (sql: string, params?: unknown[]) =>
                            storageAdapter.all(sql, params as any),
                          exec: async (sql: string) => storageAdapter.exec(sql),
                        })
                      : undefined;

                    return {
                      // --- Personality (HEXACO) ---
                      // Reads/writes the active GMI's persona personalityTraits map.
                      // Falls back to an empty map when no GMI or persona is active.
                      getPersonality: (): Record<string, number> => {
                        try {
                          const gmi = this.gmiManager?.activeGMIs?.values().next().value;
                          const traits = gmi?.getPersona()?.personalityTraits;
                          if (traits && typeof traits === 'object') {
                            const result: Record<string, number> = {};
                            for (const [k, v] of Object.entries(traits)) {
                              if (typeof v === 'number') result[k] = v;
                            }
                            return result;
                          }
                        } catch { /* GMI not ready yet — return empty. */ }
                        return {};
                      },
                      setPersonality: (trait: string, value: number): void => {
                        try {
                          const gmi = this.gmiManager?.activeGMIs?.values().next().value;
                          const persona = gmi?.getPersona();
                          if (persona) {
                            if (!persona.personalityTraits) {
                              persona.personalityTraits = {};
                            }
                            persona.personalityTraits[trait] = value;
                          }
                        } catch { /* GMI not ready — ignore. */ }
                      },
                      mutationStore,

                      // --- Skills ---
                      // AgentOS does not own a mutable SkillRegistry here, so
                      // skill activation is tracked as session-scoped overlay
                      // state keyed by the self-improvement session.
                      getActiveSkills: (
                        context?: import('../core/tools/ITool.js').ToolExecutionContext,
                      ): Array<{ skillId: string; name: string; category: string }> => {
                        const sessionKey = resolveSelfImprovementSessionKey(context);
                        return this.listSelfImprovementSessionSkills(sessionKey).map((skill) => ({
                          skillId: skill.skillId,
                          name: skill.name,
                          category: skill.category,
                        }));
                      },
                      getLockedSkills: (): string[] => [],
                      loadSkill: async (
                        id: string,
                        context?: import('../core/tools/ITool.js').ToolExecutionContext,
                      ) => {
                        const sessionKey = resolveSelfImprovementSessionKey(context);
                        const resolvedSkill = this.resolveConfiguredSelfImprovementSkill(id) ?? {
                          skillId: id,
                          name: id,
                          category: 'dynamic',
                        };
                        enableSessionSkill(
                          this.selfImprovementSessionRuntime,
                          sessionKey,
                          resolvedSkill,
                        );
                        return {
                          skillId: resolvedSkill.skillId,
                          name: resolvedSkill.name,
                          category: resolvedSkill.category,
                        };
                      },
                      unloadSkill: (
                        id: string,
                        context?: import('../core/tools/ITool.js').ToolExecutionContext,
                      ) => {
                        const sessionKey = resolveSelfImprovementSessionKey(context);
                        const resolvedSkill = this.resolveConfiguredSelfImprovementSkill(id);
                        disableSessionSkill(
                          this.selfImprovementSessionRuntime,
                          sessionKey,
                          resolvedSkill?.name ?? id,
                        );
                      },
                      searchSkills: (query: string) => {
                        const q = query.toLowerCase();
                        return this.getConfiguredDiscoverySkills()
                          .filter((skill) =>
                            (skill.name ?? '').toLowerCase().includes(q) ||
                            (skill.description ?? '').toLowerCase().includes(q)
                          )
                          .map((skill) => {
                            const normalizedSkill = this.normalizeConfiguredSkill(skill);
                            return {
                              skillId: normalizedSkill.skillId,
                              name: normalizedSkill.name,
                              category: normalizedSkill.category,
                              description: normalizedSkill.description ?? '',
                            };
                          });
                      },

                      // --- Tools ---
                      // Wire directly to the ToolOrchestrator. At tool-call
                      // time the orchestrator is guaranteed to be initialised.
                      executeTool: async (
                        name: string,
                        args: unknown,
                        context?: import('../core/tools/ITool.js').ToolExecutionContext,
                      ): Promise<unknown> => {
                        const tool = await this.toolOrchestrator.getTool(name);
                        if (!tool) {
                          throw new Error(`Tool "${name}" not found in orchestrator.`);
                        }
                        const result = await tool.execute(
                          (args ?? {}) as Record<string, unknown>,
                          context ?? {
                            gmiId: 'self-improvement',
                            personaId: 'self-improvement',
                            userContext: { userId: 'system' } as any,
                          },
                        );
                        if (!result.success) {
                          throw new Error(result.error ?? `Tool "${name}" failed.`);
                        }
                        return result.output;
                      },
                      listTools: (): string[] => {
                        try {
                          return (this.toolOrchestrator as any).toolExecutor
                            ?.listAvailableTools()
                            ?.map((t: any) => t.name) ?? [];
                        } catch { return []; }
                      },
                      getSessionParam: (param: string, context) => {
                        const sessionKey = resolveSelfImprovementSessionKey(context);
                        return this.getSelfImprovementRuntimeParam(sessionKey, param);
                      },
                      setSessionParam: (param: string, value: unknown, context) => {
                        const sessionKey = resolveSelfImprovementSessionKey(context);
                        this.setSelfImprovementRuntimeParam(sessionKey, param, value);
                      },

                      // --- Memory ---
                      // Persist self-improvement traces into the first active
                      // GMI's cognitive memory when available.
                      storeMemory: async (trace): Promise<void> => {
                        try {
                          const gmi = this.gmiManager?.activeGMIs?.values().next().value;
                          const mem = gmi?.getCognitiveMemoryManager?.();
                          if (mem) {
                            await mem.encode(
                              `[self-improvement:${trace.type}] ${trace.content}`,
                              { valence: 0, arousal: 0, dominance: 0.5 },
                              'neutral',
                              {
                                type: 'semantic' as any,
                                scope: (trace.scope ?? 'agent') as any,
                                tags: trace.tags,
                              },
                            );
                          }
                        } catch { /* Memory not available — silently skip. */ }
                      },
                    };
                  })()
                : undefined,
          }
        : undefined;
      const initialConfigTools = adaptTools(this.config.tools);

      await this.toolOrchestrator.initialize(
        this.config.toolOrchestratorConfig,
        this.toolPermissionManager,
        this.toolExecutor,
        initialConfigTools,
        this.config.hitlManager,
        emergentOptions
      );
      console.log('AgentOS: ToolOrchestrator initialized.');
      if (initialConfigTools.length > 0) {
        this.logger.info('[AgentOS] Config tools registered', {
          toolCount: initialConfigTools.length,
          toolNames: initialConfigTools.map((tool) => tool.name),
        });
      }
      await this.initializeTurnPlanner();
      if (this.capabilityDiscoveryEngine && this.toolOrchestrator.setEmergentDiscoveryIndexer) {
        this.toolOrchestrator.setEmergentDiscoveryIndexer(async (tools) => {
          if (this.capabilityDiscoveryEngine?.indexEmergentTools) {
            await this.capabilityDiscoveryEngine.indexEmergentTools(tools);
          }
        });
      }

      // Initialize Conversation Manager
      this.conversationManager = new ConversationManager();
      await this.conversationManager.initialize(
        this.config.conversationManagerConfig,
        this.utilityAIService, // General IUtilityAI for conversation tasks
        storageAdapter // Use storageAdapter instead of Prisma
      );
      console.log('AgentOS: ConversationManager initialized.');

      // Initialize Streaming Manager
      this.streamingManager = new StreamingManager();
      await this.streamingManager.initialize(this.config.streamingManagerConfig);
      console.log('AgentOS: StreamingManager initialized.');

      // Initialize GMI Manager
      this.gmiManager = new GMIManager(
        this.config.gmiManagerConfig,
        this.subscriptionService,
        this.authService,
        this.conversationManager, // Removed Prisma parameter
        this.promptEngine,
        this.modelProviderManager,
        this.utilityAIService, // Pass the potentially dual-role utility service
        this.toolOrchestrator,
        this.retrievalAugmentor,
        this.config.personaLoader
      );
      await this.gmiManager.initialize();
      console.log('AgentOS: GMIManager initialized.');

      await this.startWorkflowRuntime();

      // Initialize AgentOS Orchestrator
      const orchestratorDependencies: AgentOSOrchestratorDependencies = {
        gmiManager: this.gmiManager,
        toolOrchestrator: this.toolOrchestrator,
        conversationManager: this.conversationManager,
        streamingManager: this.streamingManager,
        modelProviderManager: this.modelProviderManager,
        turnPlanner: this.turnPlanner,
        rollingSummaryMemorySink: this.config.rollingSummaryMemorySink,
        longTermMemoryRetriever: this.config.longTermMemoryRetriever,
        taskOutcomeTelemetryStore: this.config.taskOutcomeTelemetryStore,
      };
      this.agentOSOrchestrator = new AgentOSOrchestrator();
      await this.agentOSOrchestrator.initialize(
        this.config.orchestratorConfig,
        orchestratorDependencies
      );
      this.logger.info('AgentOS orchestrator initialized');
    } catch (error: unknown) {
      this.logger.error('AgentOS initialization failed', { error });
      const err =
        error instanceof GMIError
          ? error
          : new GMIError(
              error instanceof Error
                ? error.message
                : 'Unknown error during AgentOS initialization',
              GMIErrorCode.GMI_INITIALIZATION_ERROR, // Corrected error code
              error // details
            );
      console.error(
        'AgentOS: Critical failure during core component initialization:',
        err.toJSON()
      );
      throw AgentOSServiceError.wrap(
        err,
        err.code,
        'AgentOS initialization failed',
        'AgentOS.initialize'
      );
    }

    this.initialized = true;
    this.logger.info('AgentOS initialization complete');
  }

  /**
   * Validates the provided `AgentOSConfig` to ensure all mandatory sub-configurations
   * and dependencies are present.
   *
   * @private
   * @param {AgentOSConfig} config - The configuration object to validate.
   * @throws {AgentOSServiceError} If any required configuration parameter is missing,
   * with `code` set to `GMIErrorCode.CONFIGURATION_ERROR`.
   */
  private validateConfiguration(config: AgentOSConfig): void {
    const missingParams: string[] = [];
    if (!config) {
      // This case should ideally not be hit if TypeScript is used correctly at the call site,
      // but as a runtime check:
      missingParams.push('AgentOSConfig (entire object)');
    } else {
      // Check for each required sub-configuration
      const requiredConfigs: Array<keyof AgentOSConfig> = [
        'gmiManagerConfig',
        'orchestratorConfig',
        'promptEngineConfig',
        'toolOrchestratorConfig',
        'toolPermissionManagerConfig',
        'conversationManagerConfig',
        'streamingManagerConfig',
        'modelProviderManagerConfig',
        'defaultPersonaId',
      ];
      for (const key of requiredConfigs) {
        if (!config[key]) {
          missingParams.push(String(key));
        }
      }
      // Either storageAdapter or prisma must be provided
      if (!config.storageAdapter && !config.prisma) {
        missingParams.push('storageAdapter or prisma (at least one required)');
      }
      if (config.memoryTools && config.memoryTools.enabled !== false) {
        if (
          !config.memoryTools.memory ||
          typeof config.memoryTools.memory.createTools !== 'function'
        ) {
          missingParams.push('memoryTools.memory.createTools (when memoryTools is enabled)');
        }
        if (
          config.memoryTools.manageLifecycle === true &&
          typeof config.memoryTools.memory?.close !== 'function'
        ) {
          missingParams.push('memoryTools.memory.close (when memoryTools.manageLifecycle is true)');
        }
      }
      if (config.standaloneMemory && config.standaloneMemory.enabled !== false) {
        if (!config.standaloneMemory.memory) {
          missingParams.push('standaloneMemory.memory');
        }
        if (
          config.standaloneMemory.tools &&
          !config.memoryTools &&
          typeof config.standaloneMemory.memory?.createTools !== 'function'
        ) {
          missingParams.push(
            'standaloneMemory.memory.createTools (when standaloneMemory.tools is enabled)'
          );
        }
        if (
          config.standaloneMemory.longTermRetriever &&
          !config.longTermMemoryRetriever &&
          typeof config.standaloneMemory.memory?.recall !== 'function'
        ) {
          missingParams.push(
            'standaloneMemory.memory.recall (when standaloneMemory.longTermRetriever is enabled)'
          );
        }
        if (
          config.standaloneMemory.rollingSummarySink &&
          !config.rollingSummaryMemorySink &&
          (typeof config.standaloneMemory.memory?.remember !== 'function' ||
            typeof config.standaloneMemory.memory?.forget !== 'function')
        ) {
          missingParams.push(
            'standaloneMemory.memory.remember/forget (when standaloneMemory.rollingSummarySink is enabled)'
          );
        }
        if (
          config.standaloneMemory.manageLifecycle === true &&
          typeof config.standaloneMemory.memory?.close !== 'function'
        ) {
          missingParams.push(
            'standaloneMemory.memory.close (when standaloneMemory.manageLifecycle is true)'
          );
        }
      }
    }

    if (missingParams.length > 0) {
      const message = `AgentOS Configuration Error: Missing essential parameters: ${missingParams.join(', ')}.`;
      console.error(message);
      throw new AgentOSServiceError(message, GMIErrorCode.CONFIGURATION_ERROR, {
        missingParameters: missingParams,
      });
    }
  }

  private async registerConfigGuardrailService(context: ExtensionLifecycleContext): Promise<void> {
    if (!this.config.guardrailService) {
      return;
    }
    const registry = this.extensionManager.getRegistry<IGuardrailService>(EXTENSION_KIND_GUARDRAIL);
    await registry.register(
      {
        id: 'config-guardrail-service',
        kind: EXTENSION_KIND_GUARDRAIL,
        payload: this.config.guardrailService,
        priority: Number.MAX_SAFE_INTEGER,
        metadata: { origin: 'config' },
      },
      context
    );
  }

  private resolveStandaloneMemoryConfig(config: AgentOSConfig): AgentOSConfig {
    const standalone = config.standaloneMemory;
    if (!standalone || standalone.enabled === false) {
      return { ...config };
    }

    const resolved: AgentOSConfig = { ...config };
    const memory = standalone.memory;

    if (!resolved.memoryTools && standalone.tools) {
      resolved.memoryTools = {
        memory: memory as Pick<Memory, 'createTools'> & Partial<Pick<Memory, 'close'>>,
        ...(standalone.tools === true ? {} : standalone.tools),
      };
    }

    if (!resolved.longTermMemoryRetriever && standalone.longTermRetriever) {
      resolved.longTermMemoryRetriever = createStandaloneMemoryLongTermRetriever(
        memory as Pick<Memory, 'recall'>,
        standalone.longTermRetriever === true ? undefined : standalone.longTermRetriever
      );
    }

    if (!resolved.rollingSummaryMemorySink && standalone.rollingSummarySink) {
      resolved.rollingSummaryMemorySink = createStandaloneMemoryRollingSummarySink(
        memory as Pick<Memory, 'remember' | 'recall' | 'forget'> &
          Partial<Pick<Memory, 'health' | 'close'>>,
        standalone.rollingSummarySink === true ? undefined : standalone.rollingSummarySink
      );
    }

    return resolved;
  }

  private configureManagedStandaloneMemory(): void {
    this.managedStandaloneMemoryClosers = [];

    const standalone = this.config.standaloneMemory;
    if (!standalone || standalone.enabled === false || standalone.manageLifecycle !== true) {
      return;
    }
    if (this.config.memoryTools?.manageLifecycle === true) {
      return;
    }
    if (typeof standalone.memory.close !== 'function') {
      return;
    }

    this.managedStandaloneMemoryClosers.push(async () => {
      await standalone.memory.close?.();
    });
  }

  private async registerConfigMemoryTools(context: ExtensionLifecycleContext): Promise<void> {
    if (!this.config.memoryTools || this.config.memoryTools.enabled === false) {
      return;
    }

    const {
      memory,
      enabled: _enabled,
      identifier,
      manageLifecycle,
      ...packOptions
    } = this.config.memoryTools;

    const pack = createMemoryToolsPack(memory, packOptions);
    const packIdentifier = identifier ?? 'config-memory-tools';
    if (manageLifecycle) {
      const existingOnDeactivate = pack.onDeactivate;
      pack.onDeactivate = async (lifecycleContext) => {
        await existingOnDeactivate?.(lifecycleContext);
        await memory.close?.();
      };
    }

    await this.extensionManager.loadPackFromFactory(pack, packIdentifier, undefined, context);

    this.logger.info('[AgentOS] Config memory tools enabled', {
      identifier: packIdentifier,
      packName: pack.name,
      toolCount: pack.descriptors.length,
    });
  }

  private async initializeWorkflowRuntime(_context: ExtensionLifecycleContext): Promise<void> {
    this.workflowStore = this.config.workflowStore ?? new InMemoryWorkflowStore();
    this.workflowEngine = new WorkflowEngine();

    const workflowLogger = this.logger.child?.({ component: 'WorkflowEngine' }) ?? this.logger;
    await this.workflowEngine.initialize(this.config.workflowEngineConfig ?? {}, {
      store: this.workflowStore,
      logger: workflowLogger,
    });

    const agencyLogger = this.logger.child?.({ component: 'AgencyRegistry' }) ?? this.logger;
    this.agencyRegistry = new AgencyRegistry(agencyLogger);

    await this.registerWorkflowDescriptorsFromRegistry();

    this.workflowExtensionListener = async (event: ExtensionEvent) => {
      if (!this.workflowEngine) {
        return;
      }
      if (event.type === 'descriptor:activated' && event.kind === EXTENSION_KIND_WORKFLOW) {
        const descriptor = event.descriptor as WorkflowDescriptor;
        await this.handleWorkflowDescriptorActivated({
          id: descriptor.id,
          payload: descriptor.payload,
        });
      } else if (
        event.type === 'descriptor:deactivated' &&
        event.kind === EXTENSION_KIND_WORKFLOW
      ) {
        const descriptor = event.descriptor as WorkflowDescriptor;
        await this.handleWorkflowDescriptorDeactivated({
          id: descriptor.id,
          payload: descriptor.payload,
        });
      }
    };
    this.extensionManager.on(this.workflowExtensionListener);

    this.workflowEngineListener = async (event: WorkflowEvent) => {
      await this.handleWorkflowEngineEvent(event);
    };
    this.workflowEngine.onEvent(this.workflowEngineListener);
  }

  private async startWorkflowRuntime(): Promise<void> {
    if (!this.workflowEngine) {
      return;
    }
    if (this.workflowRuntime) {
      return;
    }
    if (!this.gmiManager || !this.streamingManager || !this.toolOrchestrator) {
      this.logger.warn('Workflow runtime start skipped because core dependencies are not ready.');
      return;
    }

    if (!this.agencyRegistry) {
      const agencyLogger = this.logger.child?.({ component: 'AgencyRegistry' }) ?? this.logger;
      this.agencyRegistry = new AgencyRegistry(agencyLogger);
    }

    const runtimeLogger = this.logger.child?.({ component: 'WorkflowRuntime' }) ?? this.logger;
    this.workflowRuntime = new WorkflowRuntime({
      workflowEngine: this.workflowEngine,
      gmiManager: this.gmiManager,
      streamingManager: this.streamingManager,
      toolOrchestrator: this.toolOrchestrator,
      extensionManager: this.extensionManager,
      agencyRegistry: this.agencyRegistry,
      logger: runtimeLogger,
    });
    await this.workflowRuntime.start();
  }

  private async registerWorkflowDescriptorsFromRegistry(): Promise<void> {
    const registry =
      this.extensionManager.getRegistry<WorkflowDescriptorPayload>(EXTENSION_KIND_WORKFLOW);
    const activeDescriptors = registry.listActive();
    for (const descriptor of activeDescriptors) {
      await this.handleWorkflowDescriptorActivated({
        id: descriptor.id,
        payload: descriptor.payload,
      });
    }
  }

  private async handleWorkflowDescriptorActivated(descriptor: {
    id: string;
    payload: WorkflowDescriptorPayload;
  }): Promise<void> {
    try {
      await this.workflowEngine.registerWorkflowDescriptor(descriptor.payload);
      this.logger.debug?.('Workflow descriptor registered', {
        descriptorId: descriptor.id,
        workflowDefinitionId: descriptor.payload.definition.id,
      });
    } catch (error) {
      this.logger.error('Failed to register workflow descriptor', {
        descriptorId: descriptor.id,
        workflowDefinitionId: descriptor.payload.definition.id,
        error,
      });
    }
  }

  private async handleWorkflowDescriptorDeactivated(descriptor: {
    id: string;
    payload: WorkflowDescriptorPayload;
  }): Promise<void> {
    try {
      await this.workflowEngine.unregisterWorkflowDescriptor(descriptor.payload.definition.id);
      this.logger.debug?.('Workflow descriptor unregistered', {
        descriptorId: descriptor.id,
        workflowDefinitionId: descriptor.payload.definition.id,
      });
    } catch (error) {
      this.logger.error('Failed to unregister workflow descriptor', {
        descriptorId: descriptor.id,
        workflowDefinitionId: descriptor.payload.definition.id,
        error,
      });
    }
  }

  private async handleWorkflowEngineEvent(event: WorkflowEvent): Promise<void> {
    try {
      await this.emitWorkflowUpdate(event.workflowId);
    } catch (error) {
      this.logger.error('Failed to handle workflow engine event', {
        workflowId: event.workflowId,
        eventType: event.type,
        error,
      });
    }
  }

  private async emitWorkflowUpdate(workflowId: string): Promise<void> {
    if (!this.workflowEngine) {
      return;
    }
    try {
      const update = await this.workflowEngine.getWorkflowProgress(workflowId);
      if (!update) {
        return;
      }
      this.logger.debug?.('Workflow progress update ready', {
        workflowId,
        status: update.workflow.status,
      });
      if (typeof this.agentOSOrchestrator?.broadcastWorkflowUpdate === 'function') {
        await this.agentOSOrchestrator.broadcastWorkflowUpdate(update);
      } else {
        this.logger.warn('Workflow update could not be broadcast - orchestrator unavailable', {
          workflowId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to generate workflow progress update', { workflowId, error });
    }
  }

  private async initializeTurnPlanner(): Promise<void> {
    const turnPlanningConfig = this.config.turnPlanning;
    if (turnPlanningConfig?.enabled === false) {
      this.turnPlanner = undefined;
      this.capabilityDiscoveryEngine = undefined;
      return;
    }

    let discoveryEngine: ICapabilityDiscoveryEngine | undefined =
      turnPlanningConfig?.discovery?.engine;

    if (!discoveryEngine && turnPlanningConfig?.discovery?.enabled !== false) {
      try {
        discoveryEngine = await this.initializeCapabilityDiscoveryEngine(turnPlanningConfig ?? {});
      } catch (error: any) {
        this.logger.warn(
          'Capability discovery initialization failed; planner will continue without discovery',
          {
            error: error?.message ?? error,
          }
        );
      }
    }

    this.turnPlanner = new AgentOSTurnPlanner(
      turnPlanningConfig,
      discoveryEngine,
      this.logger.child?.({ component: 'TurnPlanner' }) ?? this.logger
    );
    this.capabilityDiscoveryEngine = discoveryEngine;
    this.logger.info('AgentOS turn planner initialized', {
      discoveryEnabled: Boolean(discoveryEngine?.isInitialized?.()),
      defaultToolFailureMode: turnPlanningConfig?.defaultToolFailureMode ?? 'fail_open',
      defaultToolSelectionMode:
        turnPlanningConfig?.discovery?.defaultToolSelectionMode ?? 'discovered',
    });
  }

  private async initializeCapabilityDiscoveryEngine(
    turnPlanningConfig: AgentOSTurnPlanningConfig
  ): Promise<ICapabilityDiscoveryEngine | undefined> {
    const discoveryConfig = turnPlanningConfig.discovery;
    if (discoveryConfig?.enabled === false) {
      return undefined;
    }
    if (discoveryConfig?.autoInitializeEngine === false) {
      return undefined;
    }

    const defaultProvider =
      this.modelProviderManager.getDefaultProvider() ??
      this.modelProviderManager.getProvider(
        this.config.modelProviderManagerConfig.providers.find((p) => p.enabled)?.providerId || ''
      );
    const providerId = defaultProvider?.providerId;
    if (!providerId) {
      this.logger.warn('Capability discovery disabled: no model provider available');
      return undefined;
    }

    const embeddingDefaults = DISCOVERY_EMBEDDING_DEFAULTS[providerId];
    if (!embeddingDefaults) {
      this.logger.warn('Capability discovery disabled: no embedding defaults for provider', {
        providerId,
      });
      return undefined;
    }

    const embeddingModelId = discoveryConfig?.embeddingModelId ?? embeddingDefaults.modelId;
    const embeddingDimension = discoveryConfig?.embeddingDimension ?? embeddingDefaults.dimension;

    const embeddingManager = new EmbeddingManager();
    await embeddingManager.initialize(
      {
        embeddingModels: [
          {
            modelId: embeddingModelId,
            providerId,
            dimension: embeddingDimension,
            isDefault: true,
          },
        ],
        defaultModelId: embeddingModelId,
        enableCache: true,
        cacheMaxSize: 500,
        cacheTTLSeconds: 3600,
      },
      this.modelProviderManager
    );

    const vectorStore = new InMemoryVectorStore();
    await vectorStore.initialize({
      id: 'agentos-capability-discovery',
      type: 'in_memory',
    });

    const engine = new CapabilityDiscoveryEngine(
      embeddingManager,
      vectorStore,
      discoveryConfig?.config
    );
    const sources = this.buildCapabilityIndexSources(discoveryConfig?.sources);
    await engine.initialize(sources, discoveryConfig?.sources?.presetCoOccurrences);

    if (discoveryConfig?.registerMetaTool !== false) {
      const existing = await this.toolOrchestrator.getTool('discover_capabilities');
      if (!existing) {
        await this.toolOrchestrator.registerTool(createDiscoverCapabilitiesTool(engine));
      }
    }

    this.discoveryEmbeddingManager = embeddingManager;
    this.discoveryVectorStore = vectorStore;

    this.logger.info('Capability discovery engine initialized', {
      providerId,
      embeddingModelId,
      indexedCapabilities: engine.listCapabilityIds().length,
    });

    return engine;
  }

  private buildCapabilityIndexSources(
    overrides?: AgentOSCapabilityDiscoverySources
  ): CapabilityIndexSources {
    const titleCase = (value: string): string =>
      value
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const toolRegistry = this.extensionManager.getRegistry<ITool>(EXTENSION_KIND_TOOL);
    const runtimeTools = new Map<string, ITool>();
    for (const tool of toolRegistry
      .listActive()
      .map((descriptor) => descriptor.payload)
      .filter(Boolean)) {
      runtimeTools.set(tool.name, tool);
    }
    for (const tool of adaptTools(this.config.tools)) {
      runtimeTools.set(tool.name, tool);
    }
    const tools: NonNullable<CapabilityIndexSources['tools']> = Array.from(
      runtimeTools.values()
    ).map((tool) => ({
      id: tool.id || `tool:${tool.name}`,
      name: tool.name,
      displayName: tool.displayName || titleCase(tool.name),
      description: tool.description || '',
      category: tool.category || 'general',
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      requiredCapabilities: tool.requiredCapabilities,
      hasSideEffects: tool.hasSideEffects,
    }));

    const loadedPacks = this.extensionManager.listLoadedPacks();
    const packExtensions: NonNullable<CapabilityIndexSources['extensions']> = loadedPacks.map(
      (pack) => ({
        id: `extension:${pack.key}`,
        name: pack.name,
        displayName: titleCase(pack.name),
        description: `Extension pack${pack.version ? ` v${pack.version}` : ''}`,
        category: 'extensions',
        available: true,
      })
    );

    const workflowRegistry =
      this.extensionManager.getRegistry<WorkflowDescriptorPayload>(EXTENSION_KIND_WORKFLOW);
    const workflowExtensions: NonNullable<CapabilityIndexSources['extensions']> = workflowRegistry
      .listActive()
      .map((descriptor) => ({
        id: `workflow:${descriptor.payload.definition.id}`,
        name: descriptor.payload.definition.id,
        displayName:
          descriptor.payload.definition.displayName || titleCase(descriptor.payload.definition.id),
        description: descriptor.payload.definition.description || 'Workflow automation capability',
        category: 'workflow',
        requiredSecrets: descriptor.payload.definition.metadata?.requiredSecrets,
        available: true,
      }));

    const messagingRegistry = this.extensionManager.getRegistry<MessagingChannelPayload>(
      EXTENSION_KIND_MESSAGING_CHANNEL
    );
    const channels: NonNullable<CapabilityIndexSources['channels']> = messagingRegistry
      .listActive()
      .map((descriptor) => descriptor.payload)
      .filter(Boolean)
      .map((channel) => ({
        platform: channel.platform,
        displayName: channel.displayName || titleCase(channel.platform),
        description: `${channel.displayName || titleCase(channel.platform)} messaging channel`,
        capabilities: Array.isArray(channel.capabilities)
          ? channel.capabilities.map((cap) => String(cap))
          : [],
      }));

    return {
      tools,
      extensions: [...packExtensions, ...workflowExtensions, ...(overrides?.extensions ?? [])],
      channels: [...channels, ...(overrides?.channels ?? [])],
      skills: overrides?.skills,
      manifests: overrides?.manifests,
    };
  }

  private getActiveGuardrailServices(): IGuardrailService[] {
    const services: IGuardrailService[] = [];

    if (this.extensionManager) {
      const registry =
        this.extensionManager.getRegistry<IGuardrailService>(EXTENSION_KIND_GUARDRAIL);
      services.push(...registry.listActive().map((descriptor) => descriptor.payload));
    }

    if (this.guardrailService && !services.includes(this.guardrailService)) {
      services.push(this.guardrailService);
    }

    return services;
  }

  private async ensureUtilityAIService(): Promise<void> {
    if (this.utilityAIService) {
      return;
    }
    if (this.config.utilityAIService) {
      this.utilityAIService = this.config.utilityAIService;
      return;
    }
    this.utilityAIService = await this.buildDefaultUtilityAI();
  }

  private async buildDefaultUtilityAI(): Promise<IUtilityAI & IPromptEngineUtilityAI> {
    const fallbackUtility = new LLMUtilityAI();
    const defaultProviderId =
      this.config.gmiManagerConfig.defaultGMIBaseConfigDefaults?.defaultLlmProviderId ||
      this.config.modelProviderManagerConfig.providers[0]?.providerId ||
      'openai';
    const defaultModelId =
      this.config.gmiManagerConfig.defaultGMIBaseConfigDefaults?.defaultLlmModelId || 'gpt-4o';

    await fallbackUtility.initialize({
      llmProviderManager: this.modelProviderManager,
      defaultProviderId,
      defaultModelId,
    });
    return fallbackUtility;
  }

  /**
   * Ensures that the `AgentOS` service has been successfully initialized before
   * attempting to perform any operations.
   *
   * @private
   * @throws {AgentOSServiceError} If the service is not initialized, with `code`
   * set to `GMIErrorCode.NOT_INITIALIZED`.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new AgentOSServiceError(
        'AgentOS Service is not initialized. Please call and await the initialize() method before attempting operations.',
        GMIErrorCode.NOT_INITIALIZED,
        { serviceName: 'AgentOS', operationAttemptedWhileUninitialized: true }
      );
    }
  }

  public async getRuntimeSnapshot(): Promise<AgentOSRuntimeSnapshot> {
    this.ensureInitialized();

    const activeConversations =
      (this.conversationManager as any)?.activeConversations instanceof Map
        ? Array.from(
            (
              (this.conversationManager as any).activeConversations as Map<
                string,
                ConversationContext
              >
            ).values()
          )
        : [];

    const conversationItems: AgentOSActiveConversationSnapshot[] = activeConversations.map(
      (context) => {
        const history = context.getHistory();
        const lastActiveAt = history.reduce((latest, message) => {
          const timestamp = typeof message.timestamp === 'number' ? message.timestamp : 0;
          return Math.max(latest, timestamp);
        }, 0);

        return {
          sessionId: context.sessionId,
          userId: context.getMetadata('userId'),
          gmiInstanceId: context.getMetadata('gmiInstanceId'),
          activePersonaId: context.getMetadata('activePersonaId'),
          createdAt: context.createdAt,
          lastActiveAt: lastActiveAt || context.getMetadata('_lastAccessed'),
          messageCount: history.length,
        };
      }
    );

    const gmiItems: AgentOSActiveGMISnapshot[] = [];
    for (const gmi of this.gmiManager.activeGMIs.values()) {
      const cognitiveMemory = gmi.getCognitiveMemoryManager?.();
      const workingMemorySnapshot = await gmi.getWorkingMemorySnapshot().catch(() => ({}));
      const prospectiveCount = cognitiveMemory?.listProspective
        ? (await cognitiveMemory.listProspective().catch(() => [])).length
        : 0;

      gmiItems.push({
        gmiId: gmi.gmiId,
        personaId: gmi.getPersona().id,
        state: gmi.getCurrentState(),
        createdAt: gmi.creationTimestamp.toISOString(),
        hasCognitiveMemory: Boolean(cognitiveMemory),
        reasoningTraceEntries: gmi.getReasoningTrace().entries.length,
        workingMemoryKeys: Object.keys(workingMemorySnapshot).length,
        cognitiveMemory: cognitiveMemory
          ? {
              totalTraces: cognitiveMemory.getStore().getTraceCount(),
              activeTraces: cognitiveMemory.getStore().getActiveTraceCount(),
              workingMemorySlots: cognitiveMemory.getWorkingMemory().getSlotCount(),
              workingMemoryCapacity: cognitiveMemory.getWorkingMemory().getCapacity(),
              prospectiveCount,
            }
          : undefined,
      });
    }

    const providerIds = this.config.modelProviderManagerConfig.providers
      .filter((provider) => provider.enabled !== false)
      .map((provider) => provider.providerId);
    const toolRegistry = this.extensionManager.getRegistry<ITool>(EXTENSION_KIND_TOOL);
    const workflowRegistry =
      this.extensionManager.getRegistry<WorkflowDescriptorPayload>(EXTENSION_KIND_WORKFLOW);
    const guardrailRegistry =
      this.extensionManager.getRegistry<IGuardrailService>(EXTENSION_KIND_GUARDRAIL);

    return {
      initialized: this.initialized,
      services: {
        conversationManager: Boolean(this.conversationManager),
        extensionManager: Boolean(this.extensionManager),
        toolOrchestrator: Boolean(this.toolOrchestrator),
        modelProviderManager: Boolean(this.modelProviderManager),
        retrievalAugmentor: Boolean(this.retrievalAugmentor),
        workflowEngine: Boolean(this.workflowEngine),
      },
      providers: {
        configured: providerIds,
        defaultProvider: this.modelProviderManager.getDefaultProvider()?.providerId ?? null,
      },
      extensions: {
        loadedPacks: this.extensionManager.listLoadedPacks().map((pack) => pack.key),
        toolCount: toolRegistry.listActive().length,
        workflowCount: workflowRegistry.listActive().length,
        guardrailCount: guardrailRegistry.listActive().length,
      },
      conversations: {
        activeCount: conversationItems.length,
        items: conversationItems,
      },
      gmis: {
        activeCount: gmiItems.length,
        items: gmiItems,
      },
    };
  }

  public getConversationManager(): ConversationManager {
    this.ensureInitialized();
    return this.conversationManager;
  }

  public getGMIManager(): GMIManager {
    this.ensureInitialized();
    return this.gmiManager;
  }

  public getExtensionManager(): ExtensionManager {
    this.ensureInitialized();
    return this.extensionManager;
  }

  public getToolOrchestrator(): IToolOrchestrator {
    this.ensureInitialized();
    return this.toolOrchestrator;
  }

  public getExternalToolRegistry(): ExternalToolRegistry | undefined {
    this.ensureInitialized();
    return this.config.externalTools;
  }

  public listExternalToolsForLLM(): ToolDefinitionForLLM[] {
    this.ensureInitialized();
    return listExternalToolDefinitionsForLLM(this.config.externalTools);
  }

  public getModelProviderManager(): AIModelProviderManager {
    this.ensureInitialized();
    return this.modelProviderManager;
  }

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
  public async *processRequest(
    input: AgentOSInput
  ): AsyncGenerator<AgentOSResponse, void, undefined> {
    this.ensureInitialized();
    // Authentication and detailed authorization would typically happen here or be delegated.
    // For example:
    // if (!await this.authService.isUserAuthenticated(input.sessionId, input.userId)) {
    //   throw new AgentOSServiceError("User not authenticated.", GMIErrorCode.AUTHENTICATION_REQUIRED);
    // }

    const effectivePersonaId = input.selectedPersonaId || this.config.defaultPersonaId;

    const guardrailContext: GuardrailContext = {
      userId: input.userId,
      sessionId: input.sessionId,
      personaId: effectivePersonaId,
      conversationId: input.conversationId,
      metadata: input.options?.customFlags,
    };

    const guardrailServices = this.getActiveGuardrailServices();

    const guardrailReadyInput: AgentOSInput = {
      ...input,
      selectedPersonaId: effectivePersonaId,
    };

    const guardrailInputOutcome = await evaluateInputGuardrails(
      guardrailServices,
      guardrailReadyInput,
      guardrailContext
    );

    const blockingEvaluation =
      guardrailInputOutcome.evaluation ?? guardrailInputOutcome.evaluations?.at(-1) ?? null;

    if (blockingEvaluation?.action === GuardrailAction.BLOCK) {
      const streamId =
        guardrailReadyInput.sessionId || (`agentos-guardrail-${Date.now()}` as StreamId);
      const blockedStream = createGuardrailBlockedStream(guardrailContext, blockingEvaluation, {
        streamId,
        personaId: effectivePersonaId,
      });
      for await (const chunk of blockedStream) {
        yield chunk;
      }
      return;
    }

    const orchestratorInput: AgentOSInput = this.applySelfImprovementSessionOverrides({
      ...guardrailInputOutcome.sanitizedInput,
      selectedPersonaId: effectivePersonaId,
      skillPromptContext: this.buildSelfImprovementSkillPromptContext(
        guardrailInputOutcome.sanitizedInput.sessionId,
      ),
      disabledSessionSkillIds: this.listSelfImprovementDisabledSkillIds(
        this.buildSelfImprovementSessionRuntimeKey(guardrailInputOutcome.sanitizedInput.sessionId),
      ),
    });
    // Language negotiation (non-blocking)
    let languageNegotiation: any = null;
    if (this.languageService && this.config.languageConfig) {
      try {
        languageNegotiation = this.languageService.negotiate({
          explicitUserLanguage: orchestratorInput.languageHint,
          detectedLanguages: orchestratorInput.detectedLanguages,
          conversationPreferred: undefined,
          personaDefault: undefined,
          configDefault: this.config.languageConfig.defaultLanguage,
          supported: this.config.languageConfig.supportedLanguages,
          fallbackChain: this.config.languageConfig.fallbackLanguages || [
            this.config.languageConfig.defaultLanguage,
          ],
          preferSourceLanguageResponses: this.config.languageConfig.preferSourceLanguageResponses,
          targetLanguage: orchestratorInput.targetLanguage,
        } as any);
      } catch (negErr: any) {
        this.logger.warn('Language negotiation failed', { error: negErr?.message || negErr });
      }
    }
    const baseStreamDebugId = orchestratorInput.sessionId || `agentos-req-${Date.now()}`;
    this.logger.debug?.('processRequest invoked', {
      userId: orchestratorInput.userId,
      sessionId: orchestratorInput.sessionId,
      personaId: orchestratorInput.selectedPersonaId,
    });

    let streamIdToListen: StreamId | undefined;
    // Temporary client bridge to adapt push-based StreamingManager to pull-based AsyncGenerator
    const bridge = new AsyncStreamClientBridge(`client-processReq-${baseStreamDebugId}`);

    try {
      this.logger.debug?.('Registering streaming bridge for request', {
        userId: orchestratorInput.userId,
        sessionId: orchestratorInput.sessionId,
      });

      // The orchestrator creates/manages the actual stream and starts pushing chunks to StreamingManager.
      // We get the streamId it uses so our bridge can listen to it.
      streamIdToListen = await this.agentOSOrchestrator.orchestrateTurn({
        ...orchestratorInput,
        languageNegotiation,
      } as any);
      await this.streamingManager.registerClient(streamIdToListen, bridge);
      this.logger.debug?.('Bridge registered', { bridgeId: bridge.id, streamId: streamIdToListen });

      const guardrailWrappedStream = wrapOutputGuardrails(
        guardrailServices,
        guardrailContext,
        bridge.consume(),
        {
          streamId: streamIdToListen!,
          personaId: effectivePersonaId,
          inputEvaluations: guardrailInputOutcome.evaluations ?? [],
        }
      );
      if (orchestratorInput.workflowRequest) {
        const wfRequest = orchestratorInput.workflowRequest;
        try {
          await this.startWorkflow(wfRequest.definitionId, orchestratorInput, {
            workflowId: wfRequest.workflowId,
            conversationId:
              wfRequest.conversationId ??
              orchestratorInput.conversationId ??
              orchestratorInput.sessionId,
            createdByUserId: orchestratorInput.userId,
            context: wfRequest.context,
            roleAssignments: wfRequest.roleAssignments,
            metadata: wfRequest.metadata,
          });
        } catch (error) {
          this.logger.error('Failed to start workflow from request payload', {
            workflowDefinitionId: wfRequest.definitionId,
            conversationId: wfRequest.conversationId ?? orchestratorInput.conversationId,
            error,
          });
        }
      }

      // Yield chunks from the guardrail-wrapped stream
      for await (const chunk of guardrailWrappedStream) {
        if (languageNegotiation) {
          if (!chunk.metadata) chunk.metadata = {};
          chunk.metadata.language = languageNegotiation;
        }
        yield chunk;
        if (isActionableToolCallRequestChunk(chunk)) {
          break;
        }
        if (chunk.isFinal && chunk.type !== AgentOSResponseChunkType.ERROR) {
          // If a non-error chunk is final, the primary interaction part might be done.
          // The stream itself might remain open for a short while for cleanup or late messages.
          // The bridge's consume() will end when notifyStreamClosed is called.
          break;
        }
      }
    } catch (error: unknown) {
      const serviceError = AgentOSServiceError.wrap(
        error,
        GMIErrorCode.GMI_PROCESSING_ERROR, // Default code for facade-level processing errors
        `Error during AgentOS.processRequest for user '${orchestratorInput.userId}'`,
        'AgentOS.processRequest'
      );
      this.logger.error('processRequest failed', {
        error: serviceError,
        streamId: streamIdToListen,
      });

      const errorChunk: AgentOSErrorChunk = {
        type: AgentOSResponseChunkType.ERROR,
        streamId: streamIdToListen || baseStreamDebugId, // Use known streamId if available
        gmiInstanceId: (serviceError.details as any)?.gmiInstanceId || 'agentos_facade_error',
        personaId: effectivePersonaId,
        isFinal: true,
        timestamp: new Date().toISOString(),
        code: serviceError.code.toString(),
        message: serviceError.message, // Use the wrapped error's message
        details: serviceError.details || { name: serviceError.name, stack: serviceError.stack },
      };
      yield errorChunk; // Yield the processed error
    } finally {
      if (streamIdToListen) {
        const activeStreamIds = await this.streamingManager
          .getActiveStreamIds()
          .catch(() => [] as string[]);
        if (activeStreamIds.includes(streamIdToListen)) {
          await this.streamingManager
            .deregisterClient(streamIdToListen, bridge.id)
            .catch((deregError) => {
              this.logger.warn('Failed to deregister bridge client', {
                bridgeId: bridge.id,
                streamId: streamIdToListen,
                error: (deregError as Error).message,
              });
            });
        }
      }
      bridge.forceClose(); // Ensure the bridge generator also terminates
    }
  }

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
  public async *handleToolResult(
    streamId: StreamId,
    toolCallId: string,
    toolName: string,
    toolOutput: any,
    isSuccess: boolean,
    errorMessage?: string
  ): AsyncGenerator<AgentOSResponse, void, undefined> {
    yield* this.handleToolResults(streamId, [
      {
        toolCallId,
        toolName,
        toolOutput,
        isSuccess,
        errorMessage,
      },
    ]);
  }

  public async *handleToolResults(
    streamId: StreamId,
    toolResults: AgentOSToolResultInput[]
  ): AsyncGenerator<AgentOSResponse, void, undefined> {
    this.ensureInitialized();
    if (!Array.isArray(toolResults) || toolResults.length === 0) {
      throw new AgentOSServiceError(
        'At least one tool result is required to continue the stream.',
        GMIErrorCode.VALIDATION_ERROR,
        { streamId },
        'AgentOS.handleToolResults'
      );
    }

    // Create a new bridge client for this specific tool result handling phase
    const bridge = new AsyncStreamClientBridge(
      `client-toolRes-${streamId.substring(0, 8)}-${toolResults[0]!.toolCallId.substring(0, 8)}`
    );

    try {
      console.log(
        `AgentOS.handleToolResults: Stream '${streamId}', ${toolResults.length} tool result(s). Orchestrator will push new chunks to this stream.`
      );

      // Register the bridge client to listen for new chunks on the existing stream
      await this.streamingManager.registerClient(streamId, bridge);
      console.log(
        `AgentOS.handleToolResults: Bridge client ${bridge.id} registered to stream ${streamId}.`
      );

      // This call is `async Promise<void>`; it triggers the orchestrator to process the tool result(s)
      // and push new chunks to the StreamingManager for the given streamId.
      await this.agentOSOrchestrator.orchestrateToolResults(streamId, toolResults);

      // Yield new chunks received by our bridge client on the same stream
      for await (const chunk of bridge.consume()) {
        yield chunk;
        if (isActionableToolCallRequestChunk(chunk)) {
          break;
        }
        if (chunk.isFinal && chunk.type !== AgentOSResponseChunkType.ERROR) {
          break;
        }
      }
    } catch (error: unknown) {
      const serviceError = AgentOSServiceError.wrap(
        error,
        GMIErrorCode.TOOL_ERROR, // Default code for facade-level tool result errors
        `Error during AgentOS.handleToolResults for stream '${streamId}'`,
        'AgentOS.handleToolResults'
      );
      console.error(`${serviceError.name}: ${serviceError.message}`, serviceError.toJSON());

      const errorChunk: AgentOSErrorChunk = {
        type: AgentOSResponseChunkType.ERROR,
        streamId: streamId,
        gmiInstanceId: (serviceError.details as any)?.gmiInstanceId || 'agentos_facade_tool_error',
        personaId: (serviceError.details as any)?.personaId || 'unknown_tool_persona',
        isFinal: true,
        timestamp: new Date().toISOString(),
        code: serviceError.code.toString(),
        message: serviceError.message,
        details: serviceError.details || { name: serviceError.name, stack: serviceError.stack },
      };
      yield errorChunk;
    } finally {
      console.log(
        `AgentOS.handleToolResults: Deregistering bridge client ${bridge.id} from stream ${streamId}.`
      );
      const activeStreamIds = await this.streamingManager
        .getActiveStreamIds()
        .catch(() => [] as string[]);
      if (activeStreamIds.includes(streamId)) {
        await this.streamingManager.deregisterClient(streamId, bridge.id).catch((deregError) => {
          console.error(
            `AgentOS.handleToolResults: Error deregistering bridge client ${bridge.id}: ${(deregError as Error).message}`
          );
        });
      }
      bridge.forceClose();
    }
  }

  public listWorkflowDefinitions(): WorkflowDefinition[] {
    this.ensureInitialized();
    return this.workflowEngine.listWorkflowDefinitions();
  }

  public async startWorkflow(
    definitionId: string,
    input: AgentOSInput,
    options: {
      workflowId?: string;
      conversationId?: string;
      createdByUserId?: string;
      context?: Record<string, unknown>;
      roleAssignments?: Record<string, string>;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<WorkflowInstance> {
    this.ensureInitialized();
    const definition = this.workflowEngine
      .listWorkflowDefinitions()
      .find((item) => item.id === definitionId);
    if (!definition) {
      throw new AgentOSServiceError(
        `Workflow definition '${definitionId}' not found.`,
        GMIErrorCode.CONFIGURATION_ERROR,
        { definitionId }
      );
    }
    return this.workflowEngine.startWorkflow({
      input,
      definition,
      workflowId: options.workflowId,
      conversationId: options.conversationId,
      createdByUserId: options.createdByUserId,
      context: options.context,
      roleAssignments: options.roleAssignments,
      metadata: options.metadata,
    });
  }

  public async getWorkflow(workflowId: string): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    return this.workflowEngine.getWorkflow(workflowId);
  }

  public async listWorkflows(options?: WorkflowQueryOptions): Promise<WorkflowInstance[]> {
    this.ensureInitialized();
    return this.workflowEngine.listWorkflows(options);
  }

  public async getWorkflowProgress(
    workflowId: string,
    sinceTimestamp?: string
  ): Promise<WorkflowProgressUpdate | null> {
    this.ensureInitialized();
    return this.workflowEngine.getWorkflowProgress(workflowId, sinceTimestamp);
  }

  public async updateWorkflowStatus(
    workflowId: string,
    status: WorkflowStatus
  ): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    return this.workflowEngine.updateWorkflowStatus(workflowId, status);
  }

  public async applyWorkflowTaskUpdates(
    workflowId: string,
    updates: WorkflowTaskUpdate[]
  ): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    return this.workflowEngine.applyTaskUpdates(workflowId, updates);
  }

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
  public async listAvailablePersonas(userId?: string): Promise<Partial<IPersonaDefinition>[]> {
    this.ensureInitialized();
    console.log(
      `AgentOS.listAvailablePersonas: Request for UserID: '${userId || 'anonymous/system'}'.`
    );
    try {
      return await this.gmiManager.listAvailablePersonas(userId);
    } catch (error: unknown) {
      throw AgentOSServiceError.wrap(
        error,
        GMIErrorCode.PERSONA_LOAD_ERROR,
        'Failed to list available personas',
        'AgentOS.listAvailablePersonas'
      );
    }
  }

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
  public async getConversationHistory(
    conversationId: string,
    userId: string
  ): Promise<ConversationContext | null> {
    this.ensureInitialized();
    console.log(
      `AgentOS.getConversationHistory: Request for ConversationID '${conversationId}', UserID '${userId}'.`
    );

    // Authorization to access conversation history should be handled here or by the ConversationManager.
    // For example, using this.authService:
    // const canAccess = await this.authService.canUserAccessConversation(userId, conversationId);
    // if (!canAccess) {
    //   console.warn(`AgentOS.getConversationHistory: User '${userId}' denied access to conversation '${conversationId}'.`);
    //   throw new AgentOSServiceError("Access denied to conversation history.", GMIErrorCode.PERMISSION_DENIED, { userId, conversationId });
    //   // Or return null, depending on desired API behavior for permission failures.
    // }

    try {
      const context = await this.conversationManager.getConversation(conversationId);
      if (context) {
        // Verify ownership or access rights
        if (context.getMetadata('userId') === userId /* || check other access rules */) {
          return context;
        } else {
          console.warn(
            `AgentOS.getConversationHistory: User '${userId}' attempted to access conversation '${conversationId}' belonging to another user ('${context.getMetadata('userId')}').`
          );
          // Consider throwing PERMISSION_DENIED for explicit denial.
          return null;
        }
      }
      return null; // Conversation not found
    } catch (error: unknown) {
      throw AgentOSServiceError.wrap(
        error,
        GMIErrorCode.GMI_CONTEXT_ERROR,
        `Failed to retrieve conversation history for ID '${conversationId}'`,
        'AgentOS.getConversationHistory'
      );
    }
  }

  public async getPendingExternalToolRequest(
    conversationId: string,
    userId: string
  ): Promise<AgentOSPendingExternalToolRequest | null> {
    this.ensureInitialized();

    const context = await this.getConversationHistory(conversationId, userId);
    if (!context) {
      return null;
    }

    const pendingRequest = context.getMetadata(AGENTOS_PENDING_EXTERNAL_TOOL_REQUEST_METADATA_KEY);
    return pendingRequest ?? null;
  }

  public async *resumeExternalToolRequest(
    pendingRequest: AgentOSPendingExternalToolRequest,
    toolResults: AgentOSToolResultInput[],
    options: AgentOSResumeExternalToolRequestOptions = {}
  ): AsyncGenerator<AgentOSResponse, void, undefined> {
    this.ensureInitialized();

    let streamIdToListen: StreamId | undefined;
    let shouldDeregisterBridge = false;
    const bridge = new AsyncStreamClientBridge(
      `client-resumeToolReq-${pendingRequest.conversationId}-${Date.now()}`
    );

    try {
      streamIdToListen = await this.agentOSOrchestrator.orchestrateResumedToolResults(
        pendingRequest,
        toolResults,
        options
      );
      await this.streamingManager.registerClient(streamIdToListen, bridge);

      for await (const chunk of bridge.consume()) {
        yield chunk;
        if (isActionableToolCallRequestChunk(chunk)) {
          shouldDeregisterBridge = true;
          break;
        }
        if (chunk.isFinal && chunk.type !== AgentOSResponseChunkType.ERROR) {
          break;
        }
      }
    } catch (error: unknown) {
      const serviceError = AgentOSServiceError.wrap(
        error,
        GMIErrorCode.TOOL_ERROR,
        `Error during AgentOS.resumeExternalToolRequest for conversation '${pendingRequest.conversationId}'`,
        'AgentOS.resumeExternalToolRequest'
      );
      console.error(`${serviceError.name}: ${serviceError.message}`, serviceError.toJSON());

      const errorChunk: AgentOSErrorChunk = {
        type: AgentOSResponseChunkType.ERROR,
        streamId: streamIdToListen || pendingRequest.streamId,
        gmiInstanceId:
          (serviceError.details as any)?.gmiInstanceId ||
          pendingRequest.gmiInstanceId ||
          'agentos_facade_resume_error',
        personaId:
          (serviceError.details as any)?.personaId || pendingRequest.personaId || 'unknown_persona',
        isFinal: true,
        timestamp: new Date().toISOString(),
        code: serviceError.code.toString(),
        message: serviceError.message,
        details: serviceError.details || { name: serviceError.name, stack: serviceError.stack },
      };
      yield errorChunk;
    } finally {
      if (streamIdToListen && shouldDeregisterBridge) {
        const activeStreamIds = await this.streamingManager
          .getActiveStreamIds()
          .catch(() => [] as string[]);
        if (activeStreamIds.includes(streamIdToListen)) {
          await this.streamingManager
            .deregisterClient(streamIdToListen, bridge.id)
            .catch((deregError) => {
              this.logger.warn('Failed to deregister resume bridge client', {
                bridgeId: bridge.id,
                streamId: streamIdToListen,
                error: (deregError as Error).message,
              });
            });
        }
      }
      bridge.forceClose();
    }
  }

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
  public async receiveFeedback(
    userId: string,
    sessionId: string,
    personaId: string,
    feedbackPayload: UserFeedbackPayload
  ): Promise<void> {
    this.ensureInitialized();
    // Basic authorization checks for the user can be performed here.
    // E.g., await this.authService.validateUserExists(userId);

    console.log(
      `AgentOS.receiveFeedback: UserID '${userId}', SessionID '${sessionId}', PersonaID '${personaId}'. Payload:`,
      JSON.stringify(feedbackPayload).substring(0, 200) + '...'
    );

    try {
      // Delegate feedback processing, typically to GMIManager or directly to the relevant GMI.
      await this.gmiManager.processUserFeedback(userId, sessionId, personaId, feedbackPayload);
      console.info(
        `AgentOS.receiveFeedback: Feedback processed successfully for UserID '${userId}', PersonaID '${personaId}'.`
      );
    } catch (error: unknown) {
      throw AgentOSServiceError.wrap(
        error,
        GMIErrorCode.GMI_FEEDBACK_ERROR,
        'Failed to process user feedback',
        'AgentOS.receiveFeedback'
      );
    }
  }

  /**
   * Initiates a graceful shutdown of the `AgentOS` service and all its components.
   * This includes shutting down managers, clearing caches, and releasing resources.
   *
   * @public
   * @async
   * @returns {Promise<void>} A promise that resolves when the shutdown sequence is complete.
   * @throws {AgentOSServiceError} If an error occurs during the shutdown of any critical component.
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      console.warn(
        'AgentOS Service is already shut down or was never initialized. Shutdown call is a no-op.'
      );
      return;
    }
    console.log('AgentOS Service: Initiating graceful shutdown sequence...');

    // Order of shutdown can be important:
    // 1. Orchestrator (stops new complex operations)
    // 2. GMI Manager (stops GMI activities)
    // 3. Streaming Manager (closes active client connections)
    // 4. Other services (ConversationManager, ToolOrchestrator, PromptEngine, ModelProviderManager)
    try {
      if (this.workflowEngineListener && this.workflowEngine) {
        this.workflowEngine.offEvent(this.workflowEngineListener);
        this.workflowEngineListener = undefined;
      }
      if (this.workflowExtensionListener && this.extensionManager) {
        this.extensionManager.off(this.workflowExtensionListener);
        this.workflowExtensionListener = undefined;
      }

      if (this.workflowRuntime) {
        await this.workflowRuntime.stop();
        this.workflowRuntime = undefined;
      }
      this.agencyRegistry = undefined;
      if (this.agentOSOrchestrator?.shutdown) {
        await this.agentOSOrchestrator.shutdown();
        console.log('AgentOS: AgentOSOrchestrator shut down.');
      }
      if (this.gmiManager?.shutdown) {
        await this.gmiManager.shutdown();
        console.log('AgentOS: GMIManager shut down.');
      }
      if (this.streamingManager?.shutdown) {
        await this.streamingManager.shutdown();
        console.log('AgentOS: StreamingManager shut down.');
      }
      if (
        this.conversationManager?.shutdown &&
        typeof this.conversationManager.shutdown === 'function'
      ) {
        await this.conversationManager.shutdown();
        console.log('AgentOS: ConversationManager shut down.');
      }
      if (this.toolOrchestrator && typeof (this.toolOrchestrator as any).shutdown === 'function') {
        await (this.toolOrchestrator as any).shutdown();
        console.log('AgentOS: ToolOrchestrator shut down.');
      }
      if (this.discoveryVectorStore?.shutdown) {
        await this.discoveryVectorStore.shutdown();
        this.discoveryVectorStore = undefined;
      }
      if (this.discoveryEmbeddingManager?.shutdown) {
        await this.discoveryEmbeddingManager.shutdown();
        this.discoveryEmbeddingManager = undefined;
      }
      this.turnPlanner = undefined;
      if (this.manageRetrievalAugmentorLifecycle && this.retrievalAugmentor?.shutdown) {
        await this.retrievalAugmentor.shutdown();
        console.log('AgentOS: RetrievalAugmentor shut down.');
      }
      if (
        this.manageRetrievalAugmentorLifecycle &&
        this.ragVectorStoreManager?.shutdownAllProviders
      ) {
        await this.ragVectorStoreManager.shutdownAllProviders();
        console.log('AgentOS: VectorStore providers shut down.');
      }
      // PromptEngine might have a cleanup method like clearCache
      if (this.promptEngine && typeof this.promptEngine.clearCache === 'function') {
        await this.promptEngine.clearCache();
        console.log('AgentOS: PromptEngine cache cleared.');
      }
      if (this.modelProviderManager?.shutdown) {
        await this.modelProviderManager.shutdown();
        console.log('AgentOS: AIModelProviderManager shut down.');
      }
      if (this.extensionManager?.shutdown) {
        await this.extensionManager.shutdown({ logger: this.logger });
        console.log('AgentOS: ExtensionManager shut down.');
      }
      for (const closeMemory of this.managedStandaloneMemoryClosers) {
        await closeMemory();
      }
      this.managedStandaloneMemoryClosers = [];
      // Other services like authService, subscriptionService, prisma might not have explicit async shutdown methods
      // if they manage connections passively or are handled by process exit.

      console.log('AgentOS Service: Graceful shutdown completed successfully.');
    } catch (error: unknown) {
      // Even if one component fails to shut down, attempt to log and continue if possible,
      // but report the overall failure.
      const serviceError = AgentOSServiceError.wrap(
        error,
        GMIErrorCode.GMI_SHUTDOWN_ERROR,
        'Error during AgentOS service shutdown sequence',
        'AgentOS.shutdown'
      );
      console.error(`${serviceError.name}: ${serviceError.message}`, serviceError.toJSON());
      throw serviceError; // Re-throw to indicate shutdown was problematic.
    } finally {
      this.initialized = false; // Mark as uninitialized regardless of shutdown errors.
    }
  }

  private async initializeRagSubsystem(storageAdapter?: StorageAdapter): Promise<void> {
    // Prefer caller-provided augmentor instance.
    if (this.config.retrievalAugmentor) {
      this.retrievalAugmentor = this.config.retrievalAugmentor;
      this.manageRetrievalAugmentorLifecycle =
        this.config.manageRetrievalAugmentorLifecycle === true;
      return;
    }

    const ragConfig = this.config.ragConfig;
    if (!ragConfig || ragConfig.enabled === false) {
      return;
    }

    try {
      const { EmbeddingManager } = await import('../rag/EmbeddingManager');
      const { VectorStoreManager } = await import('../rag/VectorStoreManager');
      const { RetrievalAugmentor } = await import('../rag/RetrievalAugmentor');

      const embeddingManager = new EmbeddingManager();
      await embeddingManager.initialize(
        ragConfig.embeddingManagerConfig,
        this.modelProviderManager
      );

      const bindToStorageAdapter =
        ragConfig.bindToStorageAdapter === undefined
          ? true
          : ragConfig.bindToStorageAdapter === true;

      const patchedVectorStoreConfig: VectorStoreManagerConfig = {
        ...ragConfig.vectorStoreManagerConfig,
        providers: ragConfig.vectorStoreManagerConfig.providers.map((provider) => {
          if (
            bindToStorageAdapter &&
            storageAdapter &&
            (provider as any)?.type === 'sql' &&
            !(provider as any).adapter &&
            !(provider as any).storage
          ) {
            return { ...(provider as any), adapter: storageAdapter };
          }
          return provider;
        }),
      };

      const vectorStoreManager = new VectorStoreManager();
      await vectorStoreManager.initialize(patchedVectorStoreConfig, ragConfig.dataSourceConfigs);

      const retrievalAugmentor = new RetrievalAugmentor();
      await retrievalAugmentor.initialize(
        ragConfig.retrievalAugmentorConfig,
        embeddingManager,
        vectorStoreManager
      );

      this.retrievalAugmentor = retrievalAugmentor;
      this.ragVectorStoreManager = vectorStoreManager;
      this.manageRetrievalAugmentorLifecycle = ragConfig.manageLifecycle !== false;
      console.log('AgentOS: RAG subsystem initialized.');
    } catch (error: any) {
      this.logger.error(
        'AgentOS: Failed to initialize RAG subsystem; continuing without retrieval augmentor.',
        {
          error: error?.message ?? error,
        }
      );
    }
  }
}

// Imported from extracted module
import { AsyncStreamClientBridge } from '../core/streaming/AsyncStreamClientBridge';

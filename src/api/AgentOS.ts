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
 * @see {@link ./interfaces/IAgentOS.ts} for the `IAgentOS` interface contract.
 * @see {@link ./AgentOSOrchestrator.ts} for the orchestration logic.
 * @see {@link ../cognitive_substrate/GMIManager.ts} for GMI lifecycle management.
 * @see {@link ../core/streaming/StreamingManager.ts} for real-time data streaming.
 * @see {@link @framers/agentos/utils/errors.ts} for custom error definitions.
 */

import { IAgentOS } from './interfaces/IAgentOS';
import { AgentOSInput, UserFeedbackPayload } from './types/AgentOSInput';
import { AgentOSResponse, AgentOSErrorChunk, AgentOSResponseChunkType } from './types/AgentOSResponse';
import { AgentOSOrchestrator, AgentOSOrchestratorDependencies, AgentOSOrchestratorConfig } from './AgentOSOrchestrator';
import { GMIManager, GMIManagerConfig } from '../cognitive_substrate/GMIManager';
import { AIModelProviderManager, AIModelProviderManagerConfig } from '../core/llm/providers/AIModelProviderManager';
import { PromptEngine } from '../core/llm/PromptEngine';
import { PromptEngineConfig, IPromptEngineUtilityAI } from '../core/llm/IPromptEngine';
import type { ITool } from '../core/tools/ITool';
import { IToolOrchestrator } from '../core/tools/IToolOrchestrator';
import { ToolOrchestratorConfig } from '../config/ToolOrchestratorConfig';
import { ToolOrchestrator } from '../core/tools/ToolOrchestrator';
import { ToolExecutor } from '../core/tools/ToolExecutor';
import { IToolPermissionManager, ToolPermissionManagerConfig } from '../core/tools/permissions/IToolPermissionManager';
import { ToolPermissionManager } from '../core/tools/permissions/ToolPermissionManager';
import type { IAuthService, ISubscriptionService } from '../services/user_auth/types';
import type { IHumanInteractionManager } from '../core/hitl/IHumanInteractionManager';
import { IUtilityAI } from '../core/ai_utilities/IUtilityAI';
import { LLMUtilityAI } from '../core/ai_utilities/LLMUtilityAI';
import { ConversationManager, ConversationManagerConfig } from '../core/conversation/ConversationManager';
import { ConversationContext } from '../core/conversation/ConversationContext';
import type { IRollingSummaryMemorySink } from '../core/conversation/IRollingSummaryMemorySink';
import type { ILongTermMemoryRetriever } from '../core/conversation/ILongTermMemoryRetriever';
import type { IRetrievalAugmentor } from '../rag/IRetrievalAugmentor';
import type { IVectorStoreManager } from '../rag/IVectorStoreManager';
import type { EmbeddingManagerConfig } from '../config/EmbeddingManagerConfiguration';
import type { RetrievalAugmentorServiceConfig } from '../config/RetrievalAugmentorConfiguration';
import type { RagDataSourceConfig, VectorStoreManagerConfig } from '../config/VectorStoreConfiguration';
import type { PrismaClient } from '@prisma/client';
import type { StorageAdapter } from '@framers/sql-storage-adapter';
import { IPersonaDefinition } from '../cognitive_substrate/personas/IPersonaDefinition';
import { StreamingManager, StreamingManagerConfig, StreamId } from '../core/streaming/StreamingManager';
import { IStreamClient, StreamClientId } from '../core/streaming/IStreamClient';
import { GMIError, GMIErrorCode } from '@framers/agentos/utils/errors';
import { uuidv4 } from '@framers/agentos/utils/uuid';
import { ILogger } from '../logging/ILogger';
import { createLogger } from '../logging/loggerFactory';
import { configureAgentOSObservability, type AgentOSObservabilityConfig } from '../core/observability/otel';
import type { IGuardrailService, GuardrailContext } from '../core/guardrails/IGuardrailService';
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
  EXTENSION_KIND_PROVENANCE,
  EXTENSION_KIND_TOOL,
  EXTENSION_KIND_WORKFLOW,
  type ExtensionLifecycleContext,
  type ExtensionManifest,
  type ExtensionOverrides,
  type ExtensionEvent,
  type ExtensionEventListener,
} from '../extensions';
import { createSchemaOnDemandPack } from '../extensions/packs/schema-on-demand-pack.js';
import { WorkflowRuntime } from '../core/workflows/runtime/WorkflowRuntime';
import { AgencyRegistry } from '../core/agency/AgencyRegistry';
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
  onAfterWrite?: (context: StorageWriteHookContext, result: { changes: number; lastInsertRowid?: unknown }) => Promise<void>;
};

function wrapStorageAdapterWithWriteHooks(
  adapter: StorageAdapter,
  hooks: StorageWriteHooks,
  options?: { inTransaction?: boolean; logger?: ILogger },
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
      options?.logger?.error?.('[AgentOS][StorageHooks] onAfterWrite failed', { error: error?.message ?? error });
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
        const wrappedTrx = wrapStorageAdapterWithWriteHooks(trx, hooks, { inTransaction: true, logger: options?.logger });
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
              errors.push({ index: i, error: error instanceof Error ? error : new Error(String(error)) });
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
    prepare: adapter.prepare ? ((statement) => adapter.prepare!(statement)) : undefined,
  };
}

/**
 * @class AgentOSServiceError
 * @extends GMIError
 * @description Custom error class for errors specifically originating from the AgentOS service facade.
 * This class provides a standardized way to represent errors encountered within the `AgentOS` class,
 * inheriting common error properties from `GMIError` and setting a distinct error name.
 */
export class AgentOSServiceError extends GMIError {
  /**
   * Specifies the name of the error class, used for identification.
   * @public
   * @override
   * @readonly
   * @type {string}
   */
  public override readonly name: string = 'AgentOSServiceError';

  /**
   * Creates an instance of `AgentOSServiceError`.
   *
   * @param {string} message - A human-readable description of the error.
   * @param {GMIErrorCode | string} code - A specific error code, typically from `GMIErrorCode`,
   * identifying the nature of the error.
   * @param {any} [details] - Optional. Additional structured details or the underlying error
   * object that caused this service error.
   * @param {string} [componentOrigin] - Optional. The name of the component or sub-module within
   * AgentOS where the error originated or was detected. This helps in pinpointing the error's source.
   */
  constructor(message: string, code: GMIErrorCode | string, details?: any, componentOrigin?: string) {
    super(message, code as GMIErrorCode, details, componentOrigin);
    // Ensure `name` is set correctly after super call, overriding GMIError's default if any.
    // The `readonly name` field declaration handles this, but this assignment is idiomatic.
    // Object.setPrototypeOf is crucial for ensuring `instanceof` works correctly with custom errors.
    Object.setPrototypeOf(this, AgentOSServiceError.prototype);
  }

  /**
   * Wraps an existing error object (which could be of any type) within a new `AgentOSServiceError` instance.
   * This is useful for standardizing errors caught from lower layers or external libraries.
   *
   * @public
   * @static
   * @override
   * @param {any} error - The original error object to wrap.
   * @param {GMIErrorCode | string} code - The `GMIErrorCode` to assign to the new `AgentOSServiceError`.
   * @param {string} message - A new, overarching message for the `AgentOSServiceError`. The original
   * error's message will typically be included in the `details`.
   * @param {string} [componentOrigin] - Optional. The component where this wrapping is occurring or
   * where the original error was caught and is being standardized.
   * @returns {AgentOSServiceError} A new instance of `AgentOSServiceError` encapsulating the original error.
   *
   * @example
   * try {
   * // some operation that might throw
   * } catch (e: unknown) {
   * throw AgentOSServiceError.wrap(e, GMIErrorCode.INTERNAL_SERVER_ERROR, "Failed to process user request", "RequestHandler");
   * }
   */
  public static override wrap(error: any, code: GMIErrorCode | string, message: string, componentOrigin?: string): AgentOSServiceError {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const originalComponent = error instanceof GMIError ? error.component : undefined;
    const originalDetails = error instanceof GMIError ? error.details : { underlyingError: error };

    return new AgentOSServiceError(
      `${message}: ${baseMessage}`,
      code,
      originalDetails,
      componentOrigin || originalComponent
    );
  }
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
   * - Initialize an {@link EmbeddingManager} with {@link EmbeddingManagerConfig}
   * - Initialize a {@link VectorStoreManager} with {@link VectorStoreManagerConfig} + {@link RagDataSourceConfig}
   * - Initialize a {@link RetrievalAugmentor} with {@link RetrievalAugmentorServiceConfig}
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
  /** Configuration for the {@link PromptEngine}. */
  promptEngineConfig: PromptEngineConfig;
  /** Configuration for the {@link ToolOrchestrator}. */
  toolOrchestratorConfig: ToolOrchestratorConfig;
  /** Optional human-in-the-loop manager for approvals/clarifications. */
  hitlManager?: IHumanInteractionManager;
  /** Configuration for the {@link ToolPermissionManager}. */
  toolPermissionManagerConfig: ToolPermissionManagerConfig;
  /** Configuration for the {@link ConversationManager}. */
  conversationManagerConfig: ConversationManagerConfig;
  /** Configuration for the {@link StreamingManager}. */
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
  /** Optional authentication service, conforming to {@link IAuthService}. Provide via the auth extension or your own adapter. */
  authService?: IAuthService;
  /** Optional subscription service, conforming to {@link ISubscriptionService}. Provide via the auth extension or your own adapter. */
  subscriptionService?: ISubscriptionService;
  /** Optional guardrail service implementation used for policy enforcement. */
  guardrailService?: IGuardrailService;
  /** Optional map of secretId -> value for extension/tool credentials. */
  extensionSecrets?: Record<string, string>;
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
   * Optional. An instance of a utility AI service.
   * This service should conform to {@link IUtilityAI} for general utility tasks.
   * If the {@link PromptEngine} is used and requires specific utility functions (like advanced
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
   * Optional observability config for tracing, metrics, and log correlation.
   * Default: disabled (opt-in).
   */
  observability?: AgentOSObservabilityConfig;
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
    // Make the configuration immutable after validation to prevent runtime changes.
    this.config = Object.freeze({ ...config });

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
        this.logger.error('Failed initializing LanguageService; continuing without multilingual features', { error: langErr?.message || langErr });
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
        extensionLifecycleContext,
      );
      this.logger.info('[AgentOS] Schema-on-demand tools enabled');
    }

    let storageAdapter = this.config.storageAdapter;
    if (storageAdapter) {
      try {
        const provenanceDescriptor = this.extensionManager
          .getRegistry<any>(EXTENSION_KIND_PROVENANCE)
          .getActive('provenance-system');
        const provenanceHooks = (provenanceDescriptor as any)?.payload?.result?.hooks;
        if (provenanceHooks) {
          storageAdapter = wrapStorageAdapterWithWriteHooks(storageAdapter, provenanceHooks, { logger: this.logger });
          this.logger.info('[AgentOS][Provenance] Storage write hooks enabled');
        }
      } catch (error: any) {
        this.logger.warn?.('[AgentOS][Provenance] Failed to apply storage write hooks', { error: error?.message ?? error });
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
      this.toolExecutor = new ToolExecutor(this.authService, this.subscriptionService, toolRegistry);
      this.toolOrchestrator = new ToolOrchestrator();
      await this.toolOrchestrator.initialize(
        this.config.toolOrchestratorConfig,
        this.toolPermissionManager,
        this.toolExecutor,
        undefined,
        this.config.hitlManager
      );
      console.log('AgentOS: ToolOrchestrator initialized.');

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
        this.config.personaLoader,
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
        rollingSummaryMemorySink: this.config.rollingSummaryMemorySink,
        longTermMemoryRetriever: this.config.longTermMemoryRetriever,
      };
      this.agentOSOrchestrator = new AgentOSOrchestrator();
      await this.agentOSOrchestrator.initialize(this.config.orchestratorConfig, orchestratorDependencies);
      this.logger.info('AgentOS orchestrator initialized');

    } catch (error: unknown) {
      this.logger.error('AgentOS initialization failed', { error });
      const err = error instanceof GMIError ? error : new GMIError(
        error instanceof Error ? error.message : 'Unknown error during AgentOS initialization',
        GMIErrorCode.GMI_INITIALIZATION_ERROR, // Corrected error code
        error // details
      );
      console.error('AgentOS: Critical failure during core component initialization:', err.toJSON());
      throw AgentOSServiceError.wrap(err, err.code, 'AgentOS initialization failed', 'AgentOS.initialize');
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
            'gmiManagerConfig', 'orchestratorConfig', 'promptEngineConfig',
            'toolOrchestratorConfig', 'toolPermissionManagerConfig', 'conversationManagerConfig',
            'streamingManagerConfig', 'modelProviderManagerConfig', 'defaultPersonaId'
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
    }

    if (missingParams.length > 0) {
      const message = `AgentOS Configuration Error: Missing essential parameters: ${missingParams.join(', ')}.`;
      console.error(message);
      throw new AgentOSServiceError(message, GMIErrorCode.CONFIGURATION_ERROR, { missingParameters: missingParams });
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
      context,
    );
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
      } else if (event.type === 'descriptor:deactivated' && event.kind === EXTENSION_KIND_WORKFLOW) {
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
  private getActiveGuardrailServices(): IGuardrailService[] {
    const services: IGuardrailService[] = [];

    if (this.extensionManager) {
      const registry = this.extensionManager.getRegistry<IGuardrailService>(EXTENSION_KIND_GUARDRAIL);
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
      this.config.gmiManagerConfig.defaultGMIBaseConfigDefaults?.defaultLlmModelId ||
      'gpt-4o';

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

  /**
   * Processes a single interaction turn with an AI agent. This is an asynchronous generator
   * that yields {@link AgentOSResponse} chunks as they become available.
   *
   * This method orchestrates:
   * 1. Retrieval or creation of a {@link StreamId} via the {@link AgentOSOrchestrator}.
   * 2. Registration of a temporary, request-scoped stream client to the {@link StreamingManager}.
   * 3. Yielding of {@link AgentOSResponse} chunks received by this client.
   * 4. Ensuring the temporary client is deregistered upon completion or error.
   *
   * The underlying {@link AgentOSOrchestrator} handles the GMI interaction and pushes
   * chunks to the {@link StreamingManager}. This method acts as the bridge to make these
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
  public async *processRequest(input: AgentOSInput): AsyncGenerator<AgentOSResponse, void, undefined> {
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
      guardrailContext,
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

    const orchestratorInput: AgentOSInput = {
      ...guardrailInputOutcome.sanitizedInput,
      selectedPersonaId: effectivePersonaId,
    };
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
          fallbackChain: this.config.languageConfig.fallbackLanguages || [this.config.languageConfig.defaultLanguage],
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
  streamIdToListen = await this.agentOSOrchestrator.orchestrateTurn({ ...orchestratorInput, languageNegotiation } as any);
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
        },
      );
      if (orchestratorInput.workflowRequest) {
        const wfRequest = orchestratorInput.workflowRequest;
        try {
          await this.startWorkflow(wfRequest.definitionId, orchestratorInput, {
            workflowId: wfRequest.workflowId,
            conversationId:
              wfRequest.conversationId ?? orchestratorInput.conversationId ?? orchestratorInput.sessionId,
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
      this.logger.error('processRequest failed', { error: serviceError, streamId: streamIdToListen });
      
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
        await this.streamingManager.deregisterClient(streamIdToListen, bridge.id).catch((deregError) => {
          this.logger.warn('Failed to deregister bridge client', {
            bridgeId: bridge.id,
            streamId: streamIdToListen,
            error: (deregError as Error).message,
          });
        });
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
    errorMessage?: string,
  ): AsyncGenerator<AgentOSResponse, void, undefined> {
    this.ensureInitialized();

    // Create a new bridge client for this specific tool result handling phase
    const bridge = new AsyncStreamClientBridge(`client-toolRes-${streamId.substring(0,8)}-${toolCallId.substring(0,8)}`);

    try {
      console.log(`AgentOS.handleToolResult: Stream '${streamId}', ToolCall '${toolCallId}'. Orchestrator will push new chunks to this stream.`);
      
      // Register the bridge client to listen for new chunks on the existing stream
      await this.streamingManager.registerClient(streamId, bridge);
      console.log(`AgentOS.handleToolResult: Bridge client ${bridge.id} registered to stream ${streamId}.`);

      // This call is `async Promise<void>`; it triggers the orchestrator to process the tool result
      // and push new chunks to the StreamingManager for the given streamId.
      await this.agentOSOrchestrator.orchestrateToolResult(
        streamId, toolCallId, toolName, toolOutput, isSuccess, errorMessage
      );

      // Yield new chunks received by our bridge client on the same stream
      for await (const chunk of bridge.consume()) {
        yield chunk;
        if (chunk.isFinal && chunk.type !== AgentOSResponseChunkType.ERROR) {
          break;
        }
      }
    } catch (error: unknown) {
      const serviceError = AgentOSServiceError.wrap(
        error,
        GMIErrorCode.TOOL_ERROR, // Default code for facade-level tool result errors
        `Error during AgentOS.handleToolResult for stream '${streamId}', tool '${toolName}'`,
        'AgentOS.handleToolResult'
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
      console.log(`AgentOS.handleToolResult: Deregistering bridge client ${bridge.id} from stream ${streamId}.`);
      await this.streamingManager.deregisterClient(streamId, bridge.id)
        .catch(deregError => console.error(`AgentOS.handleToolResult: Error deregistering bridge client ${bridge.id}: ${(deregError as Error).message}`));
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
    } = {},
  ): Promise<WorkflowInstance> {
    this.ensureInitialized();
    const definition = this.workflowEngine
      .listWorkflowDefinitions()
      .find((item) => item.id === definitionId);
    if (!definition) {
      throw new AgentOSServiceError(
        `Workflow definition '${definitionId}' not found.`,
        GMIErrorCode.CONFIGURATION_ERROR,
        { definitionId },
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
    sinceTimestamp?: string,
  ): Promise<WorkflowProgressUpdate | null> {
    this.ensureInitialized();
    return this.workflowEngine.getWorkflowProgress(workflowId, sinceTimestamp);
  }

  public async updateWorkflowStatus(
    workflowId: string,
    status: WorkflowStatus,
  ): Promise<WorkflowInstance | null> {
    this.ensureInitialized();
    return this.workflowEngine.updateWorkflowStatus(workflowId, status);
  }

  public async applyWorkflowTaskUpdates(
    workflowId: string,
    updates: WorkflowTaskUpdate[],
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
    console.log(`AgentOS.listAvailablePersonas: Request for UserID: '${userId || "anonymous/system"}'.`);
    try {
      return await this.gmiManager.listAvailablePersonas(userId);
    } catch (error: unknown) {
      throw AgentOSServiceError.wrap(error, GMIErrorCode.PERSONA_LOAD_ERROR, "Failed to list available personas", "AgentOS.listAvailablePersonas");
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
  public async getConversationHistory(conversationId: string, userId: string): Promise<ConversationContext | null> {
    this.ensureInitialized();
    console.log(`AgentOS.getConversationHistory: Request for ConversationID '${conversationId}', UserID '${userId}'.`);

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
          console.warn(`AgentOS.getConversationHistory: User '${userId}' attempted to access conversation '${conversationId}' belonging to another user ('${context.getMetadata('userId')}').`);
          // Consider throwing PERMISSION_DENIED for explicit denial.
          return null;
        }
      }
      return null; // Conversation not found
    } catch (error: unknown) {
      throw AgentOSServiceError.wrap(error, GMIErrorCode.GMI_CONTEXT_ERROR, `Failed to retrieve conversation history for ID '${conversationId}'`, "AgentOS.getConversationHistory");
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
  public async receiveFeedback(userId: string, sessionId: string, personaId: string, feedbackPayload: UserFeedbackPayload): Promise<void> {
    this.ensureInitialized();
    // Basic authorization checks for the user can be performed here.
    // E.g., await this.authService.validateUserExists(userId);

    console.log(`AgentOS.receiveFeedback: UserID '${userId}', SessionID '${sessionId}', PersonaID '${personaId}'. Payload:`, JSON.stringify(feedbackPayload).substring(0, 200) + "...");
    
    try {
      // Delegate feedback processing, typically to GMIManager or directly to the relevant GMI.
      await this.gmiManager.processUserFeedback(userId, sessionId, personaId, feedbackPayload);
      console.info(`AgentOS.receiveFeedback: Feedback processed successfully for UserID '${userId}', PersonaID '${personaId}'.`);
    } catch (error: unknown) {
      throw AgentOSServiceError.wrap(error, GMIErrorCode.GMI_FEEDBACK_ERROR, "Failed to process user feedback", "AgentOS.receiveFeedback");
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
      console.warn('AgentOS Service is already shut down or was never initialized. Shutdown call is a no-op.');
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
      if (this.conversationManager?.shutdown && typeof this.conversationManager.shutdown === 'function') {
        await this.conversationManager.shutdown();
        console.log('AgentOS: ConversationManager shut down.');
      }
      if (this.toolOrchestrator && typeof (this.toolOrchestrator as any).shutdown === 'function') {
        await (this.toolOrchestrator as any).shutdown();
        console.log('AgentOS: ToolOrchestrator shut down.');
      }
      if (this.manageRetrievalAugmentorLifecycle && this.retrievalAugmentor?.shutdown) {
        await this.retrievalAugmentor.shutdown();
        console.log('AgentOS: RetrievalAugmentor shut down.');
      }
      if (this.manageRetrievalAugmentorLifecycle && this.ragVectorStoreManager?.shutdownAllProviders) {
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
      // Other services like authService, subscriptionService, prisma might not have explicit async shutdown methods
      // if they manage connections passively or are handled by process exit.

      console.log('AgentOS Service: Graceful shutdown completed successfully.');
    } catch (error: unknown) {
      // Even if one component fails to shut down, attempt to log and continue if possible,
      // but report the overall failure.
      const serviceError = AgentOSServiceError.wrap(error, GMIErrorCode.GMI_SHUTDOWN_ERROR, "Error during AgentOS service shutdown sequence", "AgentOS.shutdown");
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
      this.manageRetrievalAugmentorLifecycle = this.config.manageRetrievalAugmentorLifecycle === true;
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
      await embeddingManager.initialize(ragConfig.embeddingManagerConfig, this.modelProviderManager);

      const bindToStorageAdapter =
        ragConfig.bindToStorageAdapter === undefined ? true : ragConfig.bindToStorageAdapter === true;

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
        vectorStoreManager,
      );

      this.retrievalAugmentor = retrievalAugmentor;
      this.ragVectorStoreManager = vectorStoreManager;
      this.manageRetrievalAugmentorLifecycle = ragConfig.manageLifecycle !== false;
      console.log('AgentOS: RAG subsystem initialized.');
    } catch (error: any) {
      this.logger.error('AgentOS: Failed to initialize RAG subsystem; continuing without retrieval augmentor.', {
        error: error?.message ?? error,
      });
    }
  }
}


/**
 * @class AsyncStreamClientBridge
 * @implements {IStreamClient}
 * @description
 * A helper class that acts as an {@link IStreamClient} to bridge the push-based
 * data flow from `StreamingManager` to a pull-based `AsyncGenerator` consumable
 * by methods like `AgentOS.processRequest`.
 *
 * This class queues incoming chunks and uses promises to signal availability
 * to a consuming async generator loop. It handles stream closure notifications
 * to terminate the generator.
 *
 * @internal This class is intended for internal use within `AgentOS.ts` or similar facades.
 */
class AsyncStreamClientBridge implements IStreamClient {
  /**
   * Unique identifier for this bridge client instance.
   * @public
   * @readonly
   * @type {StreamClientId}
   */
  public readonly id: StreamClientId;

  private readonly chunkQueue: AgentOSResponse[] = [];
  private resolveNextChunkPromise: ((value: IteratorResult<AgentOSResponse, void>) => void) | null = null;
  private rejectNextChunkPromise: ((reason?: any) => void) | null = null; // Added for error propagation
  private streamClosed: boolean = false;
  private processingError: Error | null = null;

  /**
   * Creates an instance of `AsyncStreamClientBridge`.
   * @param {string} [debugIdPrefix='bridge-client'] - A prefix for generating a unique debug ID.
   */
  constructor(debugIdPrefix: string = 'bridge-client') {
    this.id = `${debugIdPrefix}-${uuidv4()}` as StreamClientId;
  }

  /**
   * Receives a chunk from the `StreamingManager` and makes it available to the consumer.
   * If a consumer is awaiting a chunk, its promise is resolved. Otherwise, the chunk is queued.
   *
   * @public
   * @async
   * @param {AgentOSResponse} chunk - The data chunk received from the stream.
   * @returns {Promise<void>} A promise that resolves when the chunk has been processed by the bridge.
   */
  public async sendChunk(chunk: AgentOSResponse): Promise<void> {
    if (this.streamClosed) {
      console.warn(`AsyncStreamClientBridge (${this.id}): Received chunk on already closed stream. Chunk ignored.`, chunk.type);
      return;
    }

    this.chunkQueue.push(chunk);

    if (this.resolveNextChunkPromise) {
      const resolve = this.resolveNextChunkPromise;
      this.resolveNextChunkPromise = null; // Consume resolver
      this.rejectNextChunkPromise = null;
      // The queue is guaranteed to have at least one item here.
      resolve({ value: this.chunkQueue.shift()!, done: false });
    }
  }

  /**
   * Called by `StreamingManager` when the stream this client is subscribed to is closed.
   * Signals the consuming async generator to terminate.
   *
   * @public
   * @async
   * @param {string} [reason] - Optional reason for stream closure.
   * @returns {Promise<void>} A promise that resolves when closure notification is handled.
    */
  public async notifyStreamClosed(reason?: string): Promise<void> {
    if (this.streamClosed) return; // Idempotent

    console.log(`AsyncStreamClientBridge (${this.id}): Stream closed. Reason: ${reason || 'N/A'}`);
    this.streamClosed = true;
    if (this.resolveNextChunkPromise) {
      const resolve = this.resolveNextChunkPromise;
      this.resolveNextChunkPromise = null; // Consume resolver
      this.rejectNextChunkPromise = null;
      resolve({ value: undefined, done: true });
    }
  }

  /**
   * Forcibly closes the bridge from the consumer side, typically in a `finally` block.
   * This ensures that if the consumer loop breaks for any reason, the pending promise
   * for the next chunk is resolved, preventing hangs.
   * @public
   */
  public forceClose(): void {
    if (!this.streamClosed) {
        this.streamClosed = true;
        if (this.resolveNextChunkPromise) {
            const resolve = this.resolveNextChunkPromise;
            this.resolveNextChunkPromise = null;
            this.rejectNextChunkPromise = null;
            resolve({ value: undefined, done: true });
        }
    }
  }

  /**
   * Reports whether the client bridge considers the stream active.
   * The stream is inactive if `notifyStreamClosed` or `forceClose` has been called.
   *
   * @public
   * @returns {boolean} `true` if the stream is considered active by the bridge, `false` otherwise.
   */
  public isActive(): boolean {
    return !this.streamClosed;
  }

  /**
   * Optional. Handles explicit closure requests, primarily for resource cleanup if any were held.
   * For this bridge, it mainly ensures the `streamClosed` flag is set.
   *
   * @public
   * @async
   * @param {string} [reason] - Optional reason for closing.
   * @returns {Promise<void>}
   */
  public async close(reason?: string): Promise<void> {
    console.log(`AsyncStreamClientBridge (${this.id}): Explicitly closed. Reason: ${reason || 'N/A'}`);
    this.forceClose();
  }
  
  /**
   * Consumes chunks from this bridge as an asynchronous generator.
   * This method is intended to be used by the `AgentOS` facade methods.
   *
   * @public
   * @async
   * @generator
   * @yields {AgentOSResponse} Chunks of data as they arrive.
   * @returns {AsyncGenerator<AgentOSResponse, void, undefined>}
   * @throws {Error} If an internal error occurs within the bridge's consumption logic or if `_reportError` was called.
   */
  public async *consume(): AsyncGenerator<AgentOSResponse, void, undefined> {
    try {
      while (true) {
        if (this.chunkQueue.length > 0) {
          yield this.chunkQueue.shift()!;
          continue; // Check queue again before potentially awaiting
        }

        if (this.streamClosed) {
          // If stream closed and queue is empty, iteration is done.
          break;
        }
        
        if (this.processingError) {
          const errToThrow = this.processingError;
          this.processingError = null; // Consume error
          throw errToThrow;
        }

        // Wait for the next chunk or stream closure
        const result = await new Promise<IteratorResult<AgentOSResponse, void>>((resolve, reject) => {
          this.resolveNextChunkPromise = resolve;
          this.rejectNextChunkPromise = reject; // Store reject
          // After setting up promises, re-check conditions in case state changed during setup.
          // This handles rapid, synchronous calls to sendChunk or notifyStreamClosed.
          if (this.chunkQueue.length > 0) {
            if(this.resolveNextChunkPromise) this.resolveNextChunkPromise({ value: this.chunkQueue.shift()!, done: false });
            this.resolveNextChunkPromise = null; this.rejectNextChunkPromise = null;
          } else if (this.streamClosed) {
            if(this.resolveNextChunkPromise) this.resolveNextChunkPromise({ value: undefined, done: true });
            this.resolveNextChunkPromise = null; this.rejectNextChunkPromise = null;
          } else if (this.processingError) {
             if(this.rejectNextChunkPromise) this.rejectNextChunkPromise(this.processingError);
             this.processingError = null; this.resolveNextChunkPromise = null; this.rejectNextChunkPromise = null;
          }
        });
        
        if (result.done) {
          break;
        }
        const nextChunk = result.value as AgentOSResponse;
        if (!nextChunk) {
          continue;
        }
        yield nextChunk;
      }
    } catch (error) {
        console.error(`AsyncStreamClientBridge (${this.id}): Error during consumption loop.`, error);
        // Ensure the generator terminates properly even if an error is thrown from the promise
        this.streamClosed = true; 
        if (this.resolveNextChunkPromise) { // Clean up any lingering promise resolver
            this.resolveNextChunkPromise({ value: undefined, done: true });
            this.resolveNextChunkPromise = null;
            this.rejectNextChunkPromise = null;
        }
        throw error; // Re-throw the error to be caught by the consumer of the generator
    } finally {
        // Final cleanup of resolvers
        this.resolveNextChunkPromise = null;
        this.rejectNextChunkPromise = null;
        this.streamClosed = true; // Ensure it's marked closed
    }
  }
}

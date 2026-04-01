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
import { AGENTOS_PENDING_EXTERNAL_TOOL_REQUEST_METADATA_KEY } from './types/AgentOSExternalToolRequest.js';
import { AgentOSResponseChunkType, isActionableToolCallRequestChunk, } from './types/AgentOSResponse.js';
import { AgentOSOrchestrator, } from './runtime/AgentOSOrchestrator.js';
import { GMIManager } from '../cognitive_substrate/GMIManager.js';
import { AIModelProviderManager, } from '../core/llm/providers/AIModelProviderManager.js';
import { PromptEngine } from '../core/llm/PromptEngine.js';
import { ToolOrchestrator } from '../core/tools/ToolOrchestrator.js';
import { ToolExecutor } from '../core/tools/ToolExecutor.js';
import { ToolPermissionManager } from '../core/tools/permissions/ToolPermissionManager.js';
import { LLMUtilityAI } from '../nlp/ai_utilities/LLMUtilityAI.js';
import { ConversationManager, } from '../core/conversation/ConversationManager.js';
import { StreamingManager, } from '../core/streaming/StreamingManager.js';
import { GMIError, GMIErrorCode } from '../core/utils/errors.js';
import { uuidv4 } from '../core/utils/uuid.js';
import { createLogger } from '../logging/loggerFactory.js';
import { configureAgentOSObservability, } from '../evaluation/observability/otel.js';
import { GuardrailAction } from '../safety/guardrails/IGuardrailService.js';
import { evaluateInputGuardrails, createGuardrailBlockedStream, wrapOutputGuardrails, } from '../safety/guardrails/guardrailDispatcher.js';
import { ExtensionManager, EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_PROVENANCE, EXTENSION_KIND_TOOL, EXTENSION_KIND_WORKFLOW, } from '../extensions/index.js';
import { listExternalToolDefinitionsForLLM, normalizeExternalToolRegistry, } from './runtime/externalToolRegistry.js';
import { adaptTools, adaptToolsToMap } from './runtime/toolAdapter.js';
import { createSchemaOnDemandPack } from '../extensions/packs/schema-on-demand-pack.js';
import { WorkflowFacade } from './runtime/WorkflowFacade.js';
import { CapabilityDiscoveryInitializer } from './runtime/CapabilityDiscoveryInitializer.js';
import { SelfImprovementSessionManager } from './runtime/SelfImprovementSessionManager.js';
import { RagMemoryInitializer } from './runtime/RagMemoryInitializer.js';
function wrapStorageAdapterWithWriteHooks(adapter, hooks, options) {
    const inTransaction = options?.inTransaction === true;
    const runWithHooks = async (statement, parameters) => {
        const startTime = Date.now();
        const operationId = uuidv4();
        const context = {
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
        const result = await adapter.run(context.statement, context.parameters);
        try {
            await hooks.onAfterWrite?.(context, result);
        }
        catch (error) {
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
        transaction: async (fn) => {
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
                const results = [];
                const errors = [];
                let successful = 0;
                let failed = 0;
                for (let i = 0; i < operations.length; i += 1) {
                    const op = operations[i];
                    try {
                        const result = await runWithHooks(op.statement, op.parameters);
                        results.push(result);
                        successful += 1;
                    }
                    catch (error) {
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
                };
            }
            : undefined,
        prepare: adapter.prepare ? (statement) => adapter.prepare(statement) : undefined,
    };
}
// Re-export from extracted module
import { AgentOSServiceError } from './errors.js';
export { AgentOSServiceError } from './errors.js';
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
export class AgentOS {
    /**
     * Constructs an `AgentOS` instance. The instance is not operational until
     * `initialize()` is called and successfully completes.
     */
    constructor(logger = createLogger('AgentOS')) {
        this.logger = logger;
        this.initialized = false;
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
    async initialize(config) {
        if (this.initialized) {
            this.logger.warn('AgentOS initialize() called more than once; skipping.');
            return;
        }
        this.validateConfiguration(config);
        const resolvedConfig = RagMemoryInitializer.resolveConfig(config);
        const normalizedConfigTools = adaptToolsToMap(resolvedConfig.tools);
        const normalizedExternalTools = normalizeExternalToolRegistry(resolvedConfig.externalTools);
        const { externalTools: _externalTools, tools: _tools, ...resolvedConfigWithoutNormalizedTools } = resolvedConfig;
        // Make the configuration immutable after validation to prevent runtime changes.
        this.config = Object.freeze({
            ...resolvedConfigWithoutNormalizedTools,
            ...(Object.keys(normalizedConfigTools).length > 0 ? { tools: normalizedConfigTools } : {}),
            ...(normalizedExternalTools ? { externalTools: normalizedExternalTools } : {}),
        });
        // Initialize self-improvement session manager early (before emergent deps are assembled).
        this.selfImprovementManager = new SelfImprovementSessionManager(this.logger);
        this.selfImprovementManager.setConfiguredSkillsGetter(() => {
            try {
                const turnPlanningSkills = this.config.turnPlanning?.discovery?.sources?.skills;
                if (Array.isArray(turnPlanningSkills)) {
                    return turnPlanningSkills;
                }
                const legacySkills = this.config.capabilityDiscovery?.sources?.skills;
                if (Array.isArray(legacySkills)) {
                    return legacySkills;
                }
            }
            catch {
                // Fall through to empty set.
            }
            return [];
        });
        // Observability is opt-in (config + env). Safe no-op if OTEL is not installed by host.
        configureAgentOSObservability(this.config.observability);
        // Initialize LanguageService early if configured so downstream orchestration can use it.
        if (config.languageConfig) {
            try {
                // Dynamic import may fail under certain bundler path resolutions; using explicit relative path.
                const { LanguageService } = await import('../nlp/language/index.js');
                this.languageService = new LanguageService(config.languageConfig);
                await this.languageService.initialize();
                this.logger.info('AgentOS LanguageService initialized');
            }
            catch (langErr) {
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
            throw new AgentOSServiceError('Either storageAdapter or prisma must be provided. Use storageAdapter for client-side (IndexedDB/SQLite) or prisma for server-side (PostgreSQL).', GMIErrorCode.CONFIGURATION_ERROR, 'AgentOS.initialize');
        }
        this.logger.info('AgentOS initialization sequence started');
        this.extensionManager = new ExtensionManager({
            manifest: this.config.extensionManifest,
            secrets: this.config.extensionSecrets,
            overrides: this.config.extensionOverrides,
        });
        const extensionLifecycleContext = { logger: this.logger };
        await this.extensionManager.loadManifest(extensionLifecycleContext);
        await this.registerConfigGuardrailService(extensionLifecycleContext);
        if (this.config.schemaOnDemandTools?.enabled === true) {
            const allowPackages = typeof this.config.schemaOnDemandTools.allowPackages === 'boolean'
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
            await this.extensionManager.loadPackFromFactory(pack, 'schema-on-demand', undefined, extensionLifecycleContext);
            this.logger.info('[AgentOS] Schema-on-demand tools enabled');
        }
        // Create RagMemoryInitializer now that extensionManager is available.
        // modelProviderManager is wired later (after AI model provider init).
        this.ragMemoryInitializer = new RagMemoryInitializer({
            extensionManager: this.extensionManager,
            modelProviderManager: undefined,
            logger: this.logger,
        });
        this.ragMemoryInitializer.configureManaged(this.config);
        await this.ragMemoryInitializer.registerMemoryTools(this.config.memoryTools, extensionLifecycleContext);
        let storageAdapter = this.config.storageAdapter;
        if (storageAdapter) {
            try {
                const provenanceDescriptor = this.extensionManager
                    .getRegistry(EXTENSION_KIND_PROVENANCE)
                    .getActive('provenance-system');
                const provenanceHooks = provenanceDescriptor?.payload?.result?.hooks;
                if (provenanceHooks) {
                    storageAdapter = wrapStorageAdapterWithWriteHooks(storageAdapter, provenanceHooks, {
                        logger: this.logger,
                    });
                    this.logger.info('[AgentOS][Provenance] Storage write hooks enabled');
                }
            }
            catch (error) {
                this.logger.warn?.('[AgentOS][Provenance] Failed to apply storage write hooks', {
                    error: error?.message ?? error,
                });
            }
        }
        try {
            this.workflowFacade = new WorkflowFacade({
                extensionManager: this.extensionManager,
                logger: this.logger,
                workflowEngineConfig: this.config.workflowEngineConfig,
                workflowStore: this.config.workflowStore,
            });
            await this.workflowFacade.initialize(extensionLifecycleContext);
            // Initialize AI Model Provider Manager
            this.modelProviderManager = new AIModelProviderManager();
            await this.modelProviderManager.initialize(this.config.modelProviderManagerConfig);
            console.log('AgentOS: AIModelProviderManager initialized.');
            await this.ensureUtilityAIService();
            // Re-create RagMemoryInitializer with model provider now available.
            this.ragMemoryInitializer = new RagMemoryInitializer({
                extensionManager: this.extensionManager,
                modelProviderManager: this.modelProviderManager,
                logger: this.logger,
            });
            this.ragMemoryInitializer.configureManaged(this.config);
            await this.ragMemoryInitializer.initializeRag(this.config, storageAdapter);
            // Initialize Prompt Engine
            this.promptEngine = new PromptEngine();
            const peUtility = this.utilityAIService;
            if (typeof peUtility.summarizeConversationHistory !== 'function' ||
                typeof peUtility.summarizeRAGContext !== 'function') {
                const warningMsg = 'AgentOS WARNING: The provided utilityAIService does not fully implement the IPromptEngineUtilityAI interface (missing summarizeConversationHistory or summarizeRAGContext). PromptEngine functionality may be impaired.';
                console.warn(warningMsg);
            }
            await this.promptEngine.initialize(this.config.promptEngineConfig, this.utilityAIService);
            console.log('AgentOS: PromptEngine initialized.');
            // Initialize Tool Permission Manager
            this.toolPermissionManager = new ToolPermissionManager();
            await this.toolPermissionManager.initialize(this.config.toolPermissionManagerConfig, this.authService, this.subscriptionService);
            console.log('AgentOS: ToolPermissionManager initialized.');
            // Initialize Tool Orchestrator
            const toolRegistry = this.extensionManager.getRegistry(EXTENSION_KIND_TOOL);
            this.toolExecutor = new ToolExecutor(this.authService, this.subscriptionService, toolRegistry);
            this.toolOrchestrator = new ToolOrchestrator();
            // Build emergent options from config when emergent: true.
            const emergentOptions = this.config.emergent
                ? {
                    enabled: true,
                    config: this.config.emergentConfig,
                    generateText: async (model, prompt) => {
                        const provider = this.modelProviderManager.getDefaultProvider();
                        if (!provider) {
                            throw new Error('No LLM provider available for the emergent judge.');
                        }
                        const response = await provider.generateCompletion(model, [{ role: 'user', content: prompt }], {});
                        const firstContent = response.choices?.[0]?.message?.content ?? '';
                        return typeof firstContent === 'string' ? firstContent : JSON.stringify(firstContent);
                    },
                    storageAdapter: storageAdapter
                        ? {
                            run: async (sql, params) => storageAdapter.run(sql, params),
                            get: async (sql, params) => storageAdapter.get(sql, params),
                            all: async (sql, params) => storageAdapter.all(sql, params),
                            exec: async (sql) => storageAdapter.exec(sql),
                        }
                        : undefined,
                    selfImprovementDeps: this.config.emergentConfig?.selfImprovement?.enabled
                        ? this.selfImprovementManager.buildToolDeps(storageAdapter, {
                            getActiveGMI: () => this.gmiManager?.activeGMIs?.values().next().value,
                            getToolOrchestrator: () => this.toolOrchestrator,
                        })
                        : undefined,
                }
                : undefined;
            const initialConfigTools = adaptTools(this.config.tools);
            await this.toolOrchestrator.initialize(this.config.toolOrchestratorConfig, this.toolPermissionManager, this.toolExecutor, initialConfigTools, this.config.hitlManager, emergentOptions);
            console.log('AgentOS: ToolOrchestrator initialized.');
            if (initialConfigTools.length > 0) {
                this.logger.info('[AgentOS] Config tools registered', {
                    toolCount: initialConfigTools.length,
                    toolNames: initialConfigTools.map((tool) => tool.name),
                });
            }
            this.discoveryInitializer = new CapabilityDiscoveryInitializer({
                toolOrchestrator: this.toolOrchestrator,
                extensionManager: this.extensionManager,
                modelProviderManager: this.modelProviderManager,
                modelProviderManagerConfig: this.config.modelProviderManagerConfig,
                turnPlanningConfig: this.config.turnPlanning,
                configTools: this.config.tools,
                logger: this.logger,
            });
            await this.discoveryInitializer.initialize();
            if (this.discoveryInitializer.discoveryEngine && this.toolOrchestrator.setEmergentDiscoveryIndexer) {
                this.toolOrchestrator.setEmergentDiscoveryIndexer(async (tools) => {
                    if (this.discoveryInitializer?.discoveryEngine?.indexEmergentTools) {
                        await this.discoveryInitializer.discoveryEngine.indexEmergentTools(tools);
                    }
                });
            }
            // Initialize Conversation Manager
            this.conversationManager = new ConversationManager();
            await this.conversationManager.initialize(this.config.conversationManagerConfig, this.utilityAIService, // General IUtilityAI for conversation tasks
            storageAdapter // Use storageAdapter instead of Prisma
            );
            console.log('AgentOS: ConversationManager initialized.');
            // Initialize Streaming Manager
            this.streamingManager = new StreamingManager();
            await this.streamingManager.initialize(this.config.streamingManagerConfig);
            console.log('AgentOS: StreamingManager initialized.');
            // Initialize GMI Manager
            this.gmiManager = new GMIManager(this.config.gmiManagerConfig, this.subscriptionService, this.authService, this.conversationManager, // Removed Prisma parameter
            this.promptEngine, this.modelProviderManager, this.utilityAIService, // Pass the potentially dual-role utility service
            this.toolOrchestrator, this.ragMemoryInitializer.retrievalAugmentor, this.config.personaLoader);
            await this.gmiManager.initialize();
            console.log('AgentOS: GMIManager initialized.');
            if (this.workflowFacade) {
                this.workflowFacade.setRuntimeDependencies({
                    gmiManager: this.gmiManager,
                    streamingManager: this.streamingManager,
                    toolOrchestrator: this.toolOrchestrator,
                });
                await this.workflowFacade.startRuntime();
            }
            // Initialize AgentOS Orchestrator
            const orchestratorDependencies = {
                gmiManager: this.gmiManager,
                toolOrchestrator: this.toolOrchestrator,
                conversationManager: this.conversationManager,
                streamingManager: this.streamingManager,
                modelProviderManager: this.modelProviderManager,
                turnPlanner: this.discoveryInitializer?.turnPlanner,
                rollingSummaryMemorySink: this.config.rollingSummaryMemorySink,
                longTermMemoryRetriever: this.config.longTermMemoryRetriever,
                taskOutcomeTelemetryStore: this.config.taskOutcomeTelemetryStore,
            };
            this.agentOSOrchestrator = new AgentOSOrchestrator();
            await this.agentOSOrchestrator.initialize(this.config.orchestratorConfig, orchestratorDependencies);
            this.logger.info('AgentOS orchestrator initialized');
            // Wire the orchestrator into the workflow facade for progress broadcasts.
            if (this.workflowFacade) {
                this.workflowFacade.setRuntimeDependencies({
                    gmiManager: this.gmiManager,
                    streamingManager: this.streamingManager,
                    toolOrchestrator: this.toolOrchestrator,
                    orchestrator: this.agentOSOrchestrator,
                });
            }
        }
        catch (error) {
            this.logger.error('AgentOS initialization failed', { error });
            const err = error instanceof GMIError
                ? error
                : new GMIError(error instanceof Error
                    ? error.message
                    : 'Unknown error during AgentOS initialization', GMIErrorCode.GMI_INITIALIZATION_ERROR, // Corrected error code
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
    validateConfiguration(config) {
        const missingParams = [];
        if (!config) {
            // This case should ideally not be hit if TypeScript is used correctly at the call site,
            // but as a runtime check:
            missingParams.push('AgentOSConfig (entire object)');
        }
        else {
            // Check for each required sub-configuration
            const requiredConfigs = [
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
                if (!config.memoryTools.memory ||
                    typeof config.memoryTools.memory.createTools !== 'function') {
                    missingParams.push('memoryTools.memory.createTools (when memoryTools is enabled)');
                }
                if (config.memoryTools.manageLifecycle === true &&
                    typeof config.memoryTools.memory?.close !== 'function') {
                    missingParams.push('memoryTools.memory.close (when memoryTools.manageLifecycle is true)');
                }
            }
            if (config.standaloneMemory && config.standaloneMemory.enabled !== false) {
                if (!config.standaloneMemory.memory) {
                    missingParams.push('standaloneMemory.memory');
                }
                if (config.standaloneMemory.tools &&
                    !config.memoryTools &&
                    typeof config.standaloneMemory.memory?.createTools !== 'function') {
                    missingParams.push('standaloneMemory.memory.createTools (when standaloneMemory.tools is enabled)');
                }
                if (config.standaloneMemory.longTermRetriever &&
                    !config.longTermMemoryRetriever &&
                    typeof config.standaloneMemory.memory?.recall !== 'function') {
                    missingParams.push('standaloneMemory.memory.recall (when standaloneMemory.longTermRetriever is enabled)');
                }
                if (config.standaloneMemory.rollingSummarySink &&
                    !config.rollingSummaryMemorySink &&
                    (typeof config.standaloneMemory.memory?.remember !== 'function' ||
                        typeof config.standaloneMemory.memory?.forget !== 'function')) {
                    missingParams.push('standaloneMemory.memory.remember/forget (when standaloneMemory.rollingSummarySink is enabled)');
                }
                if (config.standaloneMemory.manageLifecycle === true &&
                    typeof config.standaloneMemory.memory?.close !== 'function') {
                    missingParams.push('standaloneMemory.memory.close (when standaloneMemory.manageLifecycle is true)');
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
    async registerConfigGuardrailService(context) {
        if (!this.config.guardrailService) {
            return;
        }
        const registry = this.extensionManager.getRegistry(EXTENSION_KIND_GUARDRAIL);
        await registry.register({
            id: 'config-guardrail-service',
            kind: EXTENSION_KIND_GUARDRAIL,
            payload: this.config.guardrailService,
            priority: Number.MAX_SAFE_INTEGER,
            metadata: { origin: 'config' },
        }, context);
    }
    getActiveGuardrailServices() {
        const services = [];
        if (this.extensionManager) {
            const registry = this.extensionManager.getRegistry(EXTENSION_KIND_GUARDRAIL);
            services.push(...registry.listActive().map((descriptor) => descriptor.payload));
        }
        if (this.guardrailService && !services.includes(this.guardrailService)) {
            services.push(this.guardrailService);
        }
        return services;
    }
    async ensureUtilityAIService() {
        if (this.utilityAIService) {
            return;
        }
        if (this.config.utilityAIService) {
            this.utilityAIService = this.config.utilityAIService;
            return;
        }
        this.utilityAIService = await this.buildDefaultUtilityAI();
    }
    async buildDefaultUtilityAI() {
        const fallbackUtility = new LLMUtilityAI();
        const defaultProviderId = this.config.gmiManagerConfig.defaultGMIBaseConfigDefaults?.defaultLlmProviderId ||
            this.config.modelProviderManagerConfig.providers[0]?.providerId ||
            'openai';
        const defaultModelId = this.config.gmiManagerConfig.defaultGMIBaseConfigDefaults?.defaultLlmModelId || 'gpt-4o';
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
    ensureInitialized() {
        if (!this.initialized) {
            throw new AgentOSServiceError('AgentOS Service is not initialized. Please call and await the initialize() method before attempting operations.', GMIErrorCode.NOT_INITIALIZED, { serviceName: 'AgentOS', operationAttemptedWhileUninitialized: true });
        }
    }
    async getRuntimeSnapshot() {
        this.ensureInitialized();
        const activeConversations = this.conversationManager?.activeConversations instanceof Map
            ? Array.from(this.conversationManager.activeConversations.values())
            : [];
        const conversationItems = activeConversations.map((context) => {
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
        });
        const gmiItems = [];
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
        const toolRegistry = this.extensionManager.getRegistry(EXTENSION_KIND_TOOL);
        const workflowRegistry = this.extensionManager.getRegistry(EXTENSION_KIND_WORKFLOW);
        const guardrailRegistry = this.extensionManager.getRegistry(EXTENSION_KIND_GUARDRAIL);
        return {
            initialized: this.initialized,
            services: {
                conversationManager: Boolean(this.conversationManager),
                extensionManager: Boolean(this.extensionManager),
                toolOrchestrator: Boolean(this.toolOrchestrator),
                modelProviderManager: Boolean(this.modelProviderManager),
                retrievalAugmentor: Boolean(this.ragMemoryInitializer?.retrievalAugmentor),
                workflowEngine: Boolean(this.workflowFacade),
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
    getConversationManager() {
        this.ensureInitialized();
        return this.conversationManager;
    }
    getGMIManager() {
        this.ensureInitialized();
        return this.gmiManager;
    }
    getExtensionManager() {
        this.ensureInitialized();
        return this.extensionManager;
    }
    getToolOrchestrator() {
        this.ensureInitialized();
        return this.toolOrchestrator;
    }
    getExternalToolRegistry() {
        this.ensureInitialized();
        return this.config.externalTools;
    }
    listExternalToolsForLLM() {
        this.ensureInitialized();
        return listExternalToolDefinitionsForLLM(this.config.externalTools);
    }
    getModelProviderManager() {
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
    async *processRequest(input) {
        this.ensureInitialized();
        // Authentication and detailed authorization would typically happen here or be delegated.
        // For example:
        // if (!await this.authService.isUserAuthenticated(input.sessionId, input.userId)) {
        //   throw new AgentOSServiceError("User not authenticated.", GMIErrorCode.AUTHENTICATION_REQUIRED);
        // }
        const effectivePersonaId = input.selectedPersonaId || this.config.defaultPersonaId;
        const guardrailContext = {
            userId: input.userId,
            sessionId: input.sessionId,
            personaId: effectivePersonaId,
            conversationId: input.conversationId,
            metadata: input.options?.customFlags,
        };
        const guardrailServices = this.getActiveGuardrailServices();
        const guardrailReadyInput = {
            ...input,
            selectedPersonaId: effectivePersonaId,
        };
        const guardrailInputOutcome = await evaluateInputGuardrails(guardrailServices, guardrailReadyInput, guardrailContext);
        const blockingEvaluation = guardrailInputOutcome.evaluation ?? guardrailInputOutcome.evaluations?.at(-1) ?? null;
        if (blockingEvaluation?.action === GuardrailAction.BLOCK) {
            const streamId = guardrailReadyInput.sessionId || `agentos-guardrail-${Date.now()}`;
            const blockedStream = createGuardrailBlockedStream(guardrailContext, blockingEvaluation, {
                streamId,
                personaId: effectivePersonaId,
            });
            for await (const chunk of blockedStream) {
                yield chunk;
            }
            return;
        }
        const orchestratorInput = this.selfImprovementManager.applySessionOverrides({
            ...guardrailInputOutcome.sanitizedInput,
            selectedPersonaId: effectivePersonaId,
            skillPromptContext: this.selfImprovementManager.buildSkillPromptContext(guardrailInputOutcome.sanitizedInput.sessionId),
            disabledSessionSkillIds: this.selfImprovementManager.listDisabledSkillIds(this.selfImprovementManager.buildSessionRuntimeKey(guardrailInputOutcome.sanitizedInput.sessionId)),
        });
        // Language negotiation (non-blocking)
        let languageNegotiation = null;
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
                });
            }
            catch (negErr) {
                this.logger.warn('Language negotiation failed', { error: negErr?.message || negErr });
            }
        }
        const baseStreamDebugId = orchestratorInput.sessionId || `agentos-req-${Date.now()}`;
        this.logger.debug?.('processRequest invoked', {
            userId: orchestratorInput.userId,
            sessionId: orchestratorInput.sessionId,
            personaId: orchestratorInput.selectedPersonaId,
        });
        let streamIdToListen;
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
            });
            await this.streamingManager.registerClient(streamIdToListen, bridge);
            this.logger.debug?.('Bridge registered', { bridgeId: bridge.id, streamId: streamIdToListen });
            const guardrailWrappedStream = wrapOutputGuardrails(guardrailServices, guardrailContext, bridge.consume(), {
                streamId: streamIdToListen,
                personaId: effectivePersonaId,
                inputEvaluations: guardrailInputOutcome.evaluations ?? [],
            });
            if (orchestratorInput.workflowRequest) {
                const wfRequest = orchestratorInput.workflowRequest;
                try {
                    await this.startWorkflow(wfRequest.definitionId, orchestratorInput, {
                        workflowId: wfRequest.workflowId,
                        conversationId: wfRequest.conversationId ??
                            orchestratorInput.conversationId ??
                            orchestratorInput.sessionId,
                        createdByUserId: orchestratorInput.userId,
                        context: wfRequest.context,
                        roleAssignments: wfRequest.roleAssignments,
                        metadata: wfRequest.metadata,
                    });
                }
                catch (error) {
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
                    if (!chunk.metadata)
                        chunk.metadata = {};
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
        }
        catch (error) {
            const serviceError = AgentOSServiceError.wrap(error, GMIErrorCode.GMI_PROCESSING_ERROR, // Default code for facade-level processing errors
            `Error during AgentOS.processRequest for user '${orchestratorInput.userId}'`, 'AgentOS.processRequest');
            this.logger.error('processRequest failed', {
                error: serviceError,
                streamId: streamIdToListen,
            });
            const errorChunk = {
                type: AgentOSResponseChunkType.ERROR,
                streamId: streamIdToListen || baseStreamDebugId, // Use known streamId if available
                gmiInstanceId: serviceError.details?.gmiInstanceId || 'agentos_facade_error',
                personaId: effectivePersonaId,
                isFinal: true,
                timestamp: new Date().toISOString(),
                code: serviceError.code.toString(),
                message: serviceError.message, // Use the wrapped error's message
                details: serviceError.details || { name: serviceError.name, stack: serviceError.stack },
            };
            yield errorChunk; // Yield the processed error
        }
        finally {
            if (streamIdToListen) {
                const activeStreamIds = await this.streamingManager
                    .getActiveStreamIds()
                    .catch(() => []);
                if (activeStreamIds.includes(streamIdToListen)) {
                    await this.streamingManager
                        .deregisterClient(streamIdToListen, bridge.id)
                        .catch((deregError) => {
                        this.logger.warn('Failed to deregister bridge client', {
                            bridgeId: bridge.id,
                            streamId: streamIdToListen,
                            error: deregError.message,
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
    async *handleToolResult(streamId, toolCallId, toolName, toolOutput, isSuccess, errorMessage) {
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
    async *handleToolResults(streamId, toolResults) {
        this.ensureInitialized();
        if (!Array.isArray(toolResults) || toolResults.length === 0) {
            throw new AgentOSServiceError('At least one tool result is required to continue the stream.', GMIErrorCode.VALIDATION_ERROR, { streamId }, 'AgentOS.handleToolResults');
        }
        // Create a new bridge client for this specific tool result handling phase
        const bridge = new AsyncStreamClientBridge(`client-toolRes-${streamId.substring(0, 8)}-${toolResults[0].toolCallId.substring(0, 8)}`);
        try {
            console.log(`AgentOS.handleToolResults: Stream '${streamId}', ${toolResults.length} tool result(s). Orchestrator will push new chunks to this stream.`);
            // Register the bridge client to listen for new chunks on the existing stream
            await this.streamingManager.registerClient(streamId, bridge);
            console.log(`AgentOS.handleToolResults: Bridge client ${bridge.id} registered to stream ${streamId}.`);
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
        }
        catch (error) {
            const serviceError = AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, // Default code for facade-level tool result errors
            `Error during AgentOS.handleToolResults for stream '${streamId}'`, 'AgentOS.handleToolResults');
            console.error(`${serviceError.name}: ${serviceError.message}`, serviceError.toJSON());
            const errorChunk = {
                type: AgentOSResponseChunkType.ERROR,
                streamId: streamId,
                gmiInstanceId: serviceError.details?.gmiInstanceId || 'agentos_facade_tool_error',
                personaId: serviceError.details?.personaId || 'unknown_tool_persona',
                isFinal: true,
                timestamp: new Date().toISOString(),
                code: serviceError.code.toString(),
                message: serviceError.message,
                details: serviceError.details || { name: serviceError.name, stack: serviceError.stack },
            };
            yield errorChunk;
        }
        finally {
            console.log(`AgentOS.handleToolResults: Deregistering bridge client ${bridge.id} from stream ${streamId}.`);
            const activeStreamIds = await this.streamingManager
                .getActiveStreamIds()
                .catch(() => []);
            if (activeStreamIds.includes(streamId)) {
                await this.streamingManager.deregisterClient(streamId, bridge.id).catch((deregError) => {
                    console.error(`AgentOS.handleToolResults: Error deregistering bridge client ${bridge.id}: ${deregError.message}`);
                });
            }
            bridge.forceClose();
        }
    }
    listWorkflowDefinitions() {
        this.ensureInitialized();
        return this.workflowFacade.listWorkflowDefinitions();
    }
    async startWorkflow(definitionId, input, options = {}) {
        this.ensureInitialized();
        return this.workflowFacade.startWorkflow(definitionId, input, options);
    }
    async getWorkflow(workflowId) {
        this.ensureInitialized();
        return this.workflowFacade.getWorkflow(workflowId);
    }
    async listWorkflows(options) {
        this.ensureInitialized();
        return this.workflowFacade.listWorkflows(options);
    }
    async getWorkflowProgress(workflowId, sinceTimestamp) {
        this.ensureInitialized();
        return this.workflowFacade.getWorkflowProgress(workflowId, sinceTimestamp);
    }
    async updateWorkflowStatus(workflowId, status) {
        this.ensureInitialized();
        return this.workflowFacade.updateWorkflowStatus(workflowId, status);
    }
    async applyWorkflowTaskUpdates(workflowId, updates) {
        this.ensureInitialized();
        return this.workflowFacade.applyWorkflowTaskUpdates(workflowId, updates);
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
    async listAvailablePersonas(userId) {
        this.ensureInitialized();
        console.log(`AgentOS.listAvailablePersonas: Request for UserID: '${userId || 'anonymous/system'}'.`);
        try {
            return await this.gmiManager.listAvailablePersonas(userId);
        }
        catch (error) {
            throw AgentOSServiceError.wrap(error, GMIErrorCode.PERSONA_LOAD_ERROR, 'Failed to list available personas', 'AgentOS.listAvailablePersonas');
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
    async getConversationHistory(conversationId, userId) {
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
                }
                else {
                    console.warn(`AgentOS.getConversationHistory: User '${userId}' attempted to access conversation '${conversationId}' belonging to another user ('${context.getMetadata('userId')}').`);
                    // Consider throwing PERMISSION_DENIED for explicit denial.
                    return null;
                }
            }
            return null; // Conversation not found
        }
        catch (error) {
            throw AgentOSServiceError.wrap(error, GMIErrorCode.GMI_CONTEXT_ERROR, `Failed to retrieve conversation history for ID '${conversationId}'`, 'AgentOS.getConversationHistory');
        }
    }
    async getPendingExternalToolRequest(conversationId, userId) {
        this.ensureInitialized();
        const context = await this.getConversationHistory(conversationId, userId);
        if (!context) {
            return null;
        }
        const pendingRequest = context.getMetadata(AGENTOS_PENDING_EXTERNAL_TOOL_REQUEST_METADATA_KEY);
        return pendingRequest ?? null;
    }
    async *resumeExternalToolRequest(pendingRequest, toolResults, options = {}) {
        this.ensureInitialized();
        let streamIdToListen;
        let shouldDeregisterBridge = false;
        const bridge = new AsyncStreamClientBridge(`client-resumeToolReq-${pendingRequest.conversationId}-${Date.now()}`);
        try {
            streamIdToListen = await this.agentOSOrchestrator.orchestrateResumedToolResults(pendingRequest, toolResults, options);
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
        }
        catch (error) {
            const serviceError = AgentOSServiceError.wrap(error, GMIErrorCode.TOOL_ERROR, `Error during AgentOS.resumeExternalToolRequest for conversation '${pendingRequest.conversationId}'`, 'AgentOS.resumeExternalToolRequest');
            console.error(`${serviceError.name}: ${serviceError.message}`, serviceError.toJSON());
            const errorChunk = {
                type: AgentOSResponseChunkType.ERROR,
                streamId: streamIdToListen || pendingRequest.streamId,
                gmiInstanceId: serviceError.details?.gmiInstanceId ||
                    pendingRequest.gmiInstanceId ||
                    'agentos_facade_resume_error',
                personaId: serviceError.details?.personaId || pendingRequest.personaId || 'unknown_persona',
                isFinal: true,
                timestamp: new Date().toISOString(),
                code: serviceError.code.toString(),
                message: serviceError.message,
                details: serviceError.details || { name: serviceError.name, stack: serviceError.stack },
            };
            yield errorChunk;
        }
        finally {
            if (streamIdToListen && shouldDeregisterBridge) {
                const activeStreamIds = await this.streamingManager
                    .getActiveStreamIds()
                    .catch(() => []);
                if (activeStreamIds.includes(streamIdToListen)) {
                    await this.streamingManager
                        .deregisterClient(streamIdToListen, bridge.id)
                        .catch((deregError) => {
                        this.logger.warn('Failed to deregister resume bridge client', {
                            bridgeId: bridge.id,
                            streamId: streamIdToListen,
                            error: deregError.message,
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
    async receiveFeedback(userId, sessionId, personaId, feedbackPayload) {
        this.ensureInitialized();
        // Basic authorization checks for the user can be performed here.
        // E.g., await this.authService.validateUserExists(userId);
        console.log(`AgentOS.receiveFeedback: UserID '${userId}', SessionID '${sessionId}', PersonaID '${personaId}'. Payload:`, JSON.stringify(feedbackPayload).substring(0, 200) + '...');
        try {
            // Delegate feedback processing, typically to GMIManager or directly to the relevant GMI.
            await this.gmiManager.processUserFeedback(userId, sessionId, personaId, feedbackPayload);
            console.info(`AgentOS.receiveFeedback: Feedback processed successfully for UserID '${userId}', PersonaID '${personaId}'.`);
        }
        catch (error) {
            throw AgentOSServiceError.wrap(error, GMIErrorCode.GMI_FEEDBACK_ERROR, 'Failed to process user feedback', 'AgentOS.receiveFeedback');
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
    async shutdown() {
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
            await this.workflowFacade?.shutdown();
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
            if (this.conversationManager?.shutdown &&
                typeof this.conversationManager.shutdown === 'function') {
                await this.conversationManager.shutdown();
                console.log('AgentOS: ConversationManager shut down.');
            }
            if (this.toolOrchestrator && typeof this.toolOrchestrator.shutdown === 'function') {
                await this.toolOrchestrator.shutdown();
                console.log('AgentOS: ToolOrchestrator shut down.');
            }
            await this.discoveryInitializer?.shutdown();
            await this.ragMemoryInitializer?.shutdown();
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
            // Standalone memory closers are handled by ragMemoryInitializer.shutdown() above.
            // Other services like authService, subscriptionService, prisma might not have explicit async shutdown methods
            // if they manage connections passively or are handled by process exit.
            console.log('AgentOS Service: Graceful shutdown completed successfully.');
        }
        catch (error) {
            // Even if one component fails to shut down, attempt to log and continue if possible,
            // but report the overall failure.
            const serviceError = AgentOSServiceError.wrap(error, GMIErrorCode.GMI_SHUTDOWN_ERROR, 'Error during AgentOS service shutdown sequence', 'AgentOS.shutdown');
            console.error(`${serviceError.name}: ${serviceError.message}`, serviceError.toJSON());
            throw serviceError; // Re-throw to indicate shutdown was problematic.
        }
        finally {
            this.initialized = false; // Mark as uninitialized regardless of shutdown errors.
        }
    }
}
// Imported from extracted module
import { AsyncStreamClientBridge } from '../core/streaming/AsyncStreamClientBridge.js';
//# sourceMappingURL=AgentOS.js.map
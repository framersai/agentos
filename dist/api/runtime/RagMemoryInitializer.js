/**
 * @file RagMemoryInitializer.ts
 * @module api/RagMemoryInitializer
 *
 * @description
 * Encapsulates the initialization and lifecycle of the RAG (Retrieval
 * Augmented Generation) subsystem and standalone-memory integration,
 * previously spread across four private methods inside `AgentOS.ts`:
 *
 * - `resolveStandaloneMemoryConfig()` -- derive memoryTools, long-term
 *   retriever, and rolling-summary sink from a unified `Memory` backend.
 * - `configureManagedStandaloneMemory()` -- register lifecycle closers.
 * - `registerConfigMemoryTools()` -- load memory tools as an extension pack.
 * - `initializeRagSubsystem()` -- bootstrap EmbeddingManager,
 *   VectorStoreManager, and RetrievalAugmentor.
 *
 * AgentOS replaces its old `this.retrievalAugmentor`,
 * `this.ragVectorStoreManager`, `this.manageRetrievalAugmentorLifecycle`,
 * and `this.managedStandaloneMemoryClosers` fields with a single
 * `RagMemoryInitializer` instance and accesses values through public
 * read-only accessors.
 */
import { createMemoryToolsPack } from '../../memory/io/extension/MemoryToolsExtension.js';
import { createStandaloneMemoryLongTermRetriever, createStandaloneMemoryRollingSummarySink, } from '../../memory/io/integration/StandaloneMemoryBridge.js';
/**
 * @class RagMemoryInitializer
 *
 * Bootstraps standalone memory integration and the RAG subsystem.
 * Extracted from `AgentOS` to reduce monolith complexity.
 */
export class RagMemoryInitializer {
    constructor(deps) {
        this.deps = deps;
        this._manageLifecycle = false;
        this._managedStandaloneMemoryClosers = [];
    }
    // ---------------------------------------------------------------------------
    // Public accessors
    // ---------------------------------------------------------------------------
    /**
     * The retrieval augmentor, available after {@link initializeRag} completes.
     * May be `undefined` if RAG is not configured or initialization failed.
     */
    get retrievalAugmentor() {
        return this._retrievalAugmentor;
    }
    /**
     * The vector store manager, available after {@link initializeRag} completes.
     * May be `undefined` if RAG is not configured.
     */
    get vectorStoreManager() {
        return this._vectorStoreManager;
    }
    // ---------------------------------------------------------------------------
    // Standalone memory config resolution
    // ---------------------------------------------------------------------------
    /**
     * Resolve a standalone memory configuration into derived config fields:
     * memoryTools, longTermMemoryRetriever, rollingSummaryMemorySink.
     *
     * This is a pure transformation that does not mutate any instance state.
     * Static because it is called before the initializer's dependencies are
     * fully wired.
     *
     * @param config - The raw AgentOS configuration.
     * @returns A shallow copy of the config with derived fields populated.
     */
    static resolveConfig(config) {
        const standalone = config.standaloneMemory;
        if (!standalone || standalone.enabled === false) {
            return { ...config };
        }
        const resolved = { ...config };
        const memory = standalone.memory;
        if (!resolved.memoryTools && standalone.tools) {
            resolved.memoryTools = {
                memory: memory,
                ...(standalone.tools === true ? {} : standalone.tools),
            };
        }
        if (!resolved.longTermMemoryRetriever && standalone.longTermRetriever) {
            resolved.longTermMemoryRetriever = createStandaloneMemoryLongTermRetriever(memory, standalone.longTermRetriever === true ? undefined : standalone.longTermRetriever);
        }
        if (!resolved.rollingSummaryMemorySink && standalone.rollingSummarySink) {
            resolved.rollingSummaryMemorySink = createStandaloneMemoryRollingSummarySink(memory, standalone.rollingSummarySink === true ? undefined : standalone.rollingSummarySink);
        }
        return resolved;
    }
    // ---------------------------------------------------------------------------
    // Managed standalone memory lifecycle
    // ---------------------------------------------------------------------------
    /**
     * Register lifecycle closers for standalone memory backends that AgentOS
     * should shut down. Must be called after the frozen config is set.
     *
     * @param config - The frozen AgentOS config (post-resolve).
     */
    configureManaged(config) {
        this._managedStandaloneMemoryClosers = [];
        const standalone = config.standaloneMemory;
        if (!standalone || standalone.enabled === false || standalone.manageLifecycle !== true) {
            return;
        }
        if (config.memoryTools?.manageLifecycle === true) {
            return;
        }
        if (typeof standalone.memory.close !== 'function') {
            return;
        }
        this._managedStandaloneMemoryClosers.push(async () => {
            await standalone.memory.close?.();
        });
    }
    // ---------------------------------------------------------------------------
    // Memory tools registration
    // ---------------------------------------------------------------------------
    /**
     * Load configured memory tools as an extension pack.
     *
     * @param memoryToolsConfig - The memory tools config block from AgentOSConfig.
     * @param context           - Extension lifecycle context.
     */
    async registerMemoryTools(memoryToolsConfig, context) {
        if (!memoryToolsConfig || memoryToolsConfig.enabled === false) {
            return;
        }
        const { memory, enabled: _enabled, identifier, manageLifecycle, ...packOptions } = memoryToolsConfig;
        const pack = createMemoryToolsPack(memory, packOptions);
        const packIdentifier = identifier ?? 'config-memory-tools';
        if (manageLifecycle) {
            const existingOnDeactivate = pack.onDeactivate;
            pack.onDeactivate = async (lifecycleContext) => {
                await existingOnDeactivate?.(lifecycleContext);
                await memory.close?.();
            };
        }
        await this.deps.extensionManager.loadPackFromFactory(pack, packIdentifier, undefined, context);
        this.deps.logger.info('[AgentOS] Config memory tools enabled', {
            identifier: packIdentifier,
            packName: pack.name,
            toolCount: pack.descriptors.length,
        });
    }
    // ---------------------------------------------------------------------------
    // RAG subsystem
    // ---------------------------------------------------------------------------
    /**
     * Bootstrap the RAG subsystem: embedding manager, vector store manager,
     * and retrieval augmentor. If a caller-provided augmentor is present in
     * the config, it is used directly.
     *
     * @param config         - The frozen AgentOS config.
     * @param storageAdapter - Optional storage adapter for SQL vector stores.
     */
    async initializeRag(config, storageAdapter) {
        // Prefer caller-provided augmentor instance.
        if (config.retrievalAugmentor) {
            this._retrievalAugmentor = config.retrievalAugmentor;
            this._manageLifecycle = config.manageRetrievalAugmentorLifecycle === true;
            return;
        }
        const ragConfig = config.ragConfig;
        if (!ragConfig || ragConfig.enabled === false) {
            return;
        }
        try {
            const { EmbeddingManager } = await import('../rag/EmbeddingManager.js');
            const { VectorStoreManager } = await import('../rag/VectorStoreManager.js');
            const { RetrievalAugmentor } = await import('../rag/RetrievalAugmentor.js');
            const embeddingManager = new EmbeddingManager();
            await embeddingManager.initialize(ragConfig.embeddingManagerConfig, this.deps.modelProviderManager);
            const bindToStorageAdapter = ragConfig.bindToStorageAdapter === undefined
                ? true
                : ragConfig.bindToStorageAdapter === true;
            const patchedVectorStoreConfig = {
                ...ragConfig.vectorStoreManagerConfig,
                providers: ragConfig.vectorStoreManagerConfig.providers.map((provider) => {
                    if (bindToStorageAdapter &&
                        storageAdapter &&
                        provider?.type === 'sql' &&
                        !provider.adapter &&
                        !provider.storage) {
                        return { ...provider, adapter: storageAdapter };
                    }
                    return provider;
                }),
            };
            const vectorStoreManager = new VectorStoreManager();
            await vectorStoreManager.initialize(patchedVectorStoreConfig, ragConfig.dataSourceConfigs);
            const retrievalAugmentor = new RetrievalAugmentor();
            await retrievalAugmentor.initialize(ragConfig.retrievalAugmentorConfig, embeddingManager, vectorStoreManager);
            this._retrievalAugmentor = retrievalAugmentor;
            this._vectorStoreManager = vectorStoreManager;
            this._manageLifecycle = ragConfig.manageLifecycle !== false;
            console.log('AgentOS: RAG subsystem initialized.');
        }
        catch (error) {
            this.deps.logger.error('AgentOS: Failed to initialize RAG subsystem; continuing without retrieval augmentor.', {
                error: error?.message ?? error,
            });
        }
    }
    // ---------------------------------------------------------------------------
    // Shutdown
    // ---------------------------------------------------------------------------
    /**
     * Gracefully shut down owned RAG resources and managed standalone memory
     * backends.
     */
    async shutdown() {
        if (this._manageLifecycle && this._retrievalAugmentor?.shutdown) {
            await this._retrievalAugmentor.shutdown();
            console.log('AgentOS: RetrievalAugmentor shut down.');
        }
        if (this._manageLifecycle && this._vectorStoreManager?.shutdownAllProviders) {
            await this._vectorStoreManager.shutdownAllProviders();
            console.log('AgentOS: VectorStore providers shut down.');
        }
        for (const closeMemory of this._managedStandaloneMemoryClosers) {
            await closeMemory();
        }
        this._managedStandaloneMemoryClosers = [];
    }
}
//# sourceMappingURL=RagMemoryInitializer.js.map
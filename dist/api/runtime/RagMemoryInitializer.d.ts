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
import type { ILogger } from '../../logging/ILogger';
import type { AIModelProviderManager } from '../../core/llm/providers/AIModelProviderManager';
import type { IRetrievalAugmentor } from '../../rag/IRetrievalAugmentor';
import type { IVectorStoreManager } from '../../core/vector-store/IVectorStoreManager';
import type { StorageAdapter } from '@framers/sql-storage-adapter';
import type { ExtensionManager, ExtensionLifecycleContext } from '../extensions';
import type { AgentOSConfig, AgentOSMemoryToolsConfig } from './AgentOS';
/**
 * Dependencies injected into the initializer at construction time.
 */
export interface RagMemoryInitializerDependencies {
    /** Extension manager for loading memory tool packs. */
    extensionManager: ExtensionManager;
    /** Model provider manager used by the RAG embedding manager. */
    modelProviderManager: AIModelProviderManager;
    /** Logger scoped to this subsystem. */
    logger: ILogger;
}
/**
 * @class RagMemoryInitializer
 *
 * Bootstraps standalone memory integration and the RAG subsystem.
 * Extracted from `AgentOS` to reduce monolith complexity.
 */
export declare class RagMemoryInitializer {
    private readonly deps;
    private _retrievalAugmentor?;
    private _vectorStoreManager?;
    private _manageLifecycle;
    private _managedStandaloneMemoryClosers;
    constructor(deps: RagMemoryInitializerDependencies);
    /**
     * The retrieval augmentor, available after {@link initializeRag} completes.
     * May be `undefined` if RAG is not configured or initialization failed.
     */
    get retrievalAugmentor(): IRetrievalAugmentor | undefined;
    /**
     * The vector store manager, available after {@link initializeRag} completes.
     * May be `undefined` if RAG is not configured.
     */
    get vectorStoreManager(): IVectorStoreManager | undefined;
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
    static resolveConfig(config: AgentOSConfig): AgentOSConfig;
    /**
     * Register lifecycle closers for standalone memory backends that AgentOS
     * should shut down. Must be called after the frozen config is set.
     *
     * @param config - The frozen AgentOS config (post-resolve).
     */
    configureManaged(config: Readonly<AgentOSConfig>): void;
    /**
     * Load configured memory tools as an extension pack.
     *
     * @param memoryToolsConfig - The memory tools config block from AgentOSConfig.
     * @param context           - Extension lifecycle context.
     */
    registerMemoryTools(memoryToolsConfig: AgentOSMemoryToolsConfig | undefined, context: ExtensionLifecycleContext): Promise<void>;
    /**
     * Bootstrap the RAG subsystem: embedding manager, vector store manager,
     * and retrieval augmentor. If a caller-provided augmentor is present in
     * the config, it is used directly.
     *
     * @param config         - The frozen AgentOS config.
     * @param storageAdapter - Optional storage adapter for SQL vector stores.
     */
    initializeRag(config: Readonly<AgentOSConfig>, storageAdapter?: StorageAdapter): Promise<void>;
    /**
     * Gracefully shut down owned RAG resources and managed standalone memory
     * backends.
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=RagMemoryInitializer.d.ts.map
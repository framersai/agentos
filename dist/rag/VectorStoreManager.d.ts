/**
 * @fileoverview Implements the VectorStoreManager (`VectorStoreManager`), which is
 * responsible for initializing, configuring, and providing access to multiple
 * IVectorStore provider instances. It acts as a central registry and factory
 * for vector stores within the AgentOS RAG system.
 *
 * The manager uses `VectorStoreManagerConfig` to understand which providers to
 * initialize and `RagDataSourceConfig` to map logical data sources to specific
 * collections within those providers.
 *
 * @module backend/agentos/rag/VectorStoreManager
 * @see ./IVectorStoreManager.ts for the interface definition.
 * @see ./IVectorStore.ts for the underlying vector store interface.
 * @see ../config/VectorStoreConfiguration.ts for configuration structures.
 * @see ./vector_stores/InMemoryVectorStore.ts for an example provider.
 */
import { IVectorStoreManager, VectorStoreManagerHealthReport } from './IVectorStoreManager';
import { IVectorStore } from './IVectorStore';
import { VectorStoreManagerConfig, RagDataSourceConfig } from '../core/config/VectorStoreConfiguration';
/**
 * Implements the `IVectorStoreManager` interface.
 *
 * @class VectorStoreManager
 * @implements {IVectorStoreManager}
 */
export declare class VectorStoreManager implements IVectorStoreManager {
    private managerConfig;
    private initializedProviders;
    private dataSourceMappings;
    private isInitialized;
    readonly managerInstanceId: string;
    /**
     * Constructs a VectorStoreManager instance.
     * The manager is not operational until `initialize` is called.
     */
    constructor();
    /**
     * @inheritdoc
     */
    initialize(managerConfig: VectorStoreManagerConfig, dataSourceConfigs: RagDataSourceConfig[]): Promise<void>;
    /**
     * Ensures that the manager has been initialized.
     * @private
     * @throws {GMIError} If not initialized.
     */
    private ensureInitialized;
    /**
     * Creates an instance of an IVectorStore provider based on its configuration.
     * This method acts as a factory for vector store implementations.
     *
     * @private
     * @param {AnyVectorStoreProviderConfig} providerConfig - The configuration for the provider.
     * @returns {IVectorStore} An instance of the IVectorStore implementation.
     * @throws {GMIError} If the provider type is unknown or unsupported.
     */
    private createProviderInstance;
    /**
     * @inheritdoc
     */
    getProvider(providerId: string): IVectorStore;
    /**
     * @inheritdoc
     */
    getDefaultProvider(): IVectorStore;
    /**
     * @inheritdoc
     */
    getStoreForDataSource(dataSourceId: string): Promise<{
        store: IVectorStore;
        collectionName: string;
        dimension?: number;
    }>;
    /**
     * @inheritdoc
     */
    listProviderIds(): string[];
    /**
     * @inheritdoc
     */
    listDataSourceIds(): string[];
    /**
     * @inheritdoc
     */
    checkHealth(providerId?: string): Promise<VectorStoreManagerHealthReport>;
    /**
     * @inheritdoc
     */
    shutdownAllProviders(): Promise<void>;
}
//# sourceMappingURL=VectorStoreManager.d.ts.map
/**
 * @fileoverview Defines the interface for the VectorStoreManager.
 * The VectorStoreManager is responsible for initializing, configuring, and providing
 * access to multiple IVectorStore provider instances. It acts as a central point
 * of contact for the RetrievalAugmentor to obtain specific vector store connections
 * based on configuration, abstracting away the direct management of individual store clients.
 *
 * @module backend/agentos/rag/IVectorStoreManager
 * @see ./IVectorStore.ts for the underlying vector store interface.
 * @see ../config/VectorStoreConfiguration.ts for the `VectorStoreManagerConfig` structure.
 */

import { IVectorStore } from './IVectorStore';
import { VectorStoreManagerConfig, RagDataSourceConfig } from '../config/VectorStoreConfiguration';

/**
 * Represents the health status of managed vector store providers.
 *
 * @interface VectorStoreManagerHealthReport
 * @property {boolean} isOverallHealthy - True if all critical providers are healthy or if the manager itself is operational.
 * @property {Record<string, { isHealthy: boolean; details?: any }>} [providerStatus] -
 * An object detailing the health status of each individual managed provider, keyed by provider ID.
 * @property {any} [managerDetails] - Additional details about the manager's operational status.
 */
export interface VectorStoreManagerHealthReport {
  isOverallHealthy: boolean;
  providerStatus?: Record<string, { isHealthy: boolean; details?: any }>;
  managerDetails?: any;
}

/**
 * @interface IVectorStoreManager
 * @description Manages and provides access to various configured IVectorStore instances.
 * It allows higher-level services like the RetrievalAugmentor to be agnostic of the
 * specific vector database being used for a particular data source or category,
 * based on the provided `VectorStoreManagerConfig` and `RagDataSourceConfig`.
 */
export interface IVectorStoreManager {
  /**
   * Initializes the VectorStoreManager with configurations for all its managed providers
   * and data sources. This involves instantiating and initializing each configured
   * `IVectorStore` provider.
   *
   * @async
   * @param {VectorStoreManagerConfig} managerConfig - The manager's configuration, including an array of
   * individual vector store provider configurations.
   * @param {RagDataSourceConfig[]} dataSourceConfigs - An array of configurations for all logical data sources,
   * which map to specific providers and collections/indexes within them.
   * @returns {Promise<void>} A promise that resolves when the manager and all its
   * essential providers are successfully initialized.
   * @throws {Error} If initialization fails due to invalid configuration, inability to connect
   * to a critical provider, or other setup errors.
   */
  initialize(
    managerConfig: VectorStoreManagerConfig,
    dataSourceConfigs: RagDataSourceConfig[],
  ): Promise<void>;

  /**
   * Retrieves a specific, initialized IVectorStore provider instance by its configured ID.
   * The provider ID corresponds to `VectorStoreProviderConfig.id`.
   *
   * @param {string} providerId - The unique ID of the vector store provider instance.
   * @returns {IVectorStore} The IVectorStore instance.
   * @throws {Error} If the providerId is not configured, not found, or the provider
   * failed to initialize.
   */
  getProvider(providerId: string): IVectorStore;

  /**
   * Retrieves the default IVectorStore provider instance as configured in `VectorStoreManagerConfig.defaultProviderId`.
   *
   * @returns {IVectorStore} The default IVectorStore instance.
   * @throws {Error} If no default provider is configured, the configured default provider is not found,
   * or it failed to initialize.
   */
  getDefaultProvider(): IVectorStore;

  /**
   * Retrieves an IVectorStore instance and the specific collection name within that store
   * associated with a given logical RAG Data Source ID.
   * This is a convenience method for services like RetrievalAugmentor that operate on
   * logical `dataSourceId`s.
   *
   * @param {string} dataSourceId - The logical RAG Data Source ID (from `RagDataSourceConfig.dataSourceId`).
   * @returns {Promise<{ store: IVectorStore; collectionName: string; dimension?: number }>} A promise that resolves with the
   * IVectorStore instance, the actual collection name to use with that store for this data source,
   * and the expected embedding dimension.
   * @throws {Error} If the `dataSourceId` is not configured, or its associated provider is unavailable.
   */
  getStoreForDataSource(
    dataSourceId: string,
  ): Promise<{ store: IVectorStore; collectionName: string; dimension?: number }>;


  /**
   * Lists the unique IDs of all vector store providers configured and managed by this manager.
   *
   * @returns {string[]} An array of provider IDs.
   */
  listProviderIds(): string[];

  /**
   * Lists the unique IDs of all logical RAG Data Sources configured.
   *
   * @returns {string[]} An array of RAG Data Source IDs.
   */
  listDataSourceIds(): string[];


  /**
   * Checks the health of all managed vector store providers or a specific one.
   * This aggregates health information from individual `IVectorStore.checkHealth()` calls.
   *
   * @async
   * @param {string} [providerId] - Optional: If provided, checks only this specific provider.
   * If omitted, checks all configured providers.
   * @returns {Promise<VectorStoreManagerHealthReport>} A promise that resolves with a comprehensive health report.
   */
  checkHealth(providerId?: string): Promise<VectorStoreManagerHealthReport>;

  /**
   * Gracefully shuts down all managed vector store providers.
   * This calls the `shutdown()` method on each initialized `IVectorStore` instance.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when all providers have been shut down.
   */
  shutdownAllProviders(): Promise<void>;
}
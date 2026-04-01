/**
 * @fileoverview Implements an in-memory vector store (`InMemoryVectorStore`)
 * that adheres to the `IVectorStore` interface. This implementation is suitable
 * for development, testing, and scenarios where data persistence across sessions
 * is not required or is handled externally (e.g., via optional file persistence).
 *
 * It supports basic vector operations like upsert, query by similarity, and delete,
 * storing documents and their embeddings directly in memory.
 *
 * Key Features:
 * - Fast operations due to in-memory storage.
 * - No external dependencies for core functionality.
 * - Optional simple file-based persistence for basic session-to-session data retention.
 * - Supports metadata filtering.
 * - Implements cosine similarity for vector searches.
 *
 * @module backend/agentos/rag/vector_stores/InMemoryVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 * @see ../../../config/VectorStoreConfiguration.ts for `InMemoryVectorStoreConfig`.
 */
import { IVectorStore, VectorStoreProviderConfig, VectorDocument, QueryOptions, QueryResult, UpsertOptions, UpsertResult, DeleteOptions, DeleteResult, CreateCollectionOptions } from '../IVectorStore';
/**
 * Implements the `IVectorStore` interface using in-memory data structures.
 * Provides a simple, fast vector store primarily for development and testing.
 *
 * @class InMemoryVectorStore
 * @implements {IVectorStore}
 */
export declare class InMemoryVectorStore implements IVectorStore {
    private config;
    private collections;
    private isInitialized;
    private readonly providerId;
    /**
     * Constructs an InMemoryVectorStore instance.
     * Note: The store is not ready for use until `initialize` is called.
     */
    constructor();
    /**
     * @inheritdoc
     */
    initialize(config: VectorStoreProviderConfig): Promise<void>;
    /**
     * Ensures that the store has been initialized before use.
     * @private
     * @throws {GMIError} If the store is not initialized.
     */
    private ensureInitialized;
    /**
     * Retrieves a collection or throws an error if not found.
     * @private
     * @param {string} collectionName - The name of the collection.
     * @returns {InMemoryCollection} The collection object.
     * @throws {GMIError} If the collection does not exist.
     */
    private getCollection;
    /**
     * Creates or replaces an in-memory collection.
     */
    createCollection(collectionName: string, dimension: number, options?: CreateCollectionOptions): Promise<void>;
    /**
     * @inheritdoc
     */
    collectionExists(collectionName: string): Promise<boolean>;
    /**
     * @inheritdoc
     */
    deleteCollection(collectionName: string): Promise<void>;
    /**
     * @inheritdoc
     */
    upsert(collectionName: string, documents: VectorDocument[], options?: UpsertOptions): Promise<UpsertResult>;
    /**
     * @inheritdoc
     */
    query(collectionName: string, queryEmbedding: number[], options?: QueryOptions): Promise<QueryResult>;
    /**
     * @inheritdoc
     */
    delete(collectionName: string, ids?: string[], options?: DeleteOptions): Promise<DeleteResult>;
    /**
     * @inheritdoc
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * @inheritdoc
     */
    shutdown(): Promise<void>;
    /**
     * @inheritdoc
     */
    getStats(collectionName?: string): Promise<Record<string, any>>;
    /**
     * Calculates cosine similarity between two vectors.
     * @private
     * @param {number[]} vecA - The first vector.
     * @param {number[]} vecB - The second vector.
     * @returns {number} The cosine similarity (between -1 and 1).
     * @throws {Error} If vectors have different dimensions or are empty.
     */
    private cosineSimilarity;
    /**
     * Checks if a document's metadata matches the provided filter.
     * @private
     * @param {VectorDocument} doc - The document to check.
     * @param {MetadataFilter} filter - The filter to apply.
     * @returns {boolean} True if the document matches, false otherwise.
     */
    private matchesFilter;
    /**
     * Evaluates a single metadata field condition.
     * @private
     */
    private evaluateCondition;
    /**
     * Saves the current state of all collections to a file.
     * @private
     * @param {string} filePath - The path to the file where data will be saved.
     */
    private saveToFile;
    /**
     * Loads store state from a file.
     * @private
     * @param {string} filePath - The path to the file from which data will be loaded.
     */
    private loadFromFile;
}
//# sourceMappingURL=InMemoryVectorStore.d.ts.map
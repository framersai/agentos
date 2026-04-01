/**
 * @fileoverview This file provides a basic in-memory implementation of the IWorkingMemory interface.
 * It is suitable for single-instance deployments, development environments, or scenarios where
 * working memory persistence across sessions or application restarts is not required.
 *
 * This implementation stores all data within a JavaScript Map object in the application's memory.
 * As such, data will be lost when the application process terminates. For persistent or distributed
 * working memory, a different implementation (e.g., using Redis, a database, or a distributed cache)
 * would be necessary.
 *
 * Key characteristics:
 * - Fast: Operations are typically very fast as they involve direct memory access.
 * - Simple: Easy to understand and use, with no external dependencies.
 * - Volatile: Data does not persist beyond the lifetime of the GMI or application session it's tied to.
 * - Not Scalable for Distributed Systems: Not suitable if GMIs are distributed across multiple processes or servers.
 *
 * @module backend/agentos/cognitive_substrate/memory/InMemoryWorkingMemory
 * @see {@link IWorkingMemory} for the interface definition.
 */
import { IWorkingMemory } from './IWorkingMemory';
/**
 * Implements the {@link IWorkingMemory} interface using a simple in-memory Map.
 * This class provides a non-persistent, session-specific storage mechanism
 * for a GMI's operational data and adaptations.
 *
 * @class InMemoryWorkingMemory
 * @implements {IWorkingMemory}
 */
export declare class InMemoryWorkingMemory implements IWorkingMemory {
    /**
     * The unique identifier for this working memory instance.
     * @readonly
     * @type {string}
     */
    readonly id: string;
    /**
     * The GMI instance ID this working memory is associated with.
     * Used for scoping or namespacing if this memory instance were part of a larger system.
     * @private
     * @type {string | undefined}
     */
    private gmiInstanceId?;
    /**
     * The internal Map used to store key-value pairs.
     * @private
     * @type {Map<string, any>}
     */
    private memory;
    /**
     * Indicates whether the memory instance has been initialized.
     * @private
     * @type {boolean}
     */
    private isInitialized;
    /**
     * Constructs an InMemoryWorkingMemory instance.
     * A unique ID is generated for the memory instance.
     */
    constructor();
    /**
     * Initializes the in-memory working memory. For this implementation,
     * it primarily records the GMI instance ID and clears any pre-existing data
     * (though typically the map would be empty on fresh instantiation before initialization).
     *
     * @async
     * @param {string} gmiInstanceId - The ID of the GMI instance this working memory is associated with.
     * @param {Record<string, any>} [_config] - Optional configuration (ignored by this implementation).
     * @returns {Promise<void>} A promise that resolves when initialization is complete.
     */
    initialize(gmiInstanceId: string, _config?: Record<string, any>): Promise<void>;
    /**
     * Throws an error if the memory instance has not been initialized.
     * @private
     * @throws {Error} If not initialized.
     */
    private ensureInitialized;
    /**
     * Sets a value in the working memory.
     *
     * @async
     * @template T The type of the value being set.
     * @param {string} key - The key to store the value under.
     * @param {T} value - The value to store.
     * @returns {Promise<void>} A promise that resolves when the value is set.
     */
    set<T = any>(key: string, value: T): Promise<void>;
    /**
     * Retrieves a value from the working memory.
     *
     * @async
     * @template T The expected type of the retrieved value.
     * @param {string} key - The key of the value to retrieve.
     * @returns {Promise<T | undefined>} The retrieved value, or undefined if not found.
     */
    get<T = any>(key: string): Promise<T | undefined>;
    /**
     * Deletes a value from the working memory.
     *
     * @async
     * @param {string} key - The key of the value to delete.
     * @returns {Promise<void>} A promise that resolves when the value is deleted.
     */
    delete(key: string): Promise<void>;
    /**
     * Retrieves all key-value pairs from the working memory.
     * Returns a shallow copy of the internal map's entries as an object.
     *
     * @async
     * @returns {Promise<Record<string, any>>} An object containing all key-value pairs.
     */
    getAll(): Promise<Record<string, any>>;
    /**
     * Clears all data from the working memory.
     *
     * @async
     * @returns {Promise<void>} A promise that resolves when the memory is cleared.
     */
    clear(): Promise<void>;
    /**
     * Gets the number of items in the working memory.
     *
     * @async
     * @returns {Promise<number>} The number of key-value pairs.
     */
    size(): Promise<number>;
    /**
     * Checks if a key exists in the working memory.
     *
     * @async
     * @param {string} key - The key to check.
     * @returns {Promise<boolean>} True if the key exists, false otherwise.
     */
    has(key: string): Promise<boolean>;
    /**
     * Closes any open resources. For InMemoryWorkingMemory, this is a no-op
     * as there are no external resources to release.
     *
     * @async
     * @returns {Promise<void>} A promise that resolves immediately.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=InMemoryWorkingMemory.d.ts.map
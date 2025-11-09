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
import { v4 as uuidv4 } from 'uuid';

/**
 * Implements the {@link IWorkingMemory} interface using a simple in-memory Map.
 * This class provides a non-persistent, session-specific storage mechanism
 * for a GMI's operational data and adaptations.
 *
 * @class InMemoryWorkingMemory
 * @implements {IWorkingMemory}
 */
export class InMemoryWorkingMemory implements IWorkingMemory {
  /**
   * The unique identifier for this working memory instance.
   * @readonly
   * @type {string}
   */
  public readonly id: string;

  /**
   * The GMI instance ID this working memory is associated with.
   * Used for scoping or namespacing if this memory instance were part of a larger system.
   * @private
   * @type {string | undefined}
   */
  private gmiInstanceId?: string;

  /**
   * The internal Map used to store key-value pairs.
   * @private
   * @type {Map<string, any>}
   */
  private memory: Map<string, any>;

  /**
   * Indicates whether the memory instance has been initialized.
   * @private
   * @type {boolean}
   */
  private isInitialized: boolean = false;

  /**
   * Constructs an InMemoryWorkingMemory instance.
   * A unique ID is generated for the memory instance.
   */
  constructor() {
    this.id = uuidv4();
    this.memory = new Map<string, any>();
    // Note: Actual association with gmiInstanceId happens in initialize()
  }

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
  public async initialize(gmiInstanceId: string, _config?: Record<string, any>): Promise<void> {
    if (this.isInitialized && this.gmiInstanceId && this.gmiInstanceId !== gmiInstanceId) {
      console.warn(`InMemoryWorkingMemory (ID: ${this.id}) is being re-initialized for a different GMI instance (Old: ${this.gmiInstanceId}, New: ${gmiInstanceId}). Clearing existing data.`);
      this.memory.clear();
    } else if (this.isInitialized) {
      // console.log(`InMemoryWorkingMemory (ID: ${this.id}) for GMI ${gmiInstanceId} re-initialized.`);
      // Potentially clear or re-evaluate state if re-initializing for the same GMI.
      // For now, we'll allow re-initialization without clearing if GMI ID is the same.
    }

    this.gmiInstanceId = gmiInstanceId;
    this.isInitialized = true;
    // console.log(`InMemoryWorkingMemory (ID: ${this.id}) initialized for GMI Instance ID: ${this.gmiInstanceId}.`);
  }

  /**
   * Throws an error if the memory instance has not been initialized.
   * @private
   * @throws {Error} If not initialized.
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(`InMemoryWorkingMemory (ID: ${this.id}) has not been initialized. Call initialize() first.`);
    }
  }

  /**
   * Sets a value in the working memory.
   *
   * @async
   * @template T The type of the value being set.
   * @param {string} key - The key to store the value under.
   * @param {T} value - The value to store.
   * @returns {Promise<void>} A promise that resolves when the value is set.
   */
  public async set<T = any>(key: string, value: T): Promise<void> {
    this.ensureInitialized();
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error('Invalid key: Key must be a non-empty string.');
    }
    this.memory.set(key, value);
  }

  /**
   * Retrieves a value from the working memory.
   *
   * @async
   * @template T The expected type of the retrieved value.
   * @param {string} key - The key of the value to retrieve.
   * @returns {Promise<T | undefined>} The retrieved value, or undefined if not found.
   */
  public async get<T = any>(key: string): Promise<T | undefined> {
    this.ensureInitialized();
    if (typeof key !== 'string') {
        // console.warn('Invalid key type provided to get(): expected string.');
        return undefined;
    }
    return this.memory.get(key) as T | undefined;
  }

  /**
   * Deletes a value from the working memory.
   *
   * @async
   * @param {string} key - The key of the value to delete.
   * @returns {Promise<void>} A promise that resolves when the value is deleted.
   */
  public async delete(key: string): Promise<void> {
    this.ensureInitialized();
    if (typeof key !== 'string') {
        // console.warn('Invalid key type provided to delete(): expected string.');
        return;
    }
    this.memory.delete(key);
  }

  /**
   * Retrieves all key-value pairs from the working memory.
   * Returns a shallow copy of the internal map's entries as an object.
   *
   * @async
   * @returns {Promise<Record<string, any>>} An object containing all key-value pairs.
   */
  public async getAll(): Promise<Record<string, any>> {
    this.ensureInitialized();
    // Create a new object from the map entries to prevent direct modification of the internal map
    return Object.fromEntries(new Map(this.memory));
  }

  /**
   * Clears all data from the working memory.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when the memory is cleared.
   */
  public async clear(): Promise<void> {
    this.ensureInitialized();
    this.memory.clear();
    // console.log(`InMemoryWorkingMemory (ID: ${this.id}) for GMI ${this.gmiInstanceId} cleared.`);
  }

  /**
   * Gets the number of items in the working memory.
   *
   * @async
   * @returns {Promise<number>} The number of key-value pairs.
   */
  public async size(): Promise<number> {
    this.ensureInitialized();
    return this.memory.size;
  }

  /**
   * Checks if a key exists in the working memory.
   *
   * @async
   * @param {string} key - The key to check.
   * @returns {Promise<boolean>} True if the key exists, false otherwise.
   */
  public async has(key: string): Promise<boolean> {
    this.ensureInitialized();
    if (typeof key !== 'string') {
        return false;
    }
    return this.memory.has(key);
  }

  /**
   * Closes any open resources. For InMemoryWorkingMemory, this is a no-op
   * as there are no external resources to release.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves immediately.
   */
  public async close(): Promise<void> {
    this.ensureInitialized();
    // No resources to release for in-memory implementation.
    // console.log(`InMemoryWorkingMemory (ID: ${this.id}) for GMI ${this.gmiInstanceId} close() called (no-op).`);
  }
}
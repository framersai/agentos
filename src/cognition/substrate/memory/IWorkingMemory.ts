/**
 * @fileoverview Defines the interface for a Generalized Mind Instance's (GMI) working memory.
 * Working memory is responsible for storing and managing session-specific data, including:
 * - Short-term adaptations based on user interaction (e.g., mood adjustments).
 * - User preferences explicitly stated or inferred during the current session.
 * - Temporary operational data required by the GMI for its current tasks.
 * - Intermediate results from multi-step reasoning or tool use.
 *
 * This interface provides a contract for various working memory implementations,
 * which could range from simple in-memory stores to more persistent or distributed solutions.
 * @module backend/agentos/cognitive_substrate/memory/IWorkingMemory
 */

export interface IWorkingMemory {
  /**
   * A unique identifier for this specific working memory instance.
   * This ID may be correlated with a GMI instance or a user session.
   * @readonly
   * @type {string}
   */
  readonly id: string;

  /**
   * Initializes the working memory instance. This method should be called before
   * any other operations are performed. It can be used to set up connections,
   * load initial data, or apply configuration.
   *
   * @async
   * @param {string} gmiInstanceId - The ID of the GMI instance this working memory is associated with.
   * This allows the memory to be scoped or namespaced if needed.
   * @param {Record<string, any>} [config] - Optional memory-specific configuration data.
   * The structure of this config is implementation-dependent.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   * @throws {Error} If initialization fails (e.g., cannot connect to a backing store).
   */
  initialize(gmiInstanceId: string, config?: Record<string, any>): Promise<void>;

  /**
   * Stores a value in the working memory associated with a specific key.
   * If the key already exists, its value will be overwritten.
   * Values can be of any serializable type.
   *
   * @async
   * @param {string} key - The key under which to store the value. Keys should be unique within this memory instance.
   * @param {any} value - The value to store. For complex objects, ensure they are serializable if persistence is involved.
   * @returns {Promise<void>} A promise that resolves when the value has been successfully set.
   * @throws {Error} If the value cannot be set (e.g., serialization issues, storage errors).
   * @example
   * await workingMemory.set('current_mood', 'empathetic');
   * await workingMemory.set('user_preferences', { theme: 'dark', notifications: false });
   */
  set<T = any>(key: string, value: T): Promise<void>;

  /**
   * Retrieves a value from the working memory based on its key.
   *
   * @async
   * @template T - The expected type of the retrieved value.
   * @param {string} key - The key of the value to retrieve.
   * @returns {Promise<T | undefined>} A promise that resolves with the retrieved value,
   * or `undefined` if the key is not found in the memory.
   * @throws {Error} If retrieval fails for reasons other than the key not being found (e.g., deserialization issues).
   * @example
   * const currentMood = await workingMemory.get<string>('current_mood');
   * if (currentMood) {
   * console.log(`Current mood is: ${currentMood}`);
   * }
   */
  get<T = any>(key: string): Promise<T | undefined>;

  /**
   * Removes a key-value pair from the working memory.
   * If the key does not exist, the operation should complete without error.
   *
   * @async
   * @param {string} key - The key of the value to delete.
   * @returns {Promise<void>} A promise that resolves when the value has been deleted or if the key was not found.
   * @throws {Error} If deletion fails for other reasons (e.g., storage errors).
   * @example
   * await workingMemory.delete('temporary_calculation_result');
   */
  delete(key: string): Promise<void>;

  /**
   * Retrieves all key-value pairs currently stored in the working memory.
   * This is useful for snapshotting, debugging, or transferring memory state.
   *
   * @async
   * @returns {Promise<Record<string, any>>} A promise that resolves with an object
   * containing all key-value pairs in the memory.
   * Returns an empty object if the memory is empty.
   * @throws {Error} If there's an issue retrieving all data.
   * @example
   * const allMemoryContents = await workingMemory.getAll();
   * console.log('Full working memory:', allMemoryContents);
   */
  getAll(): Promise<Record<string, any>>;

  /**
   * Clears all data from the working memory, effectively resetting it to an empty state.
   * This is often used when a session ends or a persona is switched, and session-specific
   * adaptations should not persist.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when the memory has been cleared.
   * @throws {Error} If clearing fails (e.g., storage errors).
   * @example
   * await workingMemory.clear(); // Session ended, wipe working memory.
   */
  clear(): Promise<void>;

  /**
   * Returns the number of key-value pairs currently stored in the working memory.
   *
   * @async
   * @returns {Promise<number>} A promise that resolves with the count of items in the memory.
   * @throws {Error} If the size cannot be determined.
   * @example
   * const itemCount = await workingMemory.size();
   * console.log(`Working memory contains ${itemCount} items.`);
   */
  size(): Promise<number>;

  /**
   * Checks if a specific key exists in the working memory.
   *
   * @async
   * @param {string} key - The key to check for existence.
   * @returns {Promise<boolean>} A promise that resolves to `true` if the key exists, `false` otherwise.
   * @throws {Error} If the check fails for reasons other than key presence.
   * @example
   * if (await workingMemory.has('user_id')) {
   * // User ID is present in working memory
   * }
   */
  has(key: string): Promise<boolean>;

  /**
   * Closes any open resources associated with this working memory instance,
   * such as database connections or file handles. This should be called when
   * the GMI instance is being shut down to ensure graceful resource release.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when resources are released.
   * @throws {Error} If closing fails.
   */
  close?(): Promise<void>;
}
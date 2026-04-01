/**
 * @fileoverview Manages the lifecycle of ConversationContext instances in AgentOS.
 * Responsible for creating, retrieving, storing (both in-memory and persistently
 * using sql-storage-adapter), and managing active conversation states. It ensures conversations
 * can be rehydrated and maintained across sessions.
 *
 * @module backend/agentos/core/conversation/ConversationManager
 * @see ./ConversationContext.ts
 * @see ../../ai_utilities/IUtilityAI.ts
 * @see @framers/sql-storage-adapter
 */
import { ConversationContext, ConversationContextConfig } from './ConversationContext';
import { IUtilityAI } from '../../nlp/ai_utilities/IUtilityAI';
import type { StorageAdapter } from '@framers/sql-storage-adapter';
/**
 * Configuration for the ConversationManager.
 * Defines settings for managing conversation contexts, including persistence options.
 *
 * @interface ConversationManagerConfig
 * @property {Partial<ConversationContextConfig>} [defaultConversationContextConfig] - Default configuration for newly created ConversationContext instances.
 * @property {number} [maxActiveConversationsInMemory=1000] - Maximum number of active conversations to keep in memory. LRU eviction may apply.
 * @property {number} [inactivityTimeoutMs=3600000] - Timeout in milliseconds for inactive conversations. If set, a cleanup process
 * might be implemented to evict conversations inactive for this duration. (Currently conceptual)
 * @property {boolean} [persistenceEnabled=true] - Controls whether storage adapter is used for database persistence of conversations.
 * If true, a StorageAdapter instance must be provided during initialization.
 */
export interface ConversationManagerConfig {
    defaultConversationContextConfig?: Partial<ConversationContextConfig>;
    maxActiveConversationsInMemory?: number;
    inactivityTimeoutMs?: number;
    persistenceEnabled?: boolean;
    /**
     * When enabled, persistence becomes append-only:
     * - `conversations` and `conversation_messages` rows are never updated or deleted
     * - new messages are inserted once and subsequent saves are idempotent
     *
     * This is intended to support provenance "sealed" mode / immutability guarantees.
     */
    appendOnlyPersistence?: boolean;
}
/**
 * @class ConversationManager
 * @description Manages ConversationContext instances for AgentOS, handling their
 * creation, retrieval, in-memory caching, and persistent storage via sql-storage-adapter.
 * This class is vital for maintaining conversational state across user sessions and
 * GMI interactions.
 */
export declare class ConversationManager {
    /**
     * Configuration for the ConversationManager instance.
     * @private
     * @type {Required<ConversationManagerConfig>}
     */
    private config;
    /**
     * In-memory cache for active ConversationContext instances.
     * Key: Conversation ID (sessionId of ConversationContext).
     * Value: ConversationContext instance.
     * @private
     * @type {Map<string, ConversationContext>}
     */
    private activeConversations;
    /**
     * Optional IUtilityAI service instance, passed to ConversationContexts.
     * @private
     * @type {IUtilityAI | undefined}
     */
    private utilityAIService?;
    /**
     * Optional StorageAdapter instance for database interaction.
     * @private
     * @type {StorageAdapter | undefined}
     */
    private storageAdapter?;
    /**
     * Flag indicating if the manager has been successfully initialized.
     * @private
     * @type {boolean}
     */
    private initialized;
    /**
     * Unique identifier for this ConversationManager instance.
     * @public
     * @readonly
     * @type {string}
     */
    readonly managerId: string;
    /**
     * Constructs a ConversationManager instance.
     * Initialization via `initialize()` is required before use.
     */
    constructor();
    /**
     * Initializes the ConversationManager with its configuration and dependencies.
     * This method sets up persistence if enabled and prepares the manager for operation.
     *
     * @public
     * @async
     * @param {ConversationManagerConfig} config - Configuration for the manager.
     * @param {IUtilityAI} [utilityAIService] - Optional IUtilityAI instance, primarily
     * used by ConversationContext instances for features like summarization.
     * @param {StorageAdapter} [storageAdapter] - Optional storage adapter for database persistence.
     * Required if `config.persistenceEnabled` is true.
     * @returns {Promise<void>} A promise that resolves when initialization is complete.
     * @throws {GMIError} If configuration is invalid or dependencies are missing when required.
     */
    initialize(config: ConversationManagerConfig, utilityAIService?: IUtilityAI, storageAdapter?: StorageAdapter): Promise<void>;
    /**
     * Ensures that the manager has been initialized before performing operations.
     * @private
     * @throws {GMIError} If the manager is not initialized.
     */
    private ensureInitialized;
    /**
     * Creates a new conversation context or retrieves an existing one.
     * If `conversationId` is provided:
     * - Tries to find it in the active (in-memory) cache.
     * - If not in cache and persistence is enabled, tries to load from the database.
     * - If not found in DB or persistence disabled, creates a new context with this ID.
     * If no `conversationId` is provided, a new one is generated.
     * Manages in-memory cache size by evicting the oldest conversation if capacity is reached.
     *
     * @public
     * @async
     * @param {string} [conversationId] - Optional ID of an existing conversation. This ID will also be used as the `ConversationContext.sessionId`.
     * @param {string} [userId] - ID of the user associated with the conversation.
     * @param {string} [gmiInstanceId] - ID of the GMI instance this conversation is for.
     * @param {string} [activePersonaId] - ID of the active persona for the conversation.
     * @param {Record<string, any>} [initialMetadata={}] - Initial metadata for a new conversation.
     * @param {Partial<ConversationContextConfig>} [overrideConfig] - Config overrides for a new context.
     * @returns {Promise<ConversationContext>} The created or retrieved ConversationContext.
     * @throws {GMIError} If essential parameters for creating a new context are missing or if an error occurs.
     */
    getOrCreateConversationContext(conversationId?: string, userId?: string, gmiInstanceId?: string, activePersonaId?: string, initialMetadata?: Record<string, any>, overrideConfig?: Partial<ConversationContextConfig>): Promise<ConversationContext>;
    /**
     * Retrieves a ConversationContext if present in memory or persistent storage.
     * Returns null when not found.
     */
    getConversation(conversationId: string): Promise<ConversationContext | null>;
    /**
     * Lists minimal context info for a given session. Currently returns a single entry
     * matching the provided sessionId if found in memory or storage.
     */
    listContextsForSession(sessionId: string): Promise<Array<{
        sessionId: string;
        createdAt: number;
    }>>;
    /**
     * Saves a ConversationContext to persistent storage if persistence is enabled.
     * This is called automatically when a context is evicted from memory or during shutdown.
     *
     * @public
     * @async
     * @param {ConversationContext} context - The ConversationContext to save.
     * @throws {GMIError} If the save operation fails.
     */
    saveConversation(context: ConversationContext): Promise<void>;
    /**
     * Deletes a conversation from both memory and persistent storage.
     *
     * @public
     * @async
     * @param {string} conversationId - The ID of the conversation to delete.
     * @throws {GMIError} If the deletion fails.
     */
    deleteConversation(conversationId: string): Promise<void>;
    /**
     * Gets basic info about a conversation (ID and creation timestamp).
     * Checks in-memory cache first, then persistent storage if enabled.
     *
     * @public
     * @async
     * @param {string} sessionId - The ID of the conversation.
     * @returns {Promise<Array<{ sessionId: string; createdAt: number }>>} Array with conversation info, or empty if not found.
     */
    getConversationInfo(sessionId: string): Promise<Array<{
        sessionId: string;
        createdAt: number;
    }>>;
    /**
     * Gets the last active time for a conversation, typically the timestamp of the last message or update.
     * Checks in-memory cache first, then persistent storage if enabled.
     *
     * @public
     * @async
     * @param {string} conversationId - The ID of the conversation.
     * @returns {Promise<number | undefined>} Timestamp of last activity (Unix epoch ms), or undefined if not found.
     */
    getLastActiveTimeForConversation(conversationId: string): Promise<number | undefined>;
    /**
     * Evicts the oldest (Least Recently Used based on `_lastAccessed` metadata)
     * conversation from the in-memory cache.
     * If persistence is enabled, ensures the conversation is saved to DB before eviction.
     * @private
     * @async
     */
    private evictOldestConversation;
    /**
     * Saves a ConversationContext to the database using StorageAdapter.
     * This is an upsert operation: creates if not exists, updates if exists.
     * Handles serialization of messages and metadata within a transaction.
     *
     * @async
     * @private
     * @param {ConversationContext} context - The ConversationContext to save.
     * @throws {GMIError} If the database operation fails.
     */
    private saveConversationToDB;
    /**
     * Loads a ConversationContext from the database using StorageAdapter.
     * Reconstructs the ConversationContext instance along with its messages and metadata.
     *
     * @async
     * @private
     * @param {string} conversationId - The ID of the conversation to load.
     * @returns {Promise<ConversationContext | undefined>} The loaded ConversationContext or undefined if not found.
     * @throws {GMIError} If the database operation fails or data inconsistency is detected.
     */
    private loadConversationFromDB;
    /**
     * Shuts down the ConversationManager.
     * If persistence is enabled, ensures all active conversations are saved to the database.
     * Clears the in-memory cache of conversations.
     *
     * @public
     * @async
     * @returns {Promise<void>}
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=ConversationManager.d.ts.map
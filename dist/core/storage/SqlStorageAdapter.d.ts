/**
 * @file SqlStorageAdapter.ts
 * @description SQL-based storage adapter for AgentOS using @framers/sql-storage-adapter.
 *
 * This implementation provides a complete persistence layer for conversations and messages
 * using the cross-platform SQL storage adapter. It automatically handles:
 * - Schema creation and migration
 * - CRUD operations for conversations and messages
 * - Transaction support for atomic operations
 * - Cross-platform compatibility (SQLite, PostgreSQL, SQL.js, etc.)
 *
 * **Architecture:**
 * ```
 * AgentOS ConversationManager
 *          ↓
 *   SqlStorageAdapter (this file)
 *          ↓
 *   @framers/sql-storage-adapter
 *          ↓
 *   Database (SQLite/PostgreSQL/etc.)
 * ```
 *
 * @version 1.0.0
 * @author AgentOS Team
 * @license MIT
 */
import { type StorageResolutionOptions } from '@framers/sql-storage-adapter';
import type { IStorageAdapter, IConversation, IConversationMessage, IMessageQueryOptions, ITokenUsage } from './IStorageAdapter.js';
/**
 * Configuration options for the AgentOS SQL storage adapter.
 *
 * Extends the base storage resolution options with AgentOS-specific settings.
 *
 * @interface AgentOsSqlStorageConfig
 * @extends {StorageResolutionOptions}
 * @property {boolean} [enableAutoMigration] - Automatically run schema migrations on init
 * @property {number} [messageRetentionDays] - Auto-delete messages older than X days (0 = disabled)
 *
 * @example
 * ```typescript
 * const config: AgentOsSqlStorageConfig = {
 *   filePath: './agentos.db',
 *   priority: ['better-sqlite3', 'sqljs'],
 *   enableAutoMigration: true,
 *   messageRetentionDays: 90 // Keep 3 months of history
 * };
 * ```
 */
export interface AgentOsSqlStorageConfig extends StorageResolutionOptions {
    enableAutoMigration?: boolean;
    messageRetentionDays?: number;
}
/**
 * SQL storage adapter implementation for AgentOS.
 *
 * Provides full persistence for conversations and messages using a SQL database.
 * Wraps @framers/sql-storage-adapter to provide AgentOS-specific schema and operations.
 *
 * **Features:**
 * - Cross-platform SQL support (SQLite, PostgreSQL, SQL.js, Capacitor)
 * - Automatic schema creation and migration
 * - Efficient querying with indexes
 * - Transaction support for atomic operations
 * - Type-safe API with full TypeScript support
 *
 * **Database Schema:**
 * - `conversations` table: Stores conversation metadata
 * - `messages` table: Stores individual messages with foreign key to conversations
 * - Indexes on frequently queried columns for performance
 *
 * @class SqlStorageAdapter
 * @implements {IStorageAdapter}
 *
 * @example
 * ```typescript
 * // Node.js with SQLite
 * const storage = new SqlStorageAdapter({
 *   type: 'better-sqlite3',
 *   database: './data/agentos.db',
 *   enableWAL: true
 * });
 *
 * await storage.initialize();
 *
 * // Browser with SQL.js
 * const browserStorage = new SqlStorageAdapter({
 *   type: 'sql.js',
 *   database: 'agentos.db',
 *   enableAutoMigration: true
 * });
 *
 * await browserStorage.initialize();
 * ```
 */
export declare class SqlStorageAdapter implements IStorageAdapter {
    private adapter;
    private config;
    private initialized;
    /**
     * Creates a new SQL storage adapter instance.
     *
     * @param {AgentOsSqlStorageConfig} config - Storage configuration
     *
     * @example
     * ```typescript
     * const storage = new SqlStorageAdapter({
     *   filePath: './agentos.db',
     *   priority: ['better-sqlite3']
     * });
     * ```
     */
    constructor(config?: AgentOsSqlStorageConfig);
    /**
     * Initializes the storage adapter and creates the database schema.
     *
     * **Schema created:**
     * - `conversations` table with indexes on userId and agentId
     * - `messages` table with indexes on conversationId and timestamp
     * - Foreign key constraints for referential integrity
     *
     * **Must be called before any other operations.**
     *
     * @returns {Promise<void>}
     * @throws {Error} If database connection or schema creation fails
     *
     * @example
     * ```typescript
     * await storage.initialize();
     * console.log('Storage ready!');
     * ```
     */
    initialize(): Promise<void>;
    /**
     * Closes the database connection and releases resources.
     *
     * @returns {Promise<void>}
     *
     * @example
     * ```typescript
     * await storage.close();
     * ```
     */
    close(): Promise<void>;
    /**
     * Creates a new conversation record.
     *
     * @param {IConversation} conversation - Conversation to create
     * @returns {Promise<IConversation>} The created conversation
     * @throws {Error} If conversation with same ID exists or validation fails
     */
    createConversation(conversation: IConversation): Promise<IConversation>;
    /**
     * Retrieves a conversation by ID.
     *
     * @param {string} conversationId - The conversation ID
     * @returns {Promise<IConversation | null>} The conversation or null if not found
     */
    getConversation(conversationId: string): Promise<IConversation | null>;
    /**
     * Updates a conversation's fields.
     *
     * @param {string} conversationId - Conversation to update
     * @param {Partial<IConversation>} updates - Fields to update
     * @returns {Promise<IConversation>} Updated conversation
     * @throws {Error} If conversation doesn't exist
     */
    updateConversation(conversationId: string, updates: Partial<IConversation>): Promise<IConversation>;
    /**
     * Deletes a conversation and all its messages.
     *
     * @param {string} conversationId - Conversation to delete
     * @returns {Promise<boolean>} True if deleted, false if not found
     */
    deleteConversation(conversationId: string): Promise<boolean>;
    /**
     * Lists conversations for a user with optional filtering.
     *
     * @param {string} userId - User whose conversations to list
     * @param {Object} [options] - Query options
     * @returns {Promise<IConversation[]>} Array of conversations
     */
    listConversations(userId: string, options?: {
        limit?: number;
        offset?: number;
        agentId?: string;
    }): Promise<IConversation[]>;
    /**
     * Stores a message and updates conversation's lastActivity.
     *
     * @param {IConversationMessage} message - Message to store
     * @returns {Promise<IConversationMessage>} The stored message
     * @throws {Error} If conversation doesn't exist
     */
    storeMessage(message: IConversationMessage): Promise<IConversationMessage>;
    /**
     * Retrieves a message by ID.
     *
     * @param {string} messageId - Message ID
     * @returns {Promise<IConversationMessage | null>} The message or null
     */
    getMessage(messageId: string): Promise<IConversationMessage | null>;
    /**
     * Retrieves messages for a conversation with filtering.
     *
     * @param {string} conversationId - Conversation ID
     * @param {IMessageQueryOptions} [options] - Query options
     * @returns {Promise<IConversationMessage[]>} Array of messages
     */
    getMessages(conversationId: string, options?: IMessageQueryOptions): Promise<IConversationMessage[]>;
    /**
     * Deletes a specific message.
     *
     * @param {string} messageId - Message to delete
     * @returns {Promise<boolean>} True if deleted
     */
    deleteMessage(messageId: string): Promise<boolean>;
    /**
     * Deletes all messages in a conversation.
     *
     * @param {string} conversationId - Conversation whose messages to delete
     * @returns {Promise<number>} Number of messages deleted
     */
    deleteMessagesForConversation(conversationId: string): Promise<number>;
    /**
     * Counts messages in a conversation.
     *
     * @param {string} conversationId - Conversation to count
     * @returns {Promise<number>} Message count
     */
    getMessageCount(conversationId: string): Promise<number>;
    /**
     * Calculates total token usage for a conversation.
     *
     * @param {string} conversationId - Conversation to analyze
     * @returns {Promise<ITokenUsage>} Aggregated token usage
     */
    getConversationTokenUsage(conversationId: string): Promise<ITokenUsage>;
    /**
     * Ensures the adapter has been initialized.
     *
     * @private
     * @throws {Error} If not initialized
     */
    private ensureInitialized;
    /**
     * Converts a database row to an IConversation object.
     *
     * @private
     * @param {any} row - Database row
     * @returns {IConversation} Conversation object
     */
    private rowToConversation;
    /**
     * Converts a database row to an IConversationMessage object.
     *
     * @private
     * @param {any} row - Database row
     * @returns {IConversationMessage} Message object
     */
    private rowToMessage;
}
//# sourceMappingURL=SqlStorageAdapter.d.ts.map
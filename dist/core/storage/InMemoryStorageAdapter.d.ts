/**
 * @file InMemoryStorageAdapter.ts
 * @description In-memory storage adapter for AgentOS (testing and non-persistent scenarios).
 *
 * This implementation stores all data in memory using JavaScript Maps and Arrays.
 * Perfect for:
 * - Unit testing without database setup
 * - Ephemeral sessions that don't need persistence
 * - Development and prototyping
 * - CI/CD pipelines
 *
 * **Warning:** All data is lost when the process terminates or adapter is closed.
 *
 * @version 1.0.0
 * @author AgentOS Team
 * @license MIT
 */
import type { IStorageAdapter, IConversation, IConversationMessage, IMessageQueryOptions, ITokenUsage } from './IStorageAdapter.js';
/**
 * In-memory storage adapter for AgentOS.
 *
 * Provides a complete implementation of IStorageAdapter without any persistence.
 * All data is stored in JavaScript Map and Array structures.
 *
 * **Use Cases:**
 * - Unit and integration testing
 * - Development environments
 * - Stateless sessions
 * - CI/CD pipelines
 * - Prototyping and demos
 *
 * **Characteristics:**
 * - Zero setup (no database required)
 * - Extremely fast (no I/O)
 * - Non-persistent (data lost on process exit)
 * - Thread-safe in single-threaded environments
 *
 * @class InMemoryStorageAdapter
 * @implements {IStorageAdapter}
 *
 * @example
 * ```typescript
 * // Perfect for testing
 * const storage = new InMemoryStorageAdapter();
 * await storage.initialize();
 *
 * const conversation = await storage.createConversation({
 *   id: 'test-conv',
 *   userId: 'test-user',
 *   createdAt: Date.now(),
 *   lastActivity: Date.now()
 * });
 *
 * // No cleanup needed for tests
 * await storage.close();
 * ```
 */
export declare class InMemoryStorageAdapter implements IStorageAdapter {
    private conversations;
    private messages;
    private messagesByConversation;
    private initialized;
    /**
     * Creates a new in-memory storage adapter.
     *
     * No configuration needed since everything is in memory.
     *
     * @example
     * ```typescript
     * const storage = new InMemoryStorageAdapter();
     * ```
     */
    constructor();
    /**
     * Initializes the storage adapter.
     *
     * For in-memory adapter, this just sets the initialized flag.
     *
     * @returns {Promise<void>}
     */
    initialize(): Promise<void>;
    /**
     * Closes the storage adapter and clears all data.
     *
     * **Warning:** This deletes all conversations and messages from memory.
     *
     * @returns {Promise<void>}
     */
    close(): Promise<void>;
    /**
     * Creates a new conversation.
     *
     * @param {IConversation} conversation - Conversation to create
     * @returns {Promise<IConversation>} The created conversation
     * @throws {Error} If conversation with same ID already exists
     */
    createConversation(conversation: IConversation): Promise<IConversation>;
    /**
     * Retrieves a conversation by ID.
     *
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<IConversation | null>} The conversation or null
     */
    getConversation(conversationId: string): Promise<IConversation | null>;
    /**
     * Updates a conversation.
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
     * Lists conversations for a user.
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
     * Stores a message.
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
     * Deletes a message.
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
}
//# sourceMappingURL=InMemoryStorageAdapter.d.ts.map
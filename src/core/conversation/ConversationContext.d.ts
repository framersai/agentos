/**
 * @fileoverview Manages the state, history, and metadata of a single conversation in AgentOS.
 * It provides robust methods for adding messages, retrieving history with various strategies
 * (including AI-powered summarization if an IUtilityAI service is provided),
 * and managing session-specific metadata. Designed for comprehensive state export and import.
 *
 * @module backend/agentos/core/conversation/ConversationContext
 * @see ./ConversationMessage.ts For ConversationMessage and MessageRole definitions.
 * @see ../ai_utilities/IUtilityAI.ts For IUtilityAI and SummarizationOptions definitions.
 */
import { ConversationMessage, MessageRole } from './ConversationMessage';
import { IUtilityAI, SummarizationOptions } from '../ai_utilities/IUtilityAI';
/**
 * Configuration for the ConversationContext, defining its behavior and limits.
 * @interface ConversationContextConfig
 * @property {number} [maxHistoryLengthMessages=100] - Maximum number of messages to retain in the history.
 * @property {boolean} [enableAutomaticSummarization=false] - If true, attempts to summarize older parts of the conversation when history exceeds limits. Requires `utilityAI`.
 * @property {number} [messagesToKeepVerbatimTail=10] - Number of most recent messages to always keep verbatim (not summarized).
 * @property {number} [messagesToKeepVerbatimHead=2] - Number of earliest messages (e.g., system prompts, initial user query) to always keep verbatim.
 * @property {number} [summarizationChunkSize=20] - Number of messages to group for a single summarization pass.
 * @property {SummarizationOptions} [summarizationOptions] - Default options for the summarization process.
 * @property {IUtilityAI} [utilityAI] - Optional. An instance of `IUtilityAI` used for summarization and other NLP tasks.
 * @property {string} [defaultLanguage='en-US'] - Default language (BCP-47) for context-sensitive operations if not otherwise specified.
 * @property {string} [userId] - Optional. The ID of the user associated with this conversation.
 * @property {string} [gmiInstanceId] - Optional. The ID of the GMI instance managing this conversation.
 * @property {string} [activePersonaId] - Optional. The ID of the persona active in this conversation.
 */
export interface ConversationContextConfig {
    maxHistoryLengthMessages?: number;
    enableAutomaticSummarization?: boolean;
    messagesToKeepVerbatimTail?: number;
    messagesToKeepVerbatimHead?: number;
    summarizationChunkSize?: number;
    summarizationOptions?: SummarizationOptions;
    utilityAI?: IUtilityAI;
    defaultLanguage?: string;
    userId?: string;
    gmiInstanceId?: string;
    activePersonaId?: string;
}
/**
 * @class ConversationContext
 * @description Manages the messages, metadata, and operational state for a single conversation.
 * It ensures that conversation history is handled efficiently, including potential summarization
 * to manage context length, and provides a structured way to access and modify conversation-related data.
 */
export declare class ConversationContext {
    /**
     * Unique identifier for this conversation session.
     * @public
     * @readonly
     * @type {string}
     */
    readonly sessionId: string;
    /**
     * Timestamp (Unix epoch in milliseconds) of when this context was created.
     * @public
     * @readonly
     * @type {number}
     */
    readonly createdAt: number;
    /**
     * Array holding all messages in the conversation, ordered by timestamp.
     * @private
     * @type {ConversationMessage[]}
     */
    private messages;
    /**
     * Readonly configuration applied to this context instance.
     * @private
     * @readonly
     * @type {Required<ConversationContextConfig>}
     */
    private readonly config;
    /**
     * A key-value store for arbitrary metadata associated with this conversation session.
     * @private
     * @type {Record<string, any>}
     */
    private sessionMetadata;
    /**
     * Optional instance of a utility AI service for tasks like summarization.
     * @private
     * @readonly
     * @type {IUtilityAI | undefined}
     */
    private readonly utilityAI?;
    /**
     * A lock to prevent concurrent summarization operations on the same context.
     * @private
     * @type {boolean}
     */
    private isSummarizing;
    /**
     * Creates an instance of ConversationContext.
     *
     * @constructor
     * @param {string} [sessionId] - Optional. A specific ID for this conversation session. If not provided, a UUID will be generated.
     * @param {Partial<ConversationContextConfig>} [config={}] - Optional. Configuration overrides for this context. Defaults will be applied.
     * @param {ConversationMessage[]} [initialMessages=[]] - Optional. An array of messages to pre-populate the context.
     * @param {Record<string, any>} [initialMetadata={}] - Optional. Initial key-value metadata for the session.
     */
    constructor(sessionId?: string, config?: Partial<ConversationContextConfig>, initialMessages?: ConversationMessage[], initialMetadata?: Record<string, any>);
    /**
     * Adds a new message to the conversation history.
     * The message is created using `createConversationMessage` to ensure default fields like `id` and `timestamp` are set.
     * After adding, it asynchronously triggers history management (truncation/summarization).
     *
     * @public
     * @param {Omit<ConversationMessage, 'id' | 'timestamp'>} messageData - The data for the new message, excluding `id` and `timestamp` which will be auto-generated.
     * @returns {Readonly<ConversationMessage>} A readonly version of the newly added message.
     */
    addMessage(messageData: Omit<ConversationMessage, 'id' | 'timestamp'>): Readonly<ConversationMessage>;
    /**
     * Retrieves a portion of the conversation history, optionally limited and filtered.
     * Returns readonly copies of the messages to prevent external modification.
     *
     * @public
     * @param {number} [limit] - Optional. The maximum number of recent messages to return. Defaults to `config.maxHistoryLengthMessages`.
     * @param {MessageRole[]} [excludeRoles] - Optional. An array of message roles to exclude from the returned history.
     * @returns {ReadonlyArray<Readonly<ConversationMessage>>} A readonly array of readonly message objects.
     */
    getHistory(limit?: number, excludeRoles?: MessageRole[]): ReadonlyArray<Readonly<ConversationMessage>>;
    /**
     * Retrieves all messages in the conversation.
     * Returns readonly copies to prevent external modification.
     *
     * @public
     * @returns {ReadonlyArray<Readonly<ConversationMessage>>} A readonly array of all readonly message objects.
     */
    getAllMessages(): ReadonlyArray<Readonly<ConversationMessage>>;
    /**
     * Retrieves a specific message by its unique ID.
     *
     * @public
     * @param {string} messageId - The ID of the message to retrieve.
     * @returns {Readonly<ConversationMessage> | undefined} A readonly copy of the message if found, otherwise `undefined`.
     */
    getMessageById(messageId: string): Readonly<ConversationMessage> | undefined;
    /**
     * Retrieves the most recent message in the conversation.
     *
     * @public
     * @returns {Readonly<ConversationMessage> | undefined} A readonly copy of the last message, or `undefined` if the history is empty.
     */
    getLastMessage(): Readonly<ConversationMessage> | undefined;
    /**
     * Calculates the current "turn number" based on the count of user messages.
     * This can be a simple proxy for conversation length from the user's perspective.
     *
     * @public
     * @returns {number} The number of messages with `role: MessageRole.USER`.
     */
    getTurnNumber(): number;
    /**
     * Clears the conversation history, with options to preserve certain messages or metadata.
     *
     * @public
     * @param {object} [options] - Options for clearing the history.
     * @param {boolean} [options.keepMetadata=true] - If true, session metadata is preserved. Otherwise, it's reset to essential defaults.
     * @param {boolean} [options.keepSystemMessages=true] - If true, messages with `role: MessageRole.SYSTEM` are preserved.
     * @param {ConversationMessage[]} [options.messagesToKeep=[]] - An array of specific message objects to preserve.
     * @returns {void}
     */
    clearHistory(options?: {
        keepMetadata?: boolean;
        keepSystemMessages?: boolean;
        messagesToKeep?: ConversationMessage[];
    }): void;
    /**
     * Sets a custom metadata key-value pair for the session.
     * If `value` is `undefined`, the key is removed.
     *
     * @public
     * @param {string} key - The metadata key.
     * @param {any} value - The metadata value. Use `undefined` to delete the key.
     * @returns {void}
     */
    setMetadata(key: string, value: any): void;
    /**
     * Retrieves a metadata value by its key.
     *
     * @public
     * @param {string} key - The metadata key.
     * @returns {any | undefined} The metadata value, or `undefined` if the key does not exist.
     */
    getMetadata(key: string): any | undefined;
    /**
     * Retrieves all session metadata as a readonly object.
     *
     * @public
     * @returns {Readonly<Record<string, any>>} A readonly copy of all session metadata.
     */
    getAllMetadata(): Readonly<Record<string, any>>;
    /**
     * Manages the length of the conversation history.
     * If `enableAutomaticSummarization` is true and a `utilityAI` service is available,
     * it attempts to summarize older messages. Otherwise, it falls back to simple truncation.
     * This method is called asynchronously after each new message is added.
     *
     * @private
     * @async
     * @returns {Promise<void>}
     */
    private manageHistoryLength;
    /**
     * Performs simple truncation of message history, primarily from the middle,
     * preserving a configured number of head and tail messages.
     *
     * @private
     * @param {number} targetMessageCount - The desired maximum number of messages after truncation.
     */
    private truncateHistorySimple;
    /**
     * Serializes the ConversationContext instance to a JSON-compatible object.
     * The `utilityAI` instance itself is not serialized; its ID might be stored if needed for rehydration.
     *
     * @public
     * @returns {object} A plain JavaScript object representing the conversation context.
     */
    toJSON(): object;
    /**
     * Deserializes a JSON object (typically from `toJSON()`) back into a `ConversationContext` instance.
     *
     * @public
     * @static
     * @param {any} jsonData - The plain JavaScript object to deserialize.
     * @param {(serviceId?: string) => IUtilityAI | undefined} [utilityAIProvider] - Optional. A function that can provide
     * an `IUtilityAI` instance based on a stored `utilityAIServiceId`. This allows for re-injecting dependencies.
     * @returns {ConversationContext} A new instance of `ConversationContext`.
     * @throws {GMIError} If `jsonData` is invalid or missing essential fields.
     */
    static fromJSON(jsonData: any, utilityAIProvider?: (serviceId?: string) => IUtilityAI | undefined): ConversationContext;
    /**
     * Gets the User ID associated with this conversation context.
     * @public
     * @type {string | undefined}
     */
    get userId(): string | undefined;
    /**
     * Gets the GMI Instance ID associated with this conversation context.
     * @public
     * @type {string | undefined}
     */
    get gmiInstanceId(): string | undefined;
    /**
     * Gets the Active Persona ID associated with this conversation context.
     * @public
     * @type {string | undefined}
     */
    get activePersonaId(): string | undefined;
    /**
     * Gets the current primary language for the conversation.
     * @public
     * @type {string}
     */
    get currentLanguage(): string;
}
//# sourceMappingURL=ConversationContext.d.ts.map
// File: backend/agentos/core/conversation/ConversationContext.ts
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
import { MessageRole, createConversationMessage } from './ConversationMessage.js';
import { uuidv4 } from '../../core/utils/uuid.js';
import { GMIError, GMIErrorCode } from '../../core/utils/errors.js'; // Corrected path
// Constants for summarization logic
const DEFAULT_MAX_HISTORY_MESSAGES = 100;
const DEFAULT_VERBATIM_TAIL_COUNT = 10;
const DEFAULT_VERBATIM_HEAD_COUNT = 2;
const DEFAULT_SUMMARIZATION_CHUNK_SIZE = 20; // Messages to group for one summary
const MIN_MESSAGES_FOR_SUMMARIZATION_ATTEMPT = 5; // Don't try to summarize too few messages
const DEFAULT_SUMMARIZATION_OPTIONS = { desiredLength: 'medium', method: 'abstractive_llm' };
/**
 * @class ConversationContext
 * @description Manages the messages, metadata, and operational state for a single conversation.
 * It ensures that conversation history is handled efficiently, including potential summarization
 * to manage context length, and provides a structured way to access and modify conversation-related data.
 */
export class ConversationContext {
    /**
     * Creates an instance of ConversationContext.
     *
     * @constructor
     * @param {string} [sessionId] - Optional. A specific ID for this conversation session. If not provided, a UUID will be generated.
     * @param {Partial<ConversationContextConfig>} [config={}] - Optional. Configuration overrides for this context. Defaults will be applied.
     * @param {ConversationMessage[]} [initialMessages=[]] - Optional. An array of messages to pre-populate the context.
     * @param {Record<string, any>} [initialMetadata={}] - Optional. Initial key-value metadata for the session.
     */
    constructor(sessionId, config = {}, initialMessages = [], initialMetadata = {}) {
        /**
         * A lock to prevent concurrent summarization operations on the same context.
         * @private
         * @type {boolean}
         */
        this.isSummarizing = false;
        this.sessionId = sessionId || `conv_ctx_${uuidv4()}`;
        this.createdAt = Date.now();
        this.messages = initialMessages.map(m => ({
            ...m,
            id: m.id || `msg_${uuidv4()}`,
            timestamp: m.timestamp || Date.now(),
        }));
        const defaultConfig = {
            maxHistoryLengthMessages: DEFAULT_MAX_HISTORY_MESSAGES,
            enableAutomaticSummarization: false,
            messagesToKeepVerbatimTail: DEFAULT_VERBATIM_TAIL_COUNT,
            messagesToKeepVerbatimHead: DEFAULT_VERBATIM_HEAD_COUNT,
            summarizationChunkSize: DEFAULT_SUMMARIZATION_CHUNK_SIZE,
            summarizationOptions: { ...DEFAULT_SUMMARIZATION_OPTIONS },
            defaultLanguage: 'en-US',
        };
        this.config = {
            ...defaultConfig,
            ...config,
            summarizationOptions: {
                ...defaultConfig.summarizationOptions,
                ...(config.summarizationOptions || {}),
            },
        };
        this.utilityAI = this.config.utilityAI; // Use the one from the fully merged config
        this.sessionMetadata = { ...initialMetadata };
        // Set well-known metadata from config if present
        if (this.config.userId)
            this.sessionMetadata.userId = this.config.userId;
        if (this.config.gmiInstanceId)
            this.sessionMetadata.gmiInstanceId = this.config.gmiInstanceId;
        if (this.config.activePersonaId)
            this.sessionMetadata.activePersonaId = this.config.activePersonaId;
        if (this.config.defaultLanguage && !this.sessionMetadata.currentLanguage) {
            this.sessionMetadata.currentLanguage = this.config.defaultLanguage;
        }
        this.sessionMetadata['_lastAccessed'] = this.createdAt; // Initialize last accessed time
        if (this.config.enableAutomaticSummarization && !this.utilityAI) {
            console.warn(`ConversationContext (ID: ${this.sessionId}): Automatic summarization is enabled, but no IUtilityAI service was provided. Summarization will be disabled for this context.`);
            // Update the effective configuration for this instance
            this.config.enableAutomaticSummarization = false;
        }
    }
    /**
     * Adds a new message to the conversation history.
     * The message is created using `createConversationMessage` to ensure default fields like `id` and `timestamp` are set.
     * After adding, it asynchronously triggers history management (truncation/summarization).
     *
     * @public
     * @param {Omit<ConversationMessage, 'id' | 'timestamp'>} messageData - The data for the new message, excluding `id` and `timestamp` which will be auto-generated.
     * @returns {Readonly<ConversationMessage>} A readonly version of the newly added message.
     */
    addMessage(messageData) {
        const newMessage = createConversationMessage(messageData.role, messageData.content, messageData);
        this.messages.push(newMessage);
        this.sessionMetadata['_lastAccessed'] = Date.now();
        // Asynchronously manage history length to avoid blocking the addMessage call.
        this.manageHistoryLength().catch(error => {
            console.error(`ConversationContext (ID: ${this.sessionId}): Error during background history management after adding message:`, error);
            // Fallback to simple truncation if manageHistoryLength fails critically
            if (this.messages.length > this.config.maxHistoryLengthMessages) {
                this.truncateHistorySimple(this.config.maxHistoryLengthMessages);
            }
        });
        return Object.freeze({ ...newMessage });
    }
    /**
     * Retrieves a portion of the conversation history, optionally limited and filtered.
     * Returns readonly copies of the messages to prevent external modification.
     *
     * @public
     * @param {number} [limit] - Optional. The maximum number of recent messages to return. Defaults to `config.maxHistoryLengthMessages`.
     * @param {MessageRole[]} [excludeRoles] - Optional. An array of message roles to exclude from the returned history.
     * @returns {ReadonlyArray<Readonly<ConversationMessage>>} A readonly array of readonly message objects.
     */
    getHistory(limit, excludeRoles) {
        this.sessionMetadata['_lastAccessed'] = Date.now();
        let effectiveMessages = this.messages;
        if (excludeRoles && excludeRoles.length > 0) {
            const rolesToExclude = new Set(excludeRoles);
            effectiveMessages = effectiveMessages.filter(msg => !rolesToExclude.has(msg.role));
        }
        const actualLimit = limit !== undefined && limit > 0 ? limit : this.config.maxHistoryLengthMessages;
        // Ensure both array and its elements are treated as readonly
        return Object.freeze(effectiveMessages.slice(-actualLimit).map(m => Object.freeze({ ...m })));
    }
    /**
     * Retrieves all messages in the conversation.
     * Returns readonly copies to prevent external modification.
     *
     * @public
     * @returns {ReadonlyArray<Readonly<ConversationMessage>>} A readonly array of all readonly message objects.
     */
    getAllMessages() {
        this.sessionMetadata['_lastAccessed'] = Date.now();
        return Object.freeze(this.messages.map(m => Object.freeze({ ...m })));
    }
    /**
     * Retrieves a specific message by its unique ID.
     *
     * @public
     * @param {string} messageId - The ID of the message to retrieve.
     * @returns {Readonly<ConversationMessage> | undefined} A readonly copy of the message if found, otherwise `undefined`.
     */
    getMessageById(messageId) {
        this.sessionMetadata['_lastAccessed'] = Date.now();
        const message = this.messages.find(m => m.id === messageId);
        return message ? Object.freeze({ ...message }) : undefined;
    }
    /**
     * Retrieves the most recent message in the conversation.
     *
     * @public
     * @returns {Readonly<ConversationMessage> | undefined} A readonly copy of the last message, or `undefined` if the history is empty.
     */
    getLastMessage() {
        this.sessionMetadata['_lastAccessed'] = Date.now();
        return this.messages.length > 0 ? Object.freeze({ ...this.messages[this.messages.length - 1] }) : undefined;
    }
    /**
     * Calculates the current "turn number" based on the count of user messages.
     * This can be a simple proxy for conversation length from the user's perspective.
     *
     * @public
     * @returns {number} The number of messages with `role: MessageRole.USER`.
     */
    getTurnNumber() {
        return this.messages.filter(msg => msg.role === MessageRole.USER).length;
    }
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
    clearHistory(options = {}) {
        const { keepMetadata = true, keepSystemMessages = true, messagesToKeep = [] } = options;
        const preservedMessages = [...messagesToKeep];
        if (keepSystemMessages) {
            this.messages.forEach(m => {
                if (m.role === MessageRole.SYSTEM && !preservedMessages.find(pm => pm.id === m.id)) {
                    preservedMessages.push(m);
                }
            });
        }
        // Use a Map to ensure uniqueness by ID if messagesToKeep and system messages overlap
        this.messages = [...new Map(preservedMessages.map(item => [item.id, item])).values()];
        this.messages.sort((a, b) => a.timestamp - b.timestamp); // Ensure messages remain sorted
        if (!keepMetadata) {
            const essentialMetadataKeys = ['userId', 'gmiInstanceId', 'activePersonaId', 'currentLanguage', '_lastAccessed'];
            const newMetadata = {};
            for (const key of essentialMetadataKeys) {
                if (this.sessionMetadata[key] !== undefined) {
                    newMetadata[key] = this.sessionMetadata[key];
                }
            }
            // Ensure core config-derived metadata is preserved if it was initially set
            if (this.config.userId)
                newMetadata.userId = this.config.userId;
            if (this.config.gmiInstanceId)
                newMetadata.gmiInstanceId = this.config.gmiInstanceId;
            if (this.config.activePersonaId)
                newMetadata.activePersonaId = this.config.activePersonaId;
            if (this.config.defaultLanguage && !newMetadata.currentLanguage)
                newMetadata.currentLanguage = this.config.defaultLanguage;
            this.sessionMetadata = newMetadata;
        }
        this.sessionMetadata['_lastAccessed'] = Date.now();
        console.log(`ConversationContext (ID: ${this.sessionId}): History cleared with options. New message count: ${this.messages.length}. Metadata kept: ${keepMetadata}.`);
    }
    /**
     * Sets a custom metadata key-value pair for the session.
     * If `value` is `undefined`, the key is removed.
     *
     * @public
     * @param {string} key - The metadata key.
     * @param {any} value - The metadata value. Use `undefined` to delete the key.
     * @returns {void}
     */
    setMetadata(key, value) {
        if (value === undefined) {
            delete this.sessionMetadata[key];
        }
        else {
            this.sessionMetadata[key] = value;
        }
        this.sessionMetadata['_lastAccessed'] = Date.now();
    }
    /**
     * Retrieves a metadata value by its key.
     *
     * @public
     * @param {string} key - The metadata key.
     * @returns {any | undefined} The metadata value, or `undefined` if the key does not exist.
     */
    getMetadata(key) {
        return this.sessionMetadata[key];
    }
    /**
     * Retrieves all session metadata as a readonly object.
     *
     * @public
     * @returns {Readonly<Record<string, any>>} A readonly copy of all session metadata.
     */
    getAllMetadata() {
        return Object.freeze({ ...this.sessionMetadata });
    }
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
    async manageHistoryLength() {
        if (this.isSummarizing || this.messages.length <= this.config.maxHistoryLengthMessages) {
            return; // Already within limits or summarization in progress
        }
        if (this.config.enableAutomaticSummarization && this.utilityAI) {
            this.isSummarizing = true;
            try {
                const headCount = Math.max(0, this.config.messagesToKeepVerbatimHead);
                const tailCount = Math.max(0, this.config.messagesToKeepVerbatimTail);
                // If keeping head/tail already satisfies max length, or not enough messages to summarize meaningfully
                if (headCount + tailCount >= this.config.maxHistoryLengthMessages || this.messages.length < headCount + tailCount + MIN_MESSAGES_FOR_SUMMARIZATION_ATTEMPT) {
                    this.truncateHistorySimple(this.config.maxHistoryLengthMessages);
                    return; // Exit after simple truncation
                }
                // Ensure there's a middle section to process
                const middleSectionStartIndex = headCount;
                const middleSectionEndIndex = this.messages.length - tailCount;
                if (middleSectionStartIndex >= middleSectionEndIndex) {
                    this.truncateHistorySimple(this.config.maxHistoryLengthMessages); // Not enough messages for a middle section
                    return;
                }
                const middleSection = this.messages.slice(middleSectionStartIndex, middleSectionEndIndex);
                if (middleSection.length >= this.config.summarizationChunkSize && middleSection.length >= MIN_MESSAGES_FOR_SUMMARIZATION_ATTEMPT) {
                    const messagesToSummarize = middleSection.slice(0, this.config.summarizationChunkSize);
                    const textToSummarize = messagesToSummarize
                        .map(m => `${m.name || m.role}: ${typeof m.content === 'string' ? m.content : (m.tool_calls ? '[Tool Call Invoked]' : '[Structured Content]')}`)
                        .join('\n\n');
                    const summaryContent = await this.utilityAI.summarize(textToSummarize, this.config.summarizationOptions);
                    const summaryMessageOptions = {
                        // timestamp is removed from options, createConversationMessage will set it.
                        originalMessagesSummarizedCount: messagesToSummarize.length,
                        metadata: {
                            source: 'automatic_history_summary',
                            modificationInfo: {
                                strategy: 'summarized',
                                originalMessageCount: messagesToSummarize.length,
                            },
                            summarizedMessageIds: messagesToSummarize.map(m => m.id),
                        }, // Cast to MessageMetadata
                    };
                    const summaryMessage = createConversationMessage(MessageRole.SUMMARY, summaryContent, summaryMessageOptions);
                    const headMessages = this.messages.slice(0, headCount);
                    const tailMessages = this.messages.slice(this.messages.length - tailCount);
                    const remainingMiddleAfterSummarizedChunk = middleSection.slice(this.config.summarizationChunkSize);
                    this.messages = [...headMessages, summaryMessage, ...remainingMiddleAfterSummarizedChunk, ...tailMessages];
                    console.log(`ConversationContext (ID: ${this.sessionId}): History summarized. New length: ${this.messages.length}.`);
                    if (this.messages.length > this.config.maxHistoryLengthMessages) {
                        // If still too long, recursively call or truncate if no more summarization is effective
                        if (remainingMiddleAfterSummarizedChunk.length >= MIN_MESSAGES_FOR_SUMMARIZATION_ATTEMPT && remainingMiddleAfterSummarizedChunk.length >= this.config.summarizationChunkSize) {
                            await this.manageHistoryLength(); // Recursive call with safeguard
                        }
                        else {
                            this.truncateHistorySimple(this.config.maxHistoryLengthMessages);
                        }
                    }
                }
                else {
                    this.truncateHistorySimple(this.config.maxHistoryLengthMessages);
                }
            }
            catch (error) {
                console.error(`ConversationContext (ID: ${this.sessionId}): Summarization failed: ${error.message}. Falling back to simple truncation.`, error);
                this.truncateHistorySimple(this.config.maxHistoryLengthMessages);
            }
            finally {
                this.isSummarizing = false;
            }
        }
        else {
            this.truncateHistorySimple(this.config.maxHistoryLengthMessages);
        }
    }
    /**
     * Performs simple truncation of message history, primarily from the middle,
     * preserving a configured number of head and tail messages.
     *
     * @private
     * @param {number} targetMessageCount - The desired maximum number of messages after truncation.
     */
    truncateHistorySimple(targetMessageCount) {
        if (this.messages.length <= targetMessageCount) {
            return;
        }
        const headCount = Math.max(0, Math.min(this.config.messagesToKeepVerbatimHead, targetMessageCount));
        // Calculate how many tail messages can be kept to reach the targetMessageCount
        const tailMessagesToKeepCount = Math.max(0, targetMessageCount - headCount);
        if (this.messages.length > headCount + tailMessagesToKeepCount) { // Check if truncation is actually needed
            const headMessages = this.messages.slice(0, headCount);
            const tailMessages = tailMessagesToKeepCount > 0 ? this.messages.slice(-tailMessagesToKeepCount) : [];
            this.messages = [...headMessages, ...tailMessages];
        }
        // If targetMessageCount is very small, this might result in fewer messages than targetMessageCount if headCount itself exceeds it.
        // Or if headCount + tailMessagesToKeepCount > this.messages.length (shouldn't happen if initial check passes).
        // The logic prioritizes keeping head messages if targetCount is less than headCount.
        if (this.messages.length > targetMessageCount) { // Final trim if somehow still over
            this.messages.splice(targetMessageCount);
        }
        console.log(`ConversationContext (ID: ${this.sessionId}): History truncated simply. New length: ${this.messages.length}. Target: ${targetMessageCount}.`);
    }
    /**
     * Serializes the ConversationContext instance to a JSON-compatible object.
     * The `utilityAI` instance itself is not serialized; its ID might be stored if needed for rehydration.
     *
     * @public
     * @returns {object} A plain JavaScript object representing the conversation context.
     */
    toJSON() {
        // Create a copy of config for serialization, excluding the utilityAI instance
        const serializableConfig = { ...this.config };
        delete serializableConfig.utilityAI; // Remove instance before stringification
        if (this.utilityAI?.utilityId) {
            serializableConfig.utilityAIServiceId = this.utilityAI.utilityId;
        }
        return {
            sessionId: this.sessionId,
            createdAt: this.createdAt,
            messages: this.messages, // Messages are already plain objects
            config: serializableConfig,
            sessionMetadata: this.sessionMetadata,
        };
    }
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
    static fromJSON(jsonData, utilityAIProvider) {
        if (!jsonData || typeof jsonData.sessionId !== 'string' || !Array.isArray(jsonData.messages) || typeof jsonData.config !== 'object' || jsonData.config === null) {
            throw new GMIError("Invalid JSON data: Missing essential fields (sessionId, messages, config) for ConversationContext deserialization.", GMIErrorCode.VALIDATION_ERROR, { providedKeys: Object.keys(jsonData || {}).join(', ') });
        }
        let utilityAIInstance = undefined;
        if (utilityAIProvider && jsonData.config.utilityAIServiceId) {
            utilityAIInstance = utilityAIProvider(jsonData.config.utilityAIServiceId);
        }
        else if (jsonData.config.utilityAIServiceId && !utilityAIProvider) {
            console.warn(`ConversationContext.fromJSON (ID: ${jsonData.sessionId}): Config contained utilityAIServiceId '${jsonData.config.utilityAIServiceId}', but no utilityAIProvider function was given to resolve the instance. Summarization may be unavailable.`);
        }
        const configForNewInstance = {
            ...jsonData.config, // Cast to allow utilityAIServiceId property
            utilityAI: utilityAIInstance,
        };
        // Remove utilityAIServiceId from config object as it's not part of ConversationContextConfig directly
        delete configForNewInstance.utilityAIServiceId;
        const context = new ConversationContext(jsonData.sessionId, configForNewInstance, jsonData.messages, // Assume messages are correctly structured
        jsonData.sessionMetadata || {});
        // Restore read-only properties if they were part of the JSON
        if (typeof jsonData.createdAt === 'number') {
            // This is a bit of a hack to set a readonly property post-construction.
            // It's generally better if all state is reconstructable via constructor or public methods.
            context.createdAt = jsonData.createdAt;
        }
        return context;
    }
    /**
     * Gets the User ID associated with this conversation context.
     * @public
     * @type {string | undefined}
     */
    get userId() { return this.sessionMetadata.userId || this.config.userId; }
    /**
     * Gets the GMI Instance ID associated with this conversation context.
     * @public
     * @type {string | undefined}
     */
    get gmiInstanceId() { return this.sessionMetadata.gmiInstanceId || this.config.gmiInstanceId; }
    /**
     * Gets the Active Persona ID associated with this conversation context.
     * @public
     * @type {string | undefined}
     */
    get activePersonaId() { return this.sessionMetadata.activePersonaId || this.config.activePersonaId; }
    /**
     * Gets the current primary language for the conversation.
     * @public
     * @type {string}
     */
    get currentLanguage() { return this.sessionMetadata.currentLanguage || this.config.defaultLanguage; }
}
//# sourceMappingURL=ConversationContext.js.map
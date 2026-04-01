/**
 * @fileoverview Manages the GMI's internal conversation history, including
 * adding new messages, trimming to size, building prompt-compatible snapshots,
 * and converting between ChatMessage and ConversationMessage formats.
 *
 * Extracted from GMI.ts to isolate conversation state management from the
 * core cognitive engine, reducing class complexity while preserving full
 * feature parity.
 *
 * @module cognitive_substrate/ConversationHistoryManager
 */
import { ChatMessage } from '../core/llm/providers/IProvider';
import { ConversationMessage } from '../core/conversation/ConversationMessage';
import { GMITurnInput, ToolCallResult } from './IGMI';
/**
 * Encapsulates all conversation history state and operations for a GMI instance.
 *
 * Owns the mutable `ChatMessage[]` array and provides methods to append user/tool/system
 * messages, trim to a configurable maximum, build `ConversationMessage[]` snapshots for
 * prompt construction, and hydrate from a previously serialized conversation.
 *
 * Dependencies are injected via the constructor; no direct coupling to GMI internals.
 */
export declare class ConversationHistoryManager {
    private maxHistoryLength;
    /** The mutable backing store for conversation messages. */
    private conversationHistory;
    /**
     * Creates a new ConversationHistoryManager.
     *
     * @param maxHistoryLength - Maximum number of messages to retain in the conversation
     *   history window. When exceeded, the oldest messages are removed. Defaults to 20.
     */
    constructor(maxHistoryLength?: number);
    /**
     * Returns a readonly view of the current conversation history.
     *
     * The returned array reference is live (reflects mutations), but callers
     * should not mutate it directly. Use the dedicated mutation methods instead.
     */
    get history(): readonly ChatMessage[];
    /**
     * Appends a new turn's messages to the conversation history and trims
     * to the configured maximum length.
     *
     * Handles TEXT, MULTIMODAL_CONTENT, TOOL_RESPONSE, and SYSTEM_MESSAGE
     * interaction types. For TOOL_RESPONSE, multiple results are each appended
     * as separate tool-role messages.
     *
     * @param turnInput - The incoming turn input from the GMI turn processor.
     * @param maxMessages - Optional override for the maximum history length
     *   (used when the persona defines a custom limit at runtime).
     */
    update(turnInput: GMITurnInput, maxMessages?: number): void;
    /**
     * Appends a single tool-call result to the conversation history.
     *
     * Used after internal tool execution within the GMI's ReAct loop.
     * Formats error results with a descriptive prefix so the LLM can
     * distinguish success from failure.
     *
     * @param toolCallResult - The result from a tool execution.
     */
    updateWithToolResult(toolCallResult: ToolCallResult): void;
    /**
     * Builds a `ConversationMessage[]` snapshot of the current history, suitable
     * for injection into the PromptEngine's `PromptComponents`.
     *
     * Each ChatMessage is converted to the richer ConversationMessage format,
     * preserving tool_calls, role mappings, and content normalization.
     *
     * @returns An array of ConversationMessage objects mirroring the current history.
     */
    buildForPrompt(): ConversationMessage[];
    /**
     * Replaces the entire conversation history by hydrating from a serialized
     * `ConversationMessage[]` (e.g., loaded from persistent storage).
     *
     * Messages with roles ERROR or THOUGHT are silently dropped, as they have
     * no ChatMessage equivalent. All others are converted to ChatMessage format.
     *
     * @param conversationHistory - The ConversationMessage array to hydrate from.
     */
    hydrate(conversationHistory: ConversationMessage[]): void;
    /**
     * Converts a single ChatMessage (LLM-provider format) to a ConversationMessage
     * (AgentOS internal format).
     *
     * Handles role mapping, content normalization, and tool_calls conversion
     * (string arguments are parsed to objects).
     *
     * @param chatMsg - The ChatMessage to convert.
     * @returns The equivalent ConversationMessage.
     */
    convertToConversationMessage(chatMsg: ChatMessage): ConversationMessage;
    /**
     * Converts a single ConversationMessage (AgentOS internal format) back to a
     * ChatMessage (LLM-provider format).
     *
     * Messages with roles ERROR or THOUGHT return `null` as they have no
     * meaningful ChatMessage representation. SUMMARY messages are prefixed
     * with `[Conversation Summary]`.
     *
     * @param message - The ConversationMessage to convert.
     * @returns The equivalent ChatMessage, or null if the role is not representable.
     */
    convertToChatMessage(message: ConversationMessage): ChatMessage | null;
    /**
     * Directly pushes a pre-built ChatMessage into the history.
     *
     * Used by the GMI's main processing loop to append the assistant's own
     * response (including any tool_calls) after LLM streaming completes.
     *
     * @param message - The ChatMessage to push.
     */
    push(message: ChatMessage): void;
    /**
     * Resets the conversation history to an empty array.
     * Used during re-initialization.
     */
    clear(): void;
    /**
     * Maps a ChatMessage role string to the richer MessageRole enum.
     *
     * @param role - The ChatMessage role ('system' | 'user' | 'assistant' | 'tool').
     * @returns The corresponding MessageRole enum value.
     */
    private mapChatRoleToMessageRole;
    /**
     * Normalizes ChatMessage content (which may be string, null, undefined, or an
     * array of content parts) into ConversationMessage-compatible content.
     *
     * @param content - The raw ChatMessage content.
     * @returns Normalized content suitable for a ConversationMessage.
     */
    private normalizeChatMessageContent;
    /**
     * Normalizes ConversationMessage content into ChatMessage-compatible content.
     *
     * @param content - The ConversationMessage content.
     * @returns Normalized content suitable for a ChatMessage.
     */
    private normalizeConversationMessageContent;
    /**
     * Safely parses tool call arguments from their raw form (string, object, or
     * falsy) into a `Record<string, any>`.
     *
     * Falls back to an empty object on parse errors or unexpected types.
     *
     * @param args - The raw arguments value from a tool call.
     * @returns A parsed arguments object.
     */
    private parseToolCallArguments;
}
//# sourceMappingURL=ConversationHistoryManager.d.ts.map
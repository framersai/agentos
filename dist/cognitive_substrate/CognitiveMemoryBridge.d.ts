/**
 * @fileoverview Bridges the GMI with the Cognitive Memory subsystem.
 *
 * Provides a clean interface for PAD-state derivation, memory tag construction,
 * prompt-context assembly, encoding new memories, and syncing a full turn's
 * input/output into the cognitive memory store.
 *
 * Extracted from GMI.ts to isolate cognitive memory concerns from the core
 * cognitive engine while preserving full feature parity.
 *
 * @module cognitive_substrate/CognitiveMemoryBridge
 */
import type { ICognitiveMemoryManager } from '../memory/CognitiveMemoryManager.js';
import type { PADState } from '../memory/core/config.js';
import type { AssembledMemoryContext, MemorySourceType, MemoryType } from '../memory/core/types.js';
import { GMIMood } from './IGMI';
import type { UserContext, GMITurnInput } from './IGMI';
/**
 * Options for encoding a piece of content into cognitive memory.
 */
export interface CognitiveMemoryEncodeOptions {
    /** The semantic type of the memory trace (e.g., 'episodic', 'semantic'). */
    type: MemoryType;
    /** What produced the content (e.g., 'user_statement', 'agent_inference'). */
    sourceType: MemorySourceType;
    /** Scope identifier — typically a userId or sessionId. */
    scopeId?: string;
    /** The conversational role that produced this content. */
    role: 'user' | 'assistant' | 'tool' | 'system';
    /** Optional additional tags to attach to the memory trace. */
    tags?: string[];
}
/**
 * Bridges a GMI instance with the Cognitive Memory subsystem.
 *
 * All methods are safe to call even when `cognitiveMemory` was not provided
 * (they degrade to no-ops). This allows the GMI to unconditionally delegate
 * without null-checking at every call site.
 *
 * State that belongs to the GMI (mood, user context, persona ID) is accessed
 * via getter callbacks so the bridge always sees the latest values without
 * needing direct mutation access.
 */
export declare class CognitiveMemoryBridge {
    private readonly cognitiveMemory;
    private readonly getMood;
    private readonly getUserContext;
    private readonly getPersonaId;
    private readonly getGmiId;
    private readonly addTraceEntry;
    /**
     * Creates a new CognitiveMemoryBridge.
     *
     * @param cognitiveMemory - The cognitive memory manager instance.
     * @param getMood - Callback returning the GMI's current mood.
     * @param getUserContext - Callback returning the GMI's current user context.
     * @param getPersonaId - Callback returning the active persona's ID.
     * @param getGmiId - Callback returning the GMI instance ID (used as fallback scope).
     * @param addTraceEntry - Callback to add entries to the GMI's reasoning trace.
     */
    constructor(cognitiveMemory: ICognitiveMemoryManager, getMood: () => GMIMood, getUserContext: () => UserContext, getPersonaId: () => string, getGmiId: () => string, addTraceEntry: (type: string, message: string, details?: Record<string, any>) => void);
    /**
     * Derives the PAD (Pleasure-Arousal-Dominance) state from the current GMI mood.
     *
     * Each mood maps to a fixed PAD vector used by the cognitive memory system
     * for encoding strength calculations and emotional context tagging.
     *
     * @returns The PAD state vector corresponding to the current mood.
     */
    getPadState(): PADState;
    /**
     * Builds a de-duplicated set of tags for a memory trace.
     *
     * Tags include the message role, active persona ID, current user ID, and
     * the task domain. Falsy or whitespace-only values are filtered out.
     *
     * @param role - The conversational role producing the content.
     * @returns A unique array of non-empty tag strings.
     */
    buildTags(role: 'user' | 'assistant' | 'tool' | 'system'): string[];
    /**
     * Assembles a cognitive memory context suitable for injection into the LLM prompt.
     *
     * Queries the memory store for relevant traces, assembles them into a text
     * block with token budget constraints, and returns the assembled context.
     *
     * @param query - The user's current input text to use as a retrieval query.
     * @returns The assembled memory context, or null if cognitive memory is unavailable
     *   or the query is empty.
     */
    assembleContext(query: string): Promise<AssembledMemoryContext | null>;
    /**
     * Encodes a piece of content into the cognitive memory store.
     *
     * First fires the observer hook (if available), then encodes the content
     * with the current PAD state, mood, and derived tags.
     *
     * @param content - The text content to encode.
     * @param options - Encoding options (type, sourceType, scopeId, role).
     */
    encode(content: string, options: CognitiveMemoryEncodeOptions): Promise<void>;
    /**
     * Syncs a full turn's input and output into cognitive memory.
     *
     * - User input (TEXT or MULTIMODAL_CONTENT) is encoded as an episodic
     *   memory with sourceType 'user_statement'.
     * - The assistant's response text is encoded as a semantic memory with
     *   sourceType 'agent_inference'.
     *
     * @param turnInput - The turn's input payload.
     * @param responseText - The assistant's generated response text.
     */
    syncForTurn(turnInput: GMITurnInput, responseText: string): Promise<void>;
    /**
     * Converts turn content to a non-empty string or null.
     *
     * @param content - The raw turn content (string or structured object).
     * @returns The stringified content, or null if empty/invalid.
     */
    private stringifyTurnContent;
}
//# sourceMappingURL=CognitiveMemoryBridge.d.ts.map
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
import { GMIMood, GMIInteractionType } from './IGMI.js';
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
export class CognitiveMemoryBridge {
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
    constructor(cognitiveMemory, getMood, getUserContext, getPersonaId, getGmiId, addTraceEntry) {
        this.cognitiveMemory = cognitiveMemory;
        this.getMood = getMood;
        this.getUserContext = getUserContext;
        this.getPersonaId = getPersonaId;
        this.getGmiId = getGmiId;
        this.addTraceEntry = addTraceEntry;
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Derives the PAD (Pleasure-Arousal-Dominance) state from the current GMI mood.
     *
     * Each mood maps to a fixed PAD vector used by the cognitive memory system
     * for encoding strength calculations and emotional context tagging.
     *
     * @returns The PAD state vector corresponding to the current mood.
     */
    getPadState() {
        const mood = this.getMood();
        switch (mood) {
            case GMIMood.EMPATHETIC:
                return { valence: 0.55, arousal: 0.15, dominance: 0.25 };
            case GMIMood.CURIOUS:
                return { valence: 0.35, arousal: 0.45, dominance: 0.15 };
            case GMIMood.ASSERTIVE:
                return { valence: 0.15, arousal: 0.35, dominance: 0.7 };
            case GMIMood.ANALYTICAL:
                return { valence: 0.1, arousal: -0.1, dominance: 0.45 };
            case GMIMood.FOCUSED:
                return { valence: 0.2, arousal: 0.1, dominance: 0.55 };
            case GMIMood.FRUSTRATED:
                return { valence: -0.65, arousal: 0.6, dominance: 0.2 };
            case GMIMood.CREATIVE:
                return { valence: 0.45, arousal: 0.35, dominance: 0.35 };
            case GMIMood.NEUTRAL:
            default:
                return { valence: 0, arousal: 0, dominance: 0 };
        }
    }
    /**
     * Builds a de-duplicated set of tags for a memory trace.
     *
     * Tags include the message role, active persona ID, current user ID, and
     * the task domain. Falsy or whitespace-only values are filtered out.
     *
     * @param role - The conversational role producing the content.
     * @returns A unique array of non-empty tag strings.
     */
    buildTags(role) {
        const userCtx = this.getUserContext();
        const tags = [
            role,
            this.getPersonaId(),
            userCtx?.userId,
            userCtx?.domain,
        ].filter((value) => typeof value === 'string' && value.trim().length > 0);
        return Array.from(new Set(tags));
    }
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
    async assembleContext(query) {
        if (!query.trim()) {
            return null;
        }
        try {
            const context = await this.cognitiveMemory.assembleForPrompt(query, 1600, this.getPadState());
            if (context.contextText.trim()) {
                this.addTraceEntry('DEBUG', 'Cognitive memory context assembled.', {
                    tokensUsed: context.tokensUsed,
                    includedMemoryIds: context.includedMemoryIds,
                });
            }
            return context;
        }
        catch (error) {
            this.addTraceEntry('WARNING', 'Cognitive memory assembly failed.', {
                error: error?.message ?? String(error),
            });
            return null;
        }
    }
    /**
     * Encodes a piece of content into the cognitive memory store.
     *
     * First fires the observer hook (if available), then encodes the content
     * with the current PAD state, mood, and derived tags.
     *
     * @param content - The text content to encode.
     * @param options - Encoding options (type, sourceType, scopeId, role).
     */
    async encode(content, options) {
        if (!content.trim()) {
            return;
        }
        const userCtx = this.getUserContext();
        try {
            await this.cognitiveMemory.observe?.(options.role, content, this.getPadState());
            await this.cognitiveMemory.encode(content, this.getPadState(), this.getMood(), {
                type: options.type,
                scope: 'user',
                scopeId: options.scopeId ?? userCtx.userId ?? this.getGmiId(),
                sourceType: options.sourceType,
                tags: options.tags ?? this.buildTags(options.role),
            });
        }
        catch (error) {
            this.addTraceEntry('WARNING', 'Cognitive memory encoding failed.', {
                role: options.role,
                error: error?.message ?? String(error),
            });
        }
    }
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
    async syncForTurn(turnInput, responseText) {
        const inputText = this.stringifyTurnContent(turnInput.content);
        const userCtx = this.getUserContext();
        if (inputText && (turnInput.type === GMIInteractionType.TEXT ||
            turnInput.type === GMIInteractionType.MULTIMODAL_CONTENT)) {
            await this.encode(inputText, {
                type: 'episodic',
                sourceType: 'user_statement',
                scopeId: userCtx.userId,
                role: 'user',
            });
        }
        if (responseText.trim()) {
            await this.encode(responseText, {
                type: 'semantic',
                sourceType: 'agent_inference',
                scopeId: turnInput.sessionId ?? userCtx.userId ?? this.getGmiId(),
                role: 'assistant',
            });
        }
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Converts turn content to a non-empty string or null.
     *
     * @param content - The raw turn content (string or structured object).
     * @returns The stringified content, or null if empty/invalid.
     */
    stringifyTurnContent(content) {
        if (typeof content === 'string') {
            const trimmed = content.trim();
            return trimmed ? trimmed : null;
        }
        try {
            const serialized = JSON.stringify(content);
            return serialized && serialized !== 'null' ? serialized : null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=CognitiveMemoryBridge.js.map
/**
 * @fileoverview Tracks user sentiment across conversation turns, detects emotional
 * patterns, and emits GMI events that trigger event-based metaprompts.
 *
 * Owns the pending event set and event history buffer. Depends on IUtilityAI for
 * sentiment analysis, IWorkingMemory for persistence, and the persona's
 * sentimentTracking config for thresholds and method selection.
 *
 * Extracted from GMI.ts to isolate sentiment/event concerns from the core
 * cognitive engine while preserving full feature parity.
 *
 * @module cognitive_substrate/SentimentTracker
 */
import { IUtilityAI } from '../nlp/ai_utilities/IUtilityAI';
import { IWorkingMemory } from './memory/IWorkingMemory';
import { ChatMessage } from '../core/llm/providers/IProvider';
import { GMIEventType, GMIEvent, SentimentHistoryState } from './GMIEvent.js';
import type { ReasoningTraceEntry, UserContext } from './IGMI';
import type { IPersonaDefinition } from './personas/IPersonaDefinition';
/**
 * Tracks user sentiment, detects emotional patterns, and emits GMI events.
 *
 * The tracker maintains two data structures:
 * - `pendingGMIEvents`: a set of event types waiting to be consumed by metaprompt
 *   trigger checking. Events are added here when detected and removed when consumed.
 * - `eventHistory`: a circular buffer (max 20) of full event objects for debugging.
 *
 * All configuration (thresholds, methods, models) is sourced from the persona's
 * `sentimentTracking` config block, with sensible defaults when omitted.
 */
export declare class SentimentTracker {
    private readonly utilityAI;
    private readonly workingMemory;
    private readonly getPersona;
    private readonly getConversationHistory;
    private readonly getReasoningTraceEntries;
    private readonly getUserContext;
    private readonly setUserContext;
    private readonly addTraceEntry;
    private readonly getGmiId;
    /** Event types awaiting consumption by metaprompt trigger logic. */
    private _pendingGMIEvents;
    /** Circular buffer of recent events for debugging/introspection. */
    private _eventHistory;
    /**
     * Creates a new SentimentTracker.
     *
     * @param utilityAI - AI utility service for sentiment analysis.
     * @param workingMemory - Working memory for persisting sentiment history.
     * @param getPersona - Callback returning the active persona (for config access).
     * @param getConversationHistory - Callback returning the current conversation history.
     * @param getReasoningTraceEntries - Callback returning recent reasoning trace entries.
     * @param getUserContext - Callback returning the current user context.
     * @param setUserContext - Callback to persist updated user context.
     * @param addTraceEntry - Callback to add entries to the GMI's reasoning trace.
     * @param getGmiId - Callback returning the GMI instance ID (for logging).
     */
    constructor(utilityAI: IUtilityAI, workingMemory: IWorkingMemory, getPersona: () => IPersonaDefinition, getConversationHistory: () => readonly ChatMessage[], getReasoningTraceEntries: () => readonly ReasoningTraceEntry[], getUserContext: () => UserContext, setUserContext: (ctx: UserContext) => Promise<void>, addTraceEntry: (type: string, message: string, details?: Record<string, any>) => void, getGmiId: () => string);
    /**
     * Returns the set of pending event types that have not yet been consumed.
     */
    get pendingEvents(): Set<GMIEventType>;
    /**
     * Returns the current pending events set and clears it.
     *
     * Used by metaprompt trigger logic to atomically read and consume events.
     *
     * @returns The set of event types that were pending.
     */
    consumePendingEvents(): Set<GMIEventType>;
    /**
     * Returns a readonly view of the event history buffer.
     */
    get events(): readonly GMIEvent[];
    /**
     * Analyzes the sentiment of user input and updates persistent sentiment history.
     *
     * This method:
     * 1. Runs sentiment analysis via IUtilityAI (method configurable per persona).
     * 2. Updates the user context's `currentSentiment` field.
     * 3. Appends to the sentiment trend history (sliding window).
     * 4. Updates consecutive frustration/confusion/satisfaction counters.
     * 5. Triggers event detection based on detected patterns.
     *
     * Failures are caught and logged — sentiment analysis never blocks a turn.
     *
     * @param turnId - Current turn identifier.
     * @param userInput - The user's input text to analyze.
     */
    analyzeTurnSentiment(turnId: string, userInput: string): Promise<void>;
    /**
     * Detects emotional patterns from sentiment analysis and emits appropriate
     * GMI events.
     *
     * Checks for:
     * - **Frustration**: negative sentiment with high intensity or consecutive negative turns.
     * - **Confusion**: confusion keywords in input or neutral sentiment with negative tokens.
     * - **Satisfaction**: positive sentiment with high intensity or consecutive positive turns.
     * - **Error threshold**: multiple recent errors in the reasoning trace.
     * - **Low engagement**: consecutive neutral sentiment with short user messages.
     *
     * @param turnId - Current turn identifier.
     * @param userInput - The user's input text.
     * @param sentimentResult - The sentiment analysis result.
     * @param sentimentHistory - The historical sentiment data.
     */
    detectAndEmitEvents(turnId: string, userInput: string, sentimentResult: {
        score: number;
        polarity: 'positive' | 'negative' | 'neutral';
        intensity?: number;
        negativeTokens?: any[];
    }, sentimentHistory: SentimentHistoryState): Promise<void>;
    /**
     * Emits a GMI event: adds its type to pending events and appends the full
     * event to the circular history buffer.
     *
     * @param event - The event to emit.
     */
    private emitEvent;
}
//# sourceMappingURL=SentimentTracker.d.ts.map
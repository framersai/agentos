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
import { GMIEventType, createGMIEvent, } from './GMIEvent.js';
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
export class SentimentTracker {
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
    constructor(utilityAI, workingMemory, getPersona, getConversationHistory, getReasoningTraceEntries, getUserContext, setUserContext, addTraceEntry, getGmiId) {
        this.utilityAI = utilityAI;
        this.workingMemory = workingMemory;
        this.getPersona = getPersona;
        this.getConversationHistory = getConversationHistory;
        this.getReasoningTraceEntries = getReasoningTraceEntries;
        this.getUserContext = getUserContext;
        this.setUserContext = setUserContext;
        this.addTraceEntry = addTraceEntry;
        this.getGmiId = getGmiId;
        /** Event types awaiting consumption by metaprompt trigger logic. */
        this._pendingGMIEvents = new Set();
        /** Circular buffer of recent events for debugging/introspection. */
        this._eventHistory = [];
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Returns the set of pending event types that have not yet been consumed.
     */
    get pendingEvents() {
        return this._pendingGMIEvents;
    }
    /**
     * Returns the current pending events set and clears it.
     *
     * Used by metaprompt trigger logic to atomically read and consume events.
     *
     * @returns The set of event types that were pending.
     */
    consumePendingEvents() {
        const consumed = new Set(this._pendingGMIEvents);
        this._pendingGMIEvents.clear();
        return consumed;
    }
    /**
     * Returns a readonly view of the event history buffer.
     */
    get events() {
        return this._eventHistory;
    }
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
    async analyzeTurnSentiment(turnId, userInput) {
        if (!userInput || typeof userInput !== 'string') {
            return;
        }
        try {
            const persona = this.getPersona();
            const stConfig = persona.sentimentTracking;
            const userCtx = this.getUserContext();
            const sentimentResult = await this.utilityAI.analyzeSentiment(userInput, {
                method: stConfig?.method || 'lexicon_based',
                modelId: stConfig?.modelId || persona.defaultModelId,
                providerId: stConfig?.providerId || persona.defaultProviderId,
                language: userCtx.language || 'en',
            });
            // Update UserContext with current sentiment
            userCtx.currentSentiment = sentimentResult.polarity;
            await this.setUserContext(userCtx);
            // Get or initialize sentiment history
            let sentimentHistory = await this.workingMemory.get('gmi_sentiment_history');
            if (!sentimentHistory) {
                sentimentHistory = {
                    trends: [],
                    consecutiveFrustration: 0,
                    consecutiveConfusion: 0,
                    consecutiveSatisfaction: 0,
                };
            }
            // Add to sentiment trends
            const trend = {
                turnId,
                timestamp: new Date(),
                score: sentimentResult.score,
                polarity: sentimentResult.polarity,
                intensity: sentimentResult.intensity || 0,
                context: userInput.substring(0, 100),
            };
            sentimentHistory.trends.push(trend);
            // Keep only last N trends (configurable sliding window)
            const historyWindow = stConfig?.historyWindow || 10;
            if (sentimentHistory.trends.length > historyWindow) {
                sentimentHistory.trends.shift();
            }
            // Update consecutive counters based on configurable thresholds
            const frustrationThreshold = stConfig?.frustrationThreshold ?? -0.3;
            const satisfactionThreshold = stConfig?.satisfactionThreshold ?? 0.3;
            if (sentimentResult.score < frustrationThreshold) {
                sentimentHistory.consecutiveFrustration++;
                sentimentHistory.consecutiveConfusion = 0;
                sentimentHistory.consecutiveSatisfaction = 0;
            }
            else if (sentimentResult.score > satisfactionThreshold) {
                sentimentHistory.consecutiveSatisfaction++;
                sentimentHistory.consecutiveFrustration = 0;
                sentimentHistory.consecutiveConfusion = 0;
            }
            else {
                sentimentHistory.consecutiveConfusion++;
                sentimentHistory.consecutiveFrustration = 0;
                sentimentHistory.consecutiveSatisfaction = 0;
            }
            sentimentHistory.lastAnalyzedTurnId = turnId;
            // Store updated sentiment history
            await this.workingMemory.set('gmi_sentiment_history', sentimentHistory);
            this.addTraceEntry('DEBUG', 'Turn sentiment analyzed', {
                sentiment: {
                    score: sentimentResult.score,
                    polarity: sentimentResult.polarity,
                    intensity: sentimentResult.intensity,
                },
                consecutiveCounters: {
                    frustration: sentimentHistory.consecutiveFrustration,
                    confusion: sentimentHistory.consecutiveConfusion,
                    satisfaction: sentimentHistory.consecutiveSatisfaction,
                },
            });
            // Detect and emit events based on sentiment patterns
            await this.detectAndEmitEvents(turnId, userInput, sentimentResult, sentimentHistory);
        }
        catch (error) {
            console.error(`GMI (ID: ${this.getGmiId()}): Sentiment analysis error:`, error);
            this.addTraceEntry('WARNING', 'Sentiment analysis failed', { error: error.message });
        }
    }
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
    async detectAndEmitEvents(turnId, userInput, sentimentResult, sentimentHistory) {
        const persona = this.getPersona();
        const stConfig = persona.sentimentTracking;
        const frustThreshold = stConfig?.frustrationThreshold ?? -0.3;
        const satisThreshold = stConfig?.satisfactionThreshold ?? 0.3;
        const consecutiveRequired = stConfig?.consecutiveTurnsForTrigger ?? 2;
        // Frustration detection
        if ((sentimentResult.score < frustThreshold && (sentimentResult.intensity || 0) > 0.6) ||
            sentimentHistory.consecutiveFrustration >= consecutiveRequired) {
            this.emitEvent(createGMIEvent(GMIEventType.USER_FRUSTRATED, turnId, sentimentHistory.consecutiveFrustration >= 2 ? 'high' : 'medium', {
                sentimentScore: sentimentResult.score,
                sentimentPolarity: sentimentResult.polarity,
                sentimentIntensity: sentimentResult.intensity,
                consecutiveTurns: sentimentHistory.consecutiveFrustration,
                triggeredBy: 'sentiment',
            }));
        }
        // Confusion detection (keyword-based + sentiment)
        const confusionKeywords = [
            'confused',
            "don't understand",
            "dont understand",
            'unclear',
            'what do you mean',
            'explain',
            'clarify',
            'huh',
            '??',
            "doesn't make sense",
            "doesnt make sense",
            'not sure',
        ];
        const lowerInput = userInput.toLowerCase();
        const hasConfusionKeyword = confusionKeywords.some((keyword) => lowerInput.includes(keyword));
        const triggerKeywords = hasConfusionKeyword
            ? confusionKeywords.filter((keyword) => lowerInput.includes(keyword))
            : [];
        if (hasConfusionKeyword ||
            (sentimentResult.polarity === 'neutral' &&
                sentimentResult.negativeTokens &&
                sentimentResult.negativeTokens.length > 2)) {
            this.emitEvent(createGMIEvent(GMIEventType.USER_CONFUSED, turnId, sentimentHistory.consecutiveConfusion >= 2 ? 'high' : 'medium', {
                triggeredBy: hasConfusionKeyword ? 'keyword' : 'sentiment',
                consecutiveTurns: sentimentHistory.consecutiveConfusion,
                evidencePreview: userInput.substring(0, 100),
                triggerKeywords: hasConfusionKeyword ? triggerKeywords : undefined,
            }));
        }
        // Satisfaction detection
        if ((sentimentResult.score > satisThreshold && (sentimentResult.intensity || 0) > 0.5) ||
            sentimentHistory.consecutiveSatisfaction >= (consecutiveRequired + 1)) {
            this.emitEvent(createGMIEvent(GMIEventType.USER_SATISFIED, turnId, 'low', {
                sentimentScore: sentimentResult.score,
                sentimentPolarity: sentimentResult.polarity,
                sentimentIntensity: sentimentResult.intensity,
                consecutiveTurns: sentimentHistory.consecutiveSatisfaction,
                triggeredBy: 'sentiment',
            }));
        }
        // Error threshold detection (check reasoning trace for recent errors)
        const traceEntries = this.getReasoningTraceEntries();
        const recentErrors = traceEntries
            .slice(-10)
            .filter((entry) => entry.type === 'ERROR');
        if (recentErrors.length >= 2) {
            this.emitEvent(createGMIEvent(GMIEventType.ERROR_THRESHOLD_EXCEEDED, turnId, 'high', {
                triggeredBy: 'error',
                errorCount: recentErrors.length,
                consecutiveTurns: recentErrors.length,
            }));
        }
        // Low engagement detection (consecutive neutral with short responses)
        const conversationHistory = this.getConversationHistory();
        const recentUserMessages = conversationHistory
            .slice(-5)
            .filter((msg) => msg.role === 'user');
        const avgLength = recentUserMessages.length > 0
            ? recentUserMessages.reduce((sum, msg) => sum + String(msg.content).length, 0) / recentUserMessages.length
            : 0;
        if (sentimentHistory.consecutiveConfusion >= 4 && avgLength < 50) {
            this.emitEvent(createGMIEvent(GMIEventType.LOW_ENGAGEMENT, turnId, 'medium', {
                triggeredBy: 'pattern',
                consecutiveTurns: sentimentHistory.consecutiveConfusion,
                evidencePreview: `Avg response length: ${avgLength.toFixed(0)} chars`,
            }));
        }
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    /**
     * Emits a GMI event: adds its type to pending events and appends the full
     * event to the circular history buffer.
     *
     * @param event - The event to emit.
     */
    emitEvent(event) {
        this._pendingGMIEvents.add(event.eventType);
        this._eventHistory.push(event);
        if (this._eventHistory.length > 20) {
            this._eventHistory.shift();
        }
        this.addTraceEntry('DEBUG', `GMI Event Emitted: ${event.eventType}`, {
            event: {
                eventType: event.eventType,
                turnId: event.turnId,
                severity: event.severity,
                metadata: event.metadata,
            },
        });
    }
}
//# sourceMappingURL=SentimentTracker.js.map
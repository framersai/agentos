/**
 * @fileoverview GMI Event System - Defines event types for triggering metaprompts
 * @module @framers/agentos/cognitive_substrate/GMIEvent
 *
 * This module provides the event infrastructure for sentiment-aware metaprompt triggering.
 * Events are emitted based on user sentiment analysis, error patterns, and engagement metrics.
 */
/**
 * Types of events that can be emitted by a GMI instance.
 * These events trigger event-based metaprompts when detected.
 */
export var GMIEventType;
(function (GMIEventType) {
    /**
     * User is frustrated (negative sentiment with high intensity or consecutive negative turns)
     * Triggers metaprompts that simplify explanations and show empathy
     */
    GMIEventType["USER_FRUSTRATED"] = "user_frustrated";
    /**
     * User is confused (confusion keywords or neutral sentiment with negative signals)
     * Triggers metaprompts that clarify, rephrase, and provide examples
     */
    GMIEventType["USER_CONFUSED"] = "user_confused";
    /**
     * User is satisfied (positive sentiment with high intensity or consecutive positive turns)
     * Triggers metaprompts that increase complexity and maintain engagement
     */
    GMIEventType["USER_SATISFIED"] = "user_satisfied";
    /**
     * Error threshold exceeded (multiple errors in recent turns)
     * Triggers metaprompts that analyze errors and adjust approach
     */
    GMIEventType["ERROR_THRESHOLD_EXCEEDED"] = "error_threshold_exceeded";
    /**
     * Low engagement detected (consecutive neutral sentiment with short responses)
     * Triggers metaprompts that inject creativity and change mood
     */
    GMIEventType["LOW_ENGAGEMENT"] = "low_engagement";
    /**
     * Task complexity mismatch detected (user skill level vs task difficulty)
     * Triggers metaprompts that adjust task complexity or user skill level
     */
    GMIEventType["TASK_COMPLEXITY_MISMATCH"] = "task_complexity_mismatch";
    /**
     * Skill level change detected (user demonstrating higher or lower skill)
     * Triggers metaprompts that update user context
     */
    GMIEventType["SKILL_LEVEL_CHANGE_DETECTED"] = "skill_level_change_detected";
    /**
     * Personality drift detected during memory consolidation.
     * HEXACO traits shifted based on accumulated experience patterns.
     */
    GMIEventType["PERSONA_DRIFT"] = "persona_drift";
})(GMIEventType || (GMIEventType = {}));
/**
 * Creates a new GMI event.
 * Helper function for consistent event creation.
 *
 * @param eventType - Type of event
 * @param turnId - Turn that triggered the event
 * @param severity - Event severity level
 * @param metadata - Additional event context
 * @returns Complete GMI event with timestamp
 */
export function createGMIEvent(eventType, turnId, severity, metadata = {}) {
    return {
        eventType,
        timestamp: new Date(),
        turnId,
        severity,
        metadata,
    };
}
/**
 * Checks if an event type matches a metaprompt's event trigger.
 *
 * @param eventType - The emitted event type
 * @param triggerEventName - The event name in metaprompt trigger config
 * @returns True if they match
 */
export function eventMatchesTrigger(eventType, triggerEventName) {
    return eventType === triggerEventName;
}
//# sourceMappingURL=GMIEvent.js.map
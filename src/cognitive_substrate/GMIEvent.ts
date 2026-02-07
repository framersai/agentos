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
export enum GMIEventType {
  /**
   * User is frustrated (negative sentiment with high intensity or consecutive negative turns)
   * Triggers metaprompts that simplify explanations and show empathy
   */
  USER_FRUSTRATED = 'user_frustrated',

  /**
   * User is confused (confusion keywords or neutral sentiment with negative signals)
   * Triggers metaprompts that clarify, rephrase, and provide examples
   */
  USER_CONFUSED = 'user_confused',

  /**
   * User is satisfied (positive sentiment with high intensity or consecutive positive turns)
   * Triggers metaprompts that increase complexity and maintain engagement
   */
  USER_SATISFIED = 'user_satisfied',

  /**
   * Error threshold exceeded (multiple errors in recent turns)
   * Triggers metaprompts that analyze errors and adjust approach
   */
  ERROR_THRESHOLD_EXCEEDED = 'error_threshold_exceeded',

  /**
   * Low engagement detected (consecutive neutral sentiment with short responses)
   * Triggers metaprompts that inject creativity and change mood
   */
  LOW_ENGAGEMENT = 'low_engagement',

  /**
   * Task complexity mismatch detected (user skill level vs task difficulty)
   * Triggers metaprompts that adjust task complexity or user skill level
   */
  TASK_COMPLEXITY_MISMATCH = 'task_complexity_mismatch',

  /**
   * Skill level change detected (user demonstrating higher or lower skill)
   * Triggers metaprompts that update user context
   */
  SKILL_LEVEL_CHANGE_DETECTED = 'skill_level_change_detected',
}

/**
 * Severity levels for GMI events.
 * Determines priority and urgency of metaprompt execution.
 */
export type GMIEventSeverity = 'low' | 'medium' | 'high';

/**
 * What triggered the event detection.
 */
export type GMIEventTriggerSource = 'sentiment' | 'keyword' | 'error' | 'pattern';

/**
 * Metadata associated with a GMI event.
 * Provides context for metaprompt execution.
 */
export interface GMIEventMetadata {
  /** Sentiment score that triggered the event (-1 to 1) */
  sentimentScore?: number;

  /** Sentiment polarity */
  sentimentPolarity?: 'positive' | 'negative' | 'neutral';

  /** Sentiment intensity (0-1) */
  sentimentIntensity?: number;

  /** Number of consecutive turns with similar pattern */
  consecutiveTurns?: number;

  /** What triggered this event */
  triggeredBy?: GMIEventTriggerSource;

  /** Brief preview of evidence (first 100 chars of user input) */
  evidencePreview?: string;

  /** Keywords that triggered the event (for confusion detection) */
  triggerKeywords?: string[];

  /** Error count (for error threshold events) */
  errorCount?: number;

  /** Additional context-specific data */
  [key: string]: unknown;
}

/**
 * Represents a GMI event that can trigger metaprompts.
 * Events are emitted during turn processing when specific conditions are detected.
 */
export interface GMIEvent {
  /** Type of event */
  eventType: GMIEventType;

  /** When the event was emitted */
  timestamp: Date;

  /** Turn ID that triggered the event */
  turnId: string;

  /** Severity level (affects prioritization) */
  severity: GMIEventSeverity;

  /** Additional metadata about the event */
  metadata: GMIEventMetadata;
}

/**
 * Sentiment trend data stored in working memory.
 * Tracks sentiment over the last N turns for pattern detection.
 */
export interface SentimentTrend {
  /** Turn identifier */
  turnId: string;

  /** When this sentiment was recorded */
  timestamp: Date;

  /** Sentiment score (-1 to 1) */
  score: number;

  /** Sentiment polarity */
  polarity: 'positive' | 'negative' | 'neutral';

  /** Sentiment intensity (0-1) */
  intensity: number;

  /** Brief preview of user input (first 100 chars) */
  context: string;
}

/**
 * Sentiment history state stored in working memory.
 * Maintains a sliding window of sentiment trends for pattern detection.
 */
export interface SentimentHistoryState {
  /** Last N sentiment trends (sliding window) */
  trends: SentimentTrend[];

  /** Number of consecutive turns with frustration */
  consecutiveFrustration: number;

  /** Number of consecutive turns with confusion */
  consecutiveConfusion: number;

  /** Number of consecutive turns with satisfaction */
  consecutiveSatisfaction: number;

  /** Last analyzed turn ID (prevents duplicate analysis) */
  lastAnalyzedTurnId?: string;
}

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
export function createGMIEvent(
  eventType: GMIEventType,
  turnId: string,
  severity: GMIEventSeverity,
  metadata: GMIEventMetadata = {}
): GMIEvent {
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
export function eventMatchesTrigger(
  eventType: GMIEventType,
  triggerEventName: string
): boolean {
  return eventType === triggerEventName;
}

/**
 * @fileoverview PerspectiveObserver — multi-agent subjective memory encoding.
 *
 * Takes objective events and an array of witnesses, applies gating predicates,
 * then produces per-witness first-person memory traces via LLM rewriting.
 * Each witness's HEXACO traits, current mood, and relationships to entities
 * in the event shape what they notice, feel, and remember.
 *
 * Standalone pipeline stage — sibling to ObservationCompressor and
 * ObservationReflector, not an extension of either.
 *
 * @module agentos/memory/observation/PerspectiveObserver
 * @see {@link ObservationCompressor} for note compression (different job).
 * @see {@link ObservationReflector} for pattern extraction (different job).
 */
import type { PADState, HexacoTraits } from '../../core/config.js';
import type { EmotionalContext } from '../../core/types.js';
/**
 * An objective event witnessed by one or more agents.
 */
export interface ObservedEvent {
    /** Unique event ID for linking subjective traces back to the source. */
    eventId: string;
    /** Objective event text. */
    content: string;
    /** The player's action text. */
    playerAction: string;
    /** The narrator/system response text. */
    narratorProse: string;
    /** 0-1 importance score. */
    importance: number;
    /** PAD snapshot at the moment of the event. */
    emotionalContext: EmotionalContext;
    /** Entity names involved in the event. */
    entities: string[];
    /** When the event occurred (Unix ms). */
    timestamp: number;
}
/**
 * A relationship between a witness and an entity in the event.
 */
export interface WitnessRelationship {
    entityName: string;
    disposition: 'neutral' | 'friendly' | 'wary' | 'hostile' | 'grateful' | 'fearful';
    trustLevel: number;
}
/**
 * An agent witnessing the event.
 */
export interface Witness {
    agentId: string;
    agentName: string;
    hexaco: HexacoTraits;
    mood: PADState;
    relationships: WitnessRelationship[];
    tier: 'important' | 'combatant' | 'background';
}
/**
 * A first-person memory trace produced by perspective rewriting.
 */
export interface SubjectiveTrace {
    witnessId: string;
    content: string;
    sourceEventId: string;
    originalEventHash: string;
    perspectiveMetadata: {
        hexacoSnapshot: HexacoTraits;
        moodSnapshot: PADState;
        relationshipSnapshot: WitnessRelationship[];
    };
}
/**
 * Result of a rewrite batch.
 */
export interface PerspectiveRewriteResult {
    traces: SubjectiveTrace[];
    fallbacks: Array<{
        witnessId: string;
        reason: string;
    }>;
    llmCallCount: number;
}
/**
 * Configuration for PerspectiveObserver.
 */
export interface PerspectiveObserverConfig {
    /** LLM invoker with (system, user) → response contract. */
    llmInvoker: (system: string, user: string) => Promise<string>;
    /** Minimum importance for perspective encoding. @default 0.3 */
    importanceThreshold?: number;
    /** Max events per LLM call. @default 10 */
    batchSize?: number;
}
/**
 * Multi-agent subjective memory encoder.
 *
 * @example
 * ```ts
 * const observer = new PerspectiveObserver({
 *   llmInvoker: (sys, usr) => callHaiku(sys, usr),
 * });
 * const result = await observer.rewrite(events, witnesses);
 * for (const trace of result.traces) {
 *   await npcBrains.get(trace.witnessId)?.remember(trace.content, {
 *     type: 'episodic',
 *     tags: ['perspective-encoded'],
 *   });
 * }
 * ```
 */
export declare class PerspectiveObserver {
    private readonly llmInvoker;
    private readonly importanceThreshold;
    private readonly batchSize;
    constructor(config: PerspectiveObserverConfig);
    /**
     * Rewrite objective events from each witness's perspective.
     *
     * Applies gating predicates, batches events per witness, invokes the LLM,
     * and returns per-witness subjective traces. Failures fall back to objective
     * encoding with a reason string.
     *
     * @param events - Objective events to rewrite.
     * @param witnesses - Agents who witnessed the events.
     * @returns Subjective traces + fallback records + LLM call count.
     */
    rewrite(events: ObservedEvent[], witnesses: Witness[]): Promise<PerspectiveRewriteResult>;
    /**
     * Parse LLM response as a JSON array of strings.
     *
     * @param response - Raw LLM response text.
     * @param expectedCount - Number of events in the batch.
     * @returns Parsed string array, or null on failure.
     */
    private parseResponse;
    /** Split an array into chunks of `size`. */
    private chunk;
}
//# sourceMappingURL=PerspectiveObserver.d.ts.map
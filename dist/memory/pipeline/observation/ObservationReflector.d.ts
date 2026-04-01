/**
 * @fileoverview Higher-level reflector that condenses compressed observations
 * into reflections — long-lived insights about user patterns, preferences,
 * capabilities, relationships, and goals.
 *
 * This is the "Reflector" agent in Mastra's agentic memory model. It runs
 * when compressed observations exceed a configurable token threshold
 * (default: 40,000 tokens) and extracts higher-level patterns that transcend
 * individual conversation turns.
 *
 * Each {@link Reflection} carries a pattern type classifier, confidence score,
 * source provenance, and temporal span metadata.
 *
 * @module agentos/memory/observation/ObservationReflector
 */
import type { CompressedObservation } from './ObservationCompressor.js';
/** The kind of pattern identified by the reflector. */
export type ReflectionPatternType = 'preference' | 'behavior' | 'capability' | 'relationship' | 'goal';
/**
 * A high-level insight derived from multiple compressed observations.
 * Reflections are the highest tier in the observation hierarchy:
 *   raw notes → compressed observations → reflections.
 */
export interface Reflection {
    /** Unique identifier for this reflection. */
    id: string;
    /** High-level insight text (1-3 sentences). */
    insight: string;
    /** Pattern type classifier. */
    patternType: ReflectionPatternType;
    /** Confidence in this reflection (0-1). */
    confidence: number;
    /** IDs of the source compressed observations. */
    sourceIds: string[];
    /** Temporal span covered by this reflection. */
    temporal: {
        /** When this reflection was produced (Unix ms). */
        reflectedAt: number;
        /** Earliest source timestamp in the compressed observations (Unix ms). */
        spanStart: number;
        /** Latest source timestamp in the compressed observations (Unix ms). */
        spanEnd: number;
        /** Human-friendly label for the temporal span. */
        relativeLabel: string;
    };
}
/**
 * Condenses compressed observations into higher-level reflections.
 *
 * Runs when accumulated compressed observations exceed 40,000 tokens
 * (configurable). Each reflection captures a long-lived pattern such as
 * a user preference, behavioral habit, capability, relationship dynamic,
 * or goal.
 */
export declare class ObservationReflector {
    private llmInvoker;
    /**
     * @param llmInvoker - Function that calls an LLM with (system, user) prompts.
     */
    constructor(llmInvoker: (system: string, user: string) => Promise<string>);
    /**
     * Reflect on compressed observations to extract higher-level patterns.
     *
     * @param observations - Compressed observations to reflect on.
     * @returns Array of reflections. Returns empty array on LLM failure.
     */
    reflect(observations: CompressedObservation[]): Promise<Reflection[]>;
    /**
     * Parse the LLM response into Reflection objects.
     */
    private parseReflections;
    /**
     * Build a human-friendly label describing a temporal span.
     *
     * @param start - Earliest timestamp in the span (Unix ms).
     * @param end - Latest timestamp in the span (Unix ms).
     * @param now - Current reference time (Unix ms).
     * @returns Label such as "over the past week" or "over the past 3 days".
     */
    private buildSpanLabel;
}
//# sourceMappingURL=ObservationReflector.d.ts.map
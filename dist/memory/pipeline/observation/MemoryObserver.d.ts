/**
 * @fileoverview Memory Observer — personality-biased background note extraction
 * with LLM-based compression and reflection tiers.
 *
 * Monitors accumulated conversation tokens via ObservationBuffer.
 * When the threshold is reached, extracts concise observation notes
 * via a persona-configured LLM (defaults to cheap model).
 *
 * Three-tier agentic memory pipeline (Mastra-style):
 *   1. Raw notes — extracted per-turn when token threshold is reached.
 *   2. Compressed observations — produced by ObservationCompressor when
 *      accumulated notes exceed the compression threshold (default: 50 notes).
 *   3. Reflections — produced by ObservationReflector when compressed
 *      observations exceed the reflection token threshold (default: 40,000 tokens).
 *
 * Personality bias:
 * - High emotionality → notes emotional shifts
 * - High conscientiousness → notes commitments/deadlines
 * - High openness → notes creative tangents
 * - High agreeableness → notes user preferences and rapport cues
 * - High honesty → notes corrections and retractions
 *
 * @module agentos/memory/observation/MemoryObserver
 */
import type { HexacoTraits, PADState, ObserverConfig } from '../../core/config.js';
import { ObservationBuffer, type BufferedMessage } from './ObservationBuffer.js';
import { type CompressedObservation } from './ObservationCompressor.js';
import { type Reflection } from './ObservationReflector.js';
export interface ObservationNote {
    id: string;
    /** Category of observation. */
    type: 'factual' | 'emotional' | 'commitment' | 'preference' | 'creative' | 'correction';
    /** Short summary of the observation. */
    content: string;
    /** 0-1 importance score. */
    importance: number;
    /** Entities mentioned. */
    entities: string[];
    /** Emotional context at observation time. */
    emotionalContext?: {
        valence: number;
        arousal: number;
    };
    timestamp: number;
    /** Three-date temporal metadata. */
    temporal?: {
        /** When this observation was made (Unix ms). Same as timestamp. */
        observedAt: number;
        /** When the referenced event actually occurred (Unix ms). */
        referencedAt: number;
        /** Human-friendly relative time label. */
        relativeLabel: string;
    };
}
export declare class MemoryObserver {
    private buffer;
    private traits;
    private llmInvoker?;
    private config;
    private accumulatedNotes;
    private accumulatedCompressed;
    private compressor;
    private reflector;
    private compressionThreshold;
    private reflectionThresholdTokens;
    constructor(traits: HexacoTraits, config?: Partial<ObserverConfig>);
    /**
     * Feed a message into the observation buffer.
     * Returns observation notes if the buffer has reached activation threshold.
     */
    observe(role: BufferedMessage['role'], content: string, mood?: PADState): Promise<ObservationNote[] | null>;
    /**
     * Force extraction of observation notes from buffered messages.
     */
    extractNotes(mood?: PADState): Promise<ObservationNote[]>;
    /**
     * Run compression if accumulated notes exceed the compression threshold.
     *
     * When the number of accumulated raw notes exceeds the configured threshold
     * (default: 50), the ObservationCompressor is invoked to produce denser
     * compressed observations. The raw notes are then cleared.
     *
     * @returns Compressed observations if threshold was met, null otherwise.
     */
    compressIfNeeded(): Promise<CompressedObservation[] | null>;
    /**
     * Run reflection if accumulated compressed observations exceed the token threshold.
     *
     * When the total estimated tokens of accumulated compressed observations
     * exceeds the configured threshold (default: 40,000 tokens), the
     * ObservationReflector is invoked to extract higher-level patterns.
     *
     * @returns Reflections if threshold was met, null otherwise.
     */
    reflectIfNeeded(): Promise<Reflection[] | null>;
    /** Get the underlying buffer for inspection. */
    getBuffer(): ObservationBuffer;
    /** Check if observation should be triggered. */
    shouldActivate(): boolean;
    /** Get the count of accumulated raw notes awaiting compression. */
    getAccumulatedNoteCount(): number;
    /** Get the count of accumulated compressed observations awaiting reflection. */
    getAccumulatedCompressedCount(): number;
    /** Get the accumulated compressed observations (read-only snapshot). */
    getAccumulatedCompressed(): readonly CompressedObservation[];
    /** Set the compression threshold (number of notes before compression triggers). */
    setCompressionThreshold(threshold: number): void;
    /** Set the reflection token threshold (estimated tokens before reflection triggers). */
    setReflectionThresholdTokens(threshold: number): void;
    /** Reset the observer. */
    clear(): void;
    /**
     * Parse LLM response into ObservationNote objects.
     *
     * Attaches three-date temporal metadata from conversation message timestamps
     * when available, using the earliest message timestamp as `referencedAt`
     * and the current time as `observedAt`.
     */
    private parseNotes;
}
//# sourceMappingURL=MemoryObserver.d.ts.map
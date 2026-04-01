/**
 * @fileoverview LLM-based observational memory compressor.
 *
 * Takes a batch of {@link ObservationNote} objects and compresses them into
 * denser {@link CompressedObservation} summaries via an LLM call. This is the
 * "Observer" agent in Mastra's agentic memory model — it groups related
 * observations by topic/entity overlap, produces a 1-3 sentence summary per
 * group, assigns a priority level, and attaches three-date temporal metadata.
 *
 * Typical compression: 3-10x (many individual notes become fewer dense
 * summaries while preserving all critical facts).
 *
 * Personality bias: when HEXACO traits are provided, the system prompt
 * is tuned to emphasise observation categories that align with the agent's
 * personality (e.g. high conscientiousness → emphasise commitments).
 *
 * @module agentos/memory/observation/ObservationCompressor
 */
import type { HexacoTraits } from '../../core/config.js';
import type { ObservationNote } from './MemoryObserver.js';
/** Priority level for a compressed observation. */
export type CompressionPriority = 'critical' | 'important' | 'informational';
/**
 * A compressed observation produced by merging multiple raw
 * {@link ObservationNote} objects into a single dense summary.
 */
export interface CompressedObservation {
    /** Unique identifier for this compressed observation. */
    id: string;
    /** Dense summary of multiple observations (1-3 sentences). */
    summary: string;
    /** Triage priority. */
    priority: CompressionPriority;
    /** Three-date temporal metadata. */
    temporal: {
        /** When this compression was performed (Unix ms). */
        observedAt: number;
        /** Earliest event timestamp across all source observations (Unix ms). */
        referencedAt: number;
        /** Human-friendly relative time label for `referencedAt`. */
        relativeLabel: string;
    };
    /** IDs of the source {@link ObservationNote} objects that were compressed. */
    sourceIds: string[];
    /** Union of key entities across all source observations. */
    entities: string[];
    /** Average importance score of the source observations (0-1). */
    importance: number;
}
/**
 * LLM-based compressor that takes a batch of {@link ObservationNote} objects
 * and produces denser {@link CompressedObservation} summaries.
 *
 * Achieves 3-10x compression while preserving key facts, entities, and
 * temporal context. Each compressed observation carries three-date temporal
 * metadata: when the compression happened, the earliest referenced event,
 * and a human-friendly relative time label.
 */
export declare class ObservationCompressor {
    private llmInvoker;
    private traits?;
    /**
     * @param llmInvoker - Function that calls an LLM with (system, user) prompts.
     * @param traits - Optional HEXACO personality traits for bias-aware compression.
     */
    constructor(llmInvoker: (system: string, user: string) => Promise<string>, traits?: HexacoTraits | undefined);
    /**
     * Compress a batch of observation notes into denser summaries.
     *
     * The method:
     * 1. Formats the notes as a numbered list for the LLM.
     * 2. Sends the batch to the LLM with a compression prompt.
     * 3. Parses the JSON array response into {@link CompressedObservation} objects.
     * 4. Attaches three-date temporal metadata (observedAt, referencedAt, relativeLabel).
     *
     * @param notes - Batch of observation notes to compress.
     * @returns Array of compressed observations. Returns empty array on LLM failure.
     */
    compress(notes: ObservationNote[]): Promise<CompressedObservation[]>;
    /**
     * Parse the LLM response into CompressedObservation objects.
     *
     * Tries to parse the response as a JSON array. Falls back to extracting
     * individual JSON objects from lines if the array parse fails.
     */
    private parseCompressed;
}
//# sourceMappingURL=ObservationCompressor.d.ts.map
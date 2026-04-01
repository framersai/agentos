/**
 * @fileoverview Memory Reflector — consolidates observation notes into long-term traces.
 *
 * Activates when accumulated observation notes exceed a token threshold.
 * Uses a persona-configured LLM to:
 * 1. Merge redundant observations
 * 2. Elevate important facts to long-term memory traces
 * 3. Detect conflicts against existing memories
 * 4. Resolve conflicts based on personality (high honesty → update, high agreeableness → coexist)
 *
 * Target compression: 5-40x (many observations → few traces).
 *
 * @module agentos/memory/observation/MemoryReflector
 */
import type { MemoryTrace } from '../../core/types.js';
import type { HexacoTraits, ReflectorConfig } from '../../core/config.js';
import type { ObservationNote } from './MemoryObserver.js';
export interface MemoryReflectionResult {
    /** New long-term memory traces to store. */
    traces: Omit<MemoryTrace, 'id' | 'encodingStrength' | 'stability' | 'retrievalCount' | 'lastAccessedAt' | 'accessCount' | 'reinforcementInterval' | 'createdAt' | 'updatedAt'>[];
    /** IDs of existing traces that should be superseded. */
    supersededTraceIds: string[];
    /** IDs of observation notes that were consumed. */
    consumedNoteIds: string[];
    /** Compression ratio achieved. */
    compressionRatio: number;
}
export declare class MemoryReflector {
    private pendingNotes;
    private traits;
    private llmInvoker?;
    private config;
    constructor(traits: HexacoTraits, config?: Partial<ReflectorConfig>);
    /**
     * Add observation notes for future reflection.
     * Returns a MemoryReflectionResult if the note threshold is reached.
     */
    addNotes(notes: ObservationNote[]): Promise<MemoryReflectionResult | null>;
    /** Whether accumulated notes exceed the reflection threshold. */
    shouldActivate(): boolean;
    /**
     * Force reflection over all pending notes.
     */
    reflect(existingMemoryContext?: string): Promise<MemoryReflectionResult>;
    /** Get pending note count. */
    getPendingNoteCount(): number;
    /** Clear all pending notes. */
    clear(): void;
    private parseReflection;
}
//# sourceMappingURL=MemoryReflector.d.ts.map
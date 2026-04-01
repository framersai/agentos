/**
 * @fileoverview Ebbinghaus forgetting curve, spaced repetition, and
 * interference management.
 *
 * Cognitive science foundations:
 * - **Ebbinghaus forgetting curve**: S(t) = S₀ · e^(-t / stability)
 * - **Spaced repetition**: Each successful retrieval increases stability
 *   (desirable difficulty effect — harder retrievals grow stability more).
 * - **Proactive interference**: Old similar memories impair new encoding.
 * - **Retroactive interference**: New memories weaken old similar ones.
 *
 * @module agentos/memory/decay/DecayModel
 */
import type { MemoryTrace } from '../types.js';
import type { DecayConfig } from '../config.js';
/**
 * Compute the current effective strength of a memory trace using the
 * Ebbinghaus forgetting curve:
 *
 *   S(t) = S₀ · e^(-Δt / stability)
 *
 * where Δt = now - lastAccessedAt.
 */
export declare function computeCurrentStrength(trace: MemoryTrace, now: number): number;
export interface RetrievalUpdateResult {
    /** New encoding strength (small bump). */
    encodingStrength: number;
    /** New stability (grows based on difficulty). */
    stability: number;
    /** Incremented retrieval count. */
    retrievalCount: number;
    /** Updated timestamp. */
    lastAccessedAt: number;
    /** Incremented access count. */
    accessCount: number;
    /** Doubled reinforcement interval. */
    reinforcementInterval: number;
    /** Next reinforcement due. */
    nextReinforcementAt: number;
}
/**
 * Update a trace's decay parameters after a successful retrieval.
 *
 * Implements the **desirable difficulty** effect: memories that were
 * harder to retrieve (lower current strength) receive a larger stability
 * boost, making the next retrieval easier and longer-lasting.
 *
 * Stability growth also accounts for:
 * - Diminishing returns on repeated retrievals (logarithmic saturation)
 * - Emotional intensity bonus (emotional memories consolidate faster)
 */
export declare function updateOnRetrieval(trace: MemoryTrace, now: number): RetrievalUpdateResult;
export interface InterferenceVictim {
    traceId: string;
    strengthReduction: number;
}
export interface InterferenceResult {
    /** Existing traces whose strength should be reduced (retroactive). */
    retroactiveVictims: InterferenceVictim[];
    /** Amount to reduce new trace's strength by (proactive). */
    proactiveReduction: number;
}
/**
 * Compute interference effects when a new trace is encoded alongside
 * existing similar traces.
 *
 * - **Proactive interference**: Old similar traces impair new encoding
 *   (reduce new trace's initial strength).
 * - **Retroactive interference**: New trace weakens old similar traces
 *   (reduce their encoding strength).
 *
 * Similarity is provided externally (cosine similarity of embeddings).
 *
 * @param similarities Array of { traceId, similarity } for existing traces.
 * @param config Decay configuration with interference threshold.
 */
export declare function computeInterference(similarities: Array<{
    traceId: string;
    similarity: number;
    currentStrength: number;
}>, config?: DecayConfig): InterferenceResult;
/**
 * Result of applying the unused-trace penalty to a memory trace's decay
 * parameters.
 */
export interface PenaltyResult {
    /** Updated encoding strength after the 10% immediate penalty. */
    encodingStrength: number;
    /** Updated stability — halved, floored at 60 000 ms (1 minute). */
    stability: number;
    /** Timestamp of the penalty application (Unix ms). */
    lastAccessedAt: number;
}
/**
 * Accelerates decay for a trace that was retrieved and injected into the
 * prompt but subsequently ignored by the LLM's response.
 *
 * Rationale: if a memory was surfaced but the model produced a response
 * that didn't use it, the trace is likely less relevant than its current
 * strength suggests.  Halving stability makes the forgetting curve steeper
 * going forward (the trace will reach the pruning threshold faster), while
 * the 10% immediate strength penalty provides a small but observable signal
 * to the consolidation pipeline.
 *
 * The stability floor of 60 000 ms (1 minute) prevents pathological
 * oscillation on traces that are repeatedly penalised — they still decay
 * naturally but aren't instantly pruned by a single feedback event.
 *
 * @param trace - The memory trace that was injected but ignored.
 * @param now   - Current wall-clock timestamp in milliseconds.
 * @returns Updated `encodingStrength`, `stability`, and `lastAccessedAt`
 *   suitable for writing back to the trace store.
 */
export declare function penalizeUnused(trace: MemoryTrace, now: number): PenaltyResult;
/**
 * Identify traces that have decayed below the pruning threshold.
 * These should be soft-deleted (isActive = false).
 */
export declare function findPrunableTraces(traces: MemoryTrace[], now: number, config?: DecayConfig): string[];
//# sourceMappingURL=DecayModel.d.ts.map
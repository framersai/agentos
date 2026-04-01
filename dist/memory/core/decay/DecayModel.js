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
import { DEFAULT_DECAY_CONFIG } from '../config.js';
// ---------------------------------------------------------------------------
// Current strength calculation
// ---------------------------------------------------------------------------
/**
 * Compute the current effective strength of a memory trace using the
 * Ebbinghaus forgetting curve:
 *
 *   S(t) = S₀ · e^(-Δt / stability)
 *
 * where Δt = now - lastAccessedAt.
 */
export function computeCurrentStrength(trace, now) {
    const elapsed = Math.max(0, now - trace.lastAccessedAt);
    return trace.encodingStrength * Math.exp(-elapsed / trace.stability);
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
export function updateOnRetrieval(trace, now) {
    const currentStrength = computeCurrentStrength(trace, now);
    // Desirable difficulty: weaker current strength → more stability growth
    const difficultyBonus = Math.max(0.1, 1 - currentStrength);
    // Diminishing returns on repeated retrievals
    const retrievalDiminish = 1 / (1 + 0.1 * trace.retrievalCount);
    // Emotional consolidation bonus
    const emotionalBonus = 1 + trace.emotionalContext.intensity * 0.3;
    // Stability growth factor
    const growthFactor = (1.5 + difficultyBonus * 2.0) * retrievalDiminish * emotionalBonus;
    const newStability = trace.stability * growthFactor;
    const newStrength = Math.min(1.0, trace.encodingStrength + 0.1);
    const newInterval = trace.reinforcementInterval * 2;
    return {
        encodingStrength: newStrength,
        stability: newStability,
        retrievalCount: trace.retrievalCount + 1,
        lastAccessedAt: now,
        accessCount: trace.accessCount + 1,
        reinforcementInterval: newInterval,
        nextReinforcementAt: now + newInterval,
    };
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
export function computeInterference(similarities, config = DEFAULT_DECAY_CONFIG) {
    const victims = [];
    let proactiveReduction = 0;
    for (const entry of similarities) {
        if (entry.similarity <= config.interferenceThreshold)
            continue;
        const overlapStrength = entry.similarity - config.interferenceThreshold;
        // Scale: 0 at threshold, ~0.15 at similarity 1.0
        const scaledOverlap = overlapStrength / (1 - config.interferenceThreshold);
        // Retroactive: new trace interferes with old
        const retroReduction = scaledOverlap * 0.15;
        victims.push({ traceId: entry.traceId, strengthReduction: retroReduction });
        // Proactive: old trace interferes with new
        proactiveReduction += scaledOverlap * 0.1 * entry.currentStrength;
    }
    return {
        retroactiveVictims: victims,
        proactiveReduction: Math.min(0.3, proactiveReduction), // cap proactive interference
    };
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
export function penalizeUnused(trace, now) {
    const currentStrength = computeCurrentStrength(trace, now);
    // Floor: 1 minute — prevents traces from reaching an unusable stability
    // value even after many consecutive ignore penalties.
    const newStability = Math.max(trace.stability * 0.5, 60000);
    return {
        encodingStrength: currentStrength * 0.9, // 10% immediate strength penalty
        stability: newStability,
        lastAccessedAt: now,
    };
}
// ---------------------------------------------------------------------------
// Batch decay sweep (for consolidation pipeline)
// ---------------------------------------------------------------------------
/**
 * Identify traces that have decayed below the pruning threshold.
 * These should be soft-deleted (isActive = false).
 */
export function findPrunableTraces(traces, now, config = DEFAULT_DECAY_CONFIG) {
    return traces
        .filter((t) => {
        if (!t.isActive)
            return false;
        const strength = computeCurrentStrength(t, now);
        return (strength < config.pruningThreshold &&
            t.emotionalContext.intensity < 0.3 // don't prune emotional memories easily
        );
    })
        .map((t) => t.id);
}
//# sourceMappingURL=DecayModel.js.map
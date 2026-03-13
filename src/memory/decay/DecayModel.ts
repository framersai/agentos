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
export function computeCurrentStrength(trace: MemoryTrace, now: number): number {
  const elapsed = Math.max(0, now - trace.lastAccessedAt);
  return trace.encodingStrength * Math.exp(-elapsed / trace.stability);
}

// ---------------------------------------------------------------------------
// Retrieval strength update (spaced repetition)
// ---------------------------------------------------------------------------

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
export function updateOnRetrieval(trace: MemoryTrace, now: number): RetrievalUpdateResult {
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

// ---------------------------------------------------------------------------
// Interference detection
// ---------------------------------------------------------------------------

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
export function computeInterference(
  similarities: Array<{ traceId: string; similarity: number; currentStrength: number }>,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): InterferenceResult {
  const victims: InterferenceVictim[] = [];
  let proactiveReduction = 0;

  for (const entry of similarities) {
    if (entry.similarity <= config.interferenceThreshold) continue;

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

// ---------------------------------------------------------------------------
// Batch decay sweep (for consolidation pipeline)
// ---------------------------------------------------------------------------

/**
 * Identify traces that have decayed below the pruning threshold.
 * These should be soft-deleted (isActive = false).
 */
export function findPrunableTraces(
  traces: MemoryTrace[],
  now: number,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): string[] {
  return traces
    .filter((t) => {
      if (!t.isActive) return false;
      const strength = computeCurrentStrength(t, now);
      return (
        strength < config.pruningThreshold &&
        t.emotionalContext.intensity < 0.3 // don't prune emotional memories easily
      );
    })
    .map((t) => t.id);
}

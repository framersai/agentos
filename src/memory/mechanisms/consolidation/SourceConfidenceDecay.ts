/**
 * @fileoverview Source Confidence Decay — source-type stability multipliers.
 *
 * Cognitive science foundations:
 * - **Source monitoring framework** (Johnson, Hashtroudi & Lindsay, 1993):
 *   Attributing a memory to its source is a judgment process. Internally
 *   generated memories (agent inferences, reflections) are inherently less
 *   reliable than externally observed facts.
 * - **Updated review** (Mitchell & Johnson, 2009): Source monitoring errors
 *   increase when source characteristics are similar — agent-generated
 *   content is particularly prone to source confusion.
 *
 * @module agentos/memory/mechanisms/consolidation/SourceConfidenceDecay
 */

import type { MemoryTrace } from '../../types.js';
import type { ResolvedSourceConfidenceDecayConfig, MechanismMetadata } from '../types.js';

/** Importance floor: high-importance traces get a minimum multiplier. */
const HIGH_IMPORTANCE_THRESHOLD = 0.8;
const HIGH_IMPORTANCE_FLOOR_MULTIPLIER = 0.90;

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

function getMeta(trace: MemoryTrace): MechanismMetadata {
  if (!trace.structuredData) trace.structuredData = {};
  if (!trace.structuredData.mechanismMetadata) {
    trace.structuredData.mechanismMetadata = {};
  }
  return trace.structuredData.mechanismMetadata as MechanismMetadata;
}

// ---------------------------------------------------------------------------
// Source Confidence Decay
// ---------------------------------------------------------------------------

/**
 * Apply source-type stability multipliers to traces during consolidation.
 *
 * Each trace's stability is multiplied by a factor determined by its source
 * type. User statements and tool results (externally verified) get 1.0x.
 * Agent inferences and reflections (internally generated, prone to
 * confabulation) decay faster at 0.80x and 0.75x respectively.
 *
 * @param traces All active traces (mutated in place).
 * @param config Resolved source confidence decay config.
 * @returns Number of traces that had source decay applied.
 */
export function applySourceConfidenceDecay(
  traces: MemoryTrace[],
  config: ResolvedSourceConfidenceDecayConfig,
): number {
  if (!config.enabled) return 0;

  const now = Date.now();
  let count = 0;

  for (const trace of traces) {
    if (!trace.isActive) continue;

    const meta = getMeta(trace);

    // Skip if already decayed in this consolidation window (within 1 hour)
    if (meta.lastSourceDecayAt && (now - meta.lastSourceDecayAt) < 3_600_000) continue;

    const sourceType = trace.provenance.sourceType;
    let multiplier = config.decayMultipliers[sourceType] ?? 1.0;

    // Importance floor: high-importance traces get minimum multiplier
    if (trace.encodingStrength >= HIGH_IMPORTANCE_THRESHOLD) {
      multiplier = Math.max(multiplier, HIGH_IMPORTANCE_FLOOR_MULTIPLIER);
    }

    // Only apply if multiplier actually reduces stability
    if (multiplier < 1.0) {
      trace.stability *= multiplier;
      meta.lastSourceDecayAt = now;
      count++;
    }
  }

  return count;
}

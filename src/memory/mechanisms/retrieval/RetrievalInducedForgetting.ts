/**
 * @fileoverview Retrieval-Induced Forgetting — competitor suppression.
 *
 * Cognitive science foundations:
 * - **Retrieval-Induced Forgetting** (Anderson, Bjork & Bjork, 1994):
 *   Retrieving one memory actively suppresses similar competitors via
 *   inhibitory mechanisms — not just a failure to retrieve, but active
 *   weakening of competing traces.
 * - **Inhibition account** (Anderson & Spellman, 1995): The suppression
 *   is inhibitory (trace-level), not associative (cue-level).
 *
 * @module agentos/memory/mechanisms/retrieval/RetrievalInducedForgetting
 */

import type { MemoryTrace, ScoredMemoryTrace } from '../../types.js';
import type { ResolvedRIFConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Traces with encoding strength above this are considered flashbulb-grade. */
const FLASHBULB_STRENGTH_FLOOR = 0.9;

/** Minimum strength to be eligible for suppression (don't kick dead traces). */
const MIN_SUPPRESSION_STRENGTH = 0.1;

// ---------------------------------------------------------------------------
// Retrieval-Induced Forgetting
// ---------------------------------------------------------------------------

/**
 * Apply retrieval-induced forgetting to competitor traces.
 *
 * Competitors are traces that were activated (passed to this function)
 * but NOT in the final retrieved set. Their stability is reduced by
 * `suppressionFactor`, modeling the inhibitory suppression of competing
 * memory traces during retrieval practice.
 *
 * @param retrieved   Traces that were selected by the retrieval pipeline.
 * @param competitors Traces activated but not selected (mutated in place).
 * @param config      Resolved RIF config.
 * @returns List of suppressed trace IDs.
 */
export function applyRetrievalInducedForgetting(
  retrieved: Array<MemoryTrace | ScoredMemoryTrace>,
  competitors: MemoryTrace[],
  config: ResolvedRIFConfig,
): { suppressedIds: string[] } {
  if (!config.enabled) return { suppressedIds: [] };

  const retrievedIds = new Set(retrieved.map((t) => t.id));
  const suppressedIds: string[] = [];
  let count = 0;

  for (const comp of competitors) {
    if (count >= config.maxSuppressionsPerQuery) break;
    if (retrievedIds.has(comp.id)) continue;

    // Guard: never suppress flashbulb-grade traces
    if (comp.encodingStrength >= FLASHBULB_STRENGTH_FLOOR) continue;

    // Guard: skip nearly-dead traces
    if (comp.encodingStrength < MIN_SUPPRESSION_STRENGTH) continue;

    // Apply stability reduction
    comp.stability *= (1 - config.suppressionFactor);
    suppressedIds.push(comp.id);
    count++;
  }

  return { suppressedIds };
}

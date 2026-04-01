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
import type { MemoryTrace, ScoredMemoryTrace } from '../../core/types.js';
import type { ResolvedRIFConfig } from '../types.js';
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
export declare function applyRetrievalInducedForgetting(retrieved: Array<MemoryTrace | ScoredMemoryTrace>, competitors: MemoryTrace[], config: ResolvedRIFConfig): {
    suppressedIds: string[];
};
//# sourceMappingURL=RetrievalInducedForgetting.d.ts.map
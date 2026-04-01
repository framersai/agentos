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
import type { MemoryTrace } from '../../core/types.js';
import type { ResolvedSourceConfidenceDecayConfig } from '../types.js';
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
export declare function applySourceConfidenceDecay(traces: MemoryTrace[], config: ResolvedSourceConfidenceDecayConfig): number;
//# sourceMappingURL=SourceConfidenceDecay.d.ts.map
/**
 * @fileoverview Reconsolidation — emotional drift on memory retrieval.
 *
 * Cognitive science foundations:
 * - **Reconsolidation** (Nader, Schafe & Le Doux, 2000): Retrieved memories
 *   re-enter a labile state and are restabilized with influence from the
 *   current emotional context. Each retrieval is a potential modification event.
 * - **Reconsolidation review** (Nader, 2003): Comprehensive review establishing
 *   reconsolidation as a general memory phenomenon beyond fear conditioning.
 *
 * @module agentos/memory/mechanisms/retrieval/Reconsolidation
 */
import type { MemoryTrace } from '../../core/types.js';
import type { PADState } from '../../core/config.js';
import type { ResolvedReconsolidationConfig } from '../types.js';
/**
 * Apply reconsolidation drift to a trace's emotional context.
 *
 * Blends the trace's PAD values toward the current mood by `driftRate`.
 * Respects importance immunity and cumulative drift caps.
 * Records a DriftEvent in trace metadata for auditability.
 *
 * @param trace       The memory trace being accessed (mutated in place).
 * @param currentMood Current GMI mood at retrieval time.
 * @param config      Resolved reconsolidation config.
 */
export declare function applyReconsolidation(trace: MemoryTrace, currentMood: PADState, config: ResolvedReconsolidationConfig): void;
//# sourceMappingURL=Reconsolidation.d.ts.map
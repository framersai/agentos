/**
 * @fileoverview Involuntary Recall — random old memory surfacing.
 *
 * Cognitive science foundations:
 * - **Involuntary autobiographical memory** (Berntsen, 2009): Memories
 *   frequently surface without deliberate retrieval effort, triggered by
 *   contextual cues. These involuntary memories tend to be more
 *   emotionally intense and specific than voluntary retrievals.
 * - **Diary study** (Berntsen & Hall, 2004): Involuntary memories are
 *   predominantly episodic, emotionally charged, and cue-driven.
 *
 * @module agentos/memory/mechanisms/retrieval/InvoluntaryRecall
 */
import type { MemoryTrace } from '../../core/types.js';
import type { ResolvedInvoluntaryRecallConfig } from '../types.js';
/**
 * Probabilistically select an involuntary memory from the trace pool.
 *
 * Selection is weighted by emotional intensity (`|valence| * arousal`) —
 * emotionally vivid memories surface involuntarily more often, matching
 * empirical findings (Berntsen, 2009).
 *
 * @param allTraces         Full pool of available memory traces.
 * @param alreadyRetrievedIds IDs already in the retrieved set (excluded).
 * @param config            Resolved involuntary recall config.
 * @returns The selected trace, or null if probability check fails or no candidates qualify.
 */
export declare function selectInvoluntaryMemory(allTraces: MemoryTrace[], alreadyRetrievedIds: Set<string>, config: ResolvedInvoluntaryRecallConfig): MemoryTrace | null;
//# sourceMappingURL=InvoluntaryRecall.d.ts.map
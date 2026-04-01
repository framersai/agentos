/**
 * @fileoverview Metacognitive Feeling-of-Knowing (FOK) detection.
 *
 * Cognitive science foundations:
 * - **Metamemory framework** (Nelson & Narens, 1990): Two-level monitoring
 *   system where a meta-level assesses object-level memory processes.
 * - **FOK paradigm** (Hart, 1965): Introduced the recall-judgment-recognition
 *   methodology for studying feeling-of-knowing states.
 * - **Accessibility model** (Koriat, 1993): FOK judgments are based on the
 *   amount and intensity of partial information that comes to mind, not
 *   direct access to trace strength.
 *
 * @module agentos/memory/mechanisms/retrieval/MetacognitiveFOK
 */
import type { ScoredMemoryTrace } from '../../core/types.js';
import type { ResolvedMetacognitiveFOKConfig, MetacognitiveSignal } from '../types.js';
/**
 * Detect tip-of-tongue and partial-recall states from scored candidates.
 *
 * Traces in the "partial activation zone" (above `partialActivationThreshold`
 * but below `retrievalCutoff`) produce MetacognitiveSignals.
 *
 * FOK score is based on (following Koriat's accessibility model):
 * - Gap between trace score and cutoff (smaller gap = higher FOK)
 * - Entity overlap with query entities (classic TOT trigger)
 * - Raw similarity score (accessibility heuristic)
 *
 * @param scoredCandidates All scored candidates from the retrieval pipeline.
 * @param retrievalCutoff  Minimum score that qualified for retrieval.
 * @param config           Resolved FOK config.
 * @param queryEntities    Entities extracted from the query (for TOT detection).
 */
export declare function detectFeelingOfKnowing(scoredCandidates: ScoredMemoryTrace[], retrievalCutoff: number, config: ResolvedMetacognitiveFOKConfig, queryEntities?: string[]): MetacognitiveSignal[];
//# sourceMappingURL=MetacognitiveFOK.d.ts.map
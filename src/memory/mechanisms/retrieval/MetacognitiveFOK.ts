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

const DAY_MS = 86_400_000;

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
export function detectFeelingOfKnowing(
  scoredCandidates: ScoredMemoryTrace[],
  retrievalCutoff: number,
  config: ResolvedMetacognitiveFOKConfig,
  queryEntities: string[] = [],
): MetacognitiveSignal[] {
  if (!config.enabled) return [];

  const signals: MetacognitiveSignal[] = [];
  const queryEntitySet = new Set(queryEntities.map((e) => e.toLowerCase()));

  for (const trace of scoredCandidates) {
    const score = trace.retrievalScore;

    // Must be in partial activation zone: above threshold, below cutoff
    if (score >= retrievalCutoff || score < config.partialActivationThreshold) continue;

    // Gap factor: how close to the cutoff (0 = far, 1 = almost retrieved)
    const range = retrievalCutoff - config.partialActivationThreshold;
    const gapFactor = range > 0 ? (score - config.partialActivationThreshold) / range : 0;

    // Similarity factor (raw accessibility signal per Koriat, 1993)
    const similarityFactor = trace.scoreBreakdown.similarityScore;

    // Entity overlap bonus (classic TOT: recognize the entity, can't recall details)
    let entityBonus = 0;
    if (queryEntitySet.size > 0 && trace.entities.length > 0) {
      const overlap = trace.entities.filter((e) => queryEntitySet.has(e.toLowerCase())).length;
      entityBonus = overlap / Math.max(queryEntitySet.size, trace.entities.length);
    }

    // Composite FOK (weighted blend)
    const fok = Math.min(1, gapFactor * 0.4 + similarityFactor * 0.3 + entityBonus * 0.3);

    // Build partial info string for prompt injection
    const parts: string[] = [];
    if (trace.entities.length > 0) parts.push(trace.entities.slice(0, 3).join(', '));
    if (trace.emotionalContext.gmiMood && trace.emotionalContext.gmiMood !== 'NEUTRAL') {
      parts.push(`mood: ${trace.emotionalContext.gmiMood}`);
    }
    const ageDays = Math.floor((Date.now() - trace.createdAt) / DAY_MS);
    if (ageDays > 0) parts.push(`~${ageDays} days ago`);

    signals.push({
      type: fok > 0.6 ? 'high_confidence' : 'tip_of_tongue',
      traceId: trace.id,
      feelingOfKnowing: fok,
      partialInfo: parts.length > 0 ? parts.join(' | ') : undefined,
    });
  }

  return signals;
}

/**
 * @fileoverview Composite retrieval priority scoring.
 *
 * Combines multiple signals into a single score for ranking memory traces:
 * - Current strength (Ebbinghaus decay)
 * - Vector similarity (semantic relevance)
 * - Recency boost (temporal proximity)
 * - Emotional congruence (mood-congruent recall)
 * - Graph activation (spreading activation — 0 in Batch 1)
 * - Importance (inherent importance of the memory)
 *
 * @module agentos/memory/decay/RetrievalPriorityScorer
 */
import type { MemoryTrace, ScoredMemoryTrace, PartiallyRetrievedTrace } from '../types.js';
import type { PADState, DecayConfig } from '../config.js';
export interface ScoringWeights {
    strength: number;
    similarity: number;
    recency: number;
    emotionalCongruence: number;
    graphActivation: number;
    importance: number;
}
export declare const DEFAULT_SCORING_WEIGHTS: ScoringWeights;
/**
 * Recency boost: exponential decay from recent events.
 * Recent memories (within the half-life window) get a small bonus.
 *
 * boost = 1 + 0.2 · e^(-elapsed / halfLife)
 */
export declare function computeRecencyBoost(lastAccessedAt: number, now: number, halfLifeMs?: number): number;
/**
 * Mood-congruent recall: current mood biases retrieval toward memories
 * with matching emotional valence.
 *
 * congruence = 1 + max(0, currentValence · traceValence) · 0.25
 */
export declare function computeEmotionalCongruence(currentMood: PADState, traceValence: number): number;
export interface ScoringContext {
    currentMood: PADState;
    now: number;
    /** Set to true to disable emotional congruence bias. */
    neutralMood?: boolean;
    decayConfig?: DecayConfig;
    weights?: ScoringWeights;
}
export interface CandidateTrace {
    trace: MemoryTrace;
    /** Cosine similarity from vector search (0-1). */
    vectorSimilarity: number;
    /** Activation level from spreading activation (0-1). 0 if graph not available. */
    graphActivation?: number;
}
/**
 * Score a batch of candidate traces and return them sorted by priority.
 */
export declare function scoreAndRankTraces(candidates: CandidateTrace[], context: ScoringContext): ScoredMemoryTrace[];
/**
 * Detect partially-accessible memories (high relevance but low strength).
 * These are memories the agent "almost" remembers — like tip-of-the-tongue states.
 */
export declare function detectPartiallyRetrieved(candidates: CandidateTrace[], now: number): PartiallyRetrievedTrace[];
//# sourceMappingURL=RetrievalPriorityScorer.d.ts.map
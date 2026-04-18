/**
 * @fileoverview Persona Drift Mechanism — the 9th cognitive mechanism.
 *
 * Analyzes accumulated episodic memory traces and relationship delta
 * signals to propose bounded HEXACO personality mutations. Heuristic
 * mode only (no LLM calls). Pattern detection maps emotional trace
 * distributions to trait drift proposals.
 *
 * @module agentos/memory/mechanisms/PersonaDriftMechanism
 */
import type { MemoryTrace } from '../core/types.js';
import type { HexacoTraits } from '../core/config.js';
export type HEXACOTrait = 'honesty' | 'emotionality' | 'extraversion' | 'agreeableness' | 'conscientiousness' | 'openness';
export interface PersonaDriftConfig {
    enabled: boolean;
    /** Consolidation cycles between drift analyses (default: 5). */
    analysisInterval: number;
    /** Minimum episodic traces since last analysis to trigger (default: 10). */
    minTracesForAnalysis: number;
    /** Maximum absolute trait change per analysis cycle (default: 0.05). */
    maxDeltaPerCycle: number;
    /** Weight high-arousal memories more heavily in pattern detection. */
    emotionalWeighting: boolean;
}
export declare const DEFAULT_PERSONA_DRIFT_CONFIG: PersonaDriftConfig;
export interface PersonalityDriftProposal {
    trait: HEXACOTrait;
    delta: number;
    confidence: number;
    reasoning: string;
    traceCount: number;
}
export interface RelationshipDriftInput {
    trustDelta: number;
    affectionDelta: number;
    tensionDelta: number;
    respectDelta: number;
}
/**
 * Analyze accumulated memory traces and relationship deltas to propose
 * HEXACO personality mutations. Heuristic mode — no LLM calls.
 *
 * @param traces - Episodic memory traces since last analysis
 * @param currentTraits - Current HEXACO trait values
 * @param config - Drift configuration
 * @param relationshipDeltas - Accumulated relationship dimension changes
 * @returns Array of trait mutation proposals, may be empty
 */
export declare function analyzePersonaDrift(traces: MemoryTrace[], currentTraits: HexacoTraits, config: PersonaDriftConfig, relationshipDeltas?: RelationshipDriftInput): PersonalityDriftProposal[];
//# sourceMappingURL=PersonaDriftMechanism.d.ts.map
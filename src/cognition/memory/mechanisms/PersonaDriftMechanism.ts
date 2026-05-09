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

// ─── Types ───────────────────────────────────────────────────────────────────

export type HEXACOTrait =
  | 'honesty'
  | 'emotionality'
  | 'extraversion'
  | 'agreeableness'
  | 'conscientiousness'
  | 'openness';

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

export const DEFAULT_PERSONA_DRIFT_CONFIG: PersonaDriftConfig = {
  enabled: false,
  analysisInterval: 5,
  minTracesForAnalysis: 10,
  maxDeltaPerCycle: 0.05,
  emotionalWeighting: true,
};

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

// ─── Analyzer ────────────────────────────────────────────────────────────────

const SCORE_THRESHOLD = 0.3;
const MAX_PROPOSALS = 2;

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
export function analyzePersonaDrift(
  traces: MemoryTrace[],
  currentTraits: HexacoTraits,
  config: PersonaDriftConfig,
  relationshipDeltas?: RelationshipDriftInput
): PersonalityDriftProposal[] {
  if (!config.enabled) return [];
  if (traces.length < config.minTracesForAnalysis) return [];

  // Filter to traces with emotional context
  const emotionalTraces = traces.filter(
    (t) => t.emotionalContext && typeof t.emotionalContext.valence === 'number'
  );
  if (emotionalTraces.length === 0) return [];

  const total = emotionalTraces.length;

  // Compute pattern scores (0-1 normalized)
  let conflictScore =
    emotionalTraces.filter(
      (t) => t.emotionalContext.valence < -0.3 && t.emotionalContext.arousal > 0.4
    ).length / total;

  let positiveArousalScore =
    emotionalTraces.filter(
      (t) => t.emotionalContext.valence > 0.3 && t.emotionalContext.arousal > 0.3
    ).length / total;

  const emotionalIntensity =
    emotionalTraces.reduce((sum, t) => sum + Math.abs(t.emotionalContext.arousal), 0) / total;

  const lowArousalScore =
    emotionalTraces.filter(
      (t) =>
        t.emotionalContext.arousal < 0.3 &&
        Math.abs(t.emotionalContext.valence) < 0.3
    ).length / total;

  // Apply relationship delta bias (normalize deltas to 0-1 range)
  if (relationshipDeltas) {
    if (relationshipDeltas.trustDelta < -10) {
      conflictScore += (Math.abs(relationshipDeltas.trustDelta) / 100) * 0.5;
    }
    if (relationshipDeltas.affectionDelta > 10) {
      positiveArousalScore += (relationshipDeltas.affectionDelta / 100) * 0.3;
    }
    if (relationshipDeltas.tensionDelta > 10) {
      conflictScore += (relationshipDeltas.tensionDelta / 100) * 0.3;
    }
  }

  // Confidence scales with trace count: minTraces = 0.3, 50+ = 1.0
  const confidence = Math.min(1.0, 0.3 + (total / 50) * 0.7);

  // Generate proposals for scores above threshold
  const candidates: PersonalityDriftProposal[] = [];

  if (conflictScore > SCORE_THRESHOLD) {
    candidates.push(
      clampProposal('agreeableness', -conflictScore * config.maxDeltaPerCycle * confidence,
        currentTraits, config, total,
        `Repeated conflict and tension (${(conflictScore * 100).toFixed(0)}% of interactions) shifted toward guardedness.`
      )
    );
  }

  if (positiveArousalScore > SCORE_THRESHOLD) {
    candidates.push(
      clampProposal('extraversion', positiveArousalScore * config.maxDeltaPerCycle * confidence,
        currentTraits, config, total,
        `Frequent positive engagement (${(positiveArousalScore * 100).toFixed(0)}% of interactions) encouraged openness to others.`
      )
    );
  }

  if (emotionalIntensity > 0.6) {
    candidates.push(
      clampProposal('emotionality', (emotionalIntensity - 0.5) * config.maxDeltaPerCycle * confidence,
        currentTraits, config, total,
        `High emotional intensity across interactions deepened emotional responsiveness.`
      )
    );
  }

  if (lowArousalScore > SCORE_THRESHOLD) {
    candidates.push(
      clampProposal('conscientiousness', lowArousalScore * config.maxDeltaPerCycle * confidence * 0.5,
        currentTraits, config, total,
        `Steady, low-arousal routine interactions reinforced disciplined behavior.`
      )
    );
  }

  // Relationship-specific proposals
  if (relationshipDeltas) {
    if (relationshipDeltas.trustDelta < -15) {
      candidates.push(
        clampProposal('honesty', (relationshipDeltas.trustDelta / 100) * config.maxDeltaPerCycle * confidence,
          currentTraits, config, total,
          `Significant trust erosion prompted greater self-protectiveness.`
        )
      );
    }
    if (relationshipDeltas.respectDelta > 15) {
      candidates.push(
        clampProposal('conscientiousness', (relationshipDeltas.respectDelta / 100) * config.maxDeltaPerCycle * confidence,
          currentTraits, config, total,
          `Growing respect from demonstrated competence reinforced conscientiousness.`
        )
      );
    }
  }

  // Sort by absolute delta descending, take top MAX_PROPOSALS
  candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return candidates.slice(0, MAX_PROPOSALS);
}

/** Clamp a proposal's delta so the resulting trait stays in [0, 1]. */
function clampProposal(
  trait: HEXACOTrait,
  rawDelta: number,
  traits: HexacoTraits,
  config: PersonaDriftConfig,
  traceCount: number,
  reasoning: string,
): PersonalityDriftProposal {
  const current = traits[trait] ?? 0.5;
  let delta = Math.max(-config.maxDeltaPerCycle, Math.min(config.maxDeltaPerCycle, rawDelta));
  if (current + delta > 1) delta = 1 - current;
  if (current + delta < 0) delta = -current;
  return {
    trait,
    delta: Math.round(delta * 1000) / 1000,
    confidence: Math.min(1.0, 0.3 + (traceCount / 50) * 0.7),
    reasoning,
    traceCount,
  };
}

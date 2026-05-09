/**
 * @fileoverview Emotion Regulation — reappraisal and suppression.
 *
 * Cognitive science foundations:
 * - **Process model** (Gross, 1998): Emotion regulation strategies deploy
 *   at different points in the emotion-generative process. Antecedent-focused
 *   strategies (cognitive reappraisal) are more effective than response-focused
 *   strategies (suppression) for well-being outcomes.
 * - **Extended process model** (Gross, 2015): Multi-level dynamics of
 *   regulation, including valuation-system framework.
 *
 * @module agentos/memory/mechanisms/consolidation/EmotionRegulation
 */

import type { MemoryTrace } from '../../core/types.js';
import type { ResolvedEmotionRegulationConfig, MechanismMetadata } from '../types.js';

/** Flashbulb-grade encoding strength threshold. */
const FLASHBULB_STRENGTH = 0.9;

/** Minimum arousal for reappraisal targeting. */
const MIN_AROUSAL_FOR_REGULATION = 0.6;

/** Suppression strength reduction factor. */
const SUPPRESSION_STRENGTH_FACTOR = 0.9;

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

function getMeta(trace: MemoryTrace): MechanismMetadata {
  if (!trace.structuredData) trace.structuredData = {};
  if (!trace.structuredData.mechanismMetadata) {
    trace.structuredData.mechanismMetadata = {};
  }
  return trace.structuredData.mechanismMetadata as MechanismMetadata;
}

// ---------------------------------------------------------------------------
// Emotion Regulation
// ---------------------------------------------------------------------------

/**
 * Apply emotion regulation (reappraisal + suppression) to high-arousal traces.
 *
 * **Cognitive Reappraisal** (antecedent-focused): Reduces valence and arousal
 * intensity, modeling the agent "processing" intense emotional memories.
 *
 * **Emotional Suppression** (response-focused): Reduces encoding strength
 * (retrieval probability) without changing the emotional valence. Less
 * effective long-term, matching Gross's empirical findings.
 *
 * @param traces All active traces (mutated in place).
 * @param config Resolved emotion regulation config.
 * @returns Number of traces regulated (reappraisal + suppression combined).
 */
export function applyEmotionRegulation(
  traces: MemoryTrace[],
  config: ResolvedEmotionRegulationConfig,
): number {
  if (!config.enabled) return 0;

  // Identify regulation candidates
  const candidates = traces.filter((t) =>
    t.isActive &&
    t.encodingStrength < FLASHBULB_STRENGTH && // never regulate flashbulb
    Math.abs(t.emotionalContext.valence) > config.suppressionThreshold &&
    t.emotionalContext.arousal > MIN_AROUSAL_FOR_REGULATION,
  );

  // Sort by arousal descending (most intense first)
  candidates.sort((a, b) => b.emotionalContext.arousal - a.emotionalContext.arousal);

  let regulatedCount = 0;

  // Phase 1: Cognitive Reappraisal
  for (const trace of candidates) {
    if (regulatedCount >= config.maxRegulationPerCycle) break;

    const meta = getMeta(trace);
    const prevValence = trace.emotionalContext.valence;
    const prevArousal = trace.emotionalContext.arousal;

    // Reduce intensity (move valence toward 0, reduce arousal)
    trace.emotionalContext.valence *= (1 - config.reappraisalRate);
    trace.emotionalContext.arousal *= (1 - config.reappraisalRate);
    trace.emotionalContext.intensity =
      Math.abs(trace.emotionalContext.valence) * Math.max(0, trace.emotionalContext.arousal);

    // Record reappraisal event
    if (!meta.reappraisalHistory) meta.reappraisalHistory = [];
    meta.reappraisalHistory.push({
      reappraisedAt: Date.now(),
      previousValence: prevValence,
      previousArousal: prevArousal,
    });

    regulatedCount++;
  }

  // Phase 2: Suppression for traces still exceeding threshold
  for (const trace of candidates) {
    if (Math.abs(trace.emotionalContext.valence) <= config.suppressionThreshold) continue;
    if (trace.emotionalContext.arousal <= MIN_AROUSAL_FOR_REGULATION) continue;

    // Suppression: reduce retrieval probability, not the feeling
    trace.encodingStrength *= SUPPRESSION_STRENGTH_FACTOR;
  }

  return regulatedCount;
}

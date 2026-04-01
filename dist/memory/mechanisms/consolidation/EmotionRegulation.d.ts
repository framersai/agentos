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
import type { ResolvedEmotionRegulationConfig } from '../types.js';
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
export declare function applyEmotionRegulation(traces: MemoryTrace[], config: ResolvedEmotionRegulationConfig): number;
//# sourceMappingURL=EmotionRegulation.d.ts.map
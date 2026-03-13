/**
 * @fileoverview Personality-modulated memory encoding.
 *
 * Cognitive science foundations:
 * - **Yerkes-Dodson law**: Encoding quality peaks at moderate arousal
 *   (inverted U). Very low or very high arousal impairs encoding.
 * - **Flashbulb memories**: Highly emotional events create vivid,
 *   persistent memory traces (Brown & Kulik, 1977).
 * - **Mood-congruent encoding**: Content whose emotional valence matches
 *   the current mood is encoded more strongly.
 * - **HEXACO → attention weights**: Personality traits modulate *what*
 *   features of the input are noticed and how strongly they are encoded.
 *
 * @module agentos/memory/encoding/EncodingModel
 */

import type {
  EncodingWeights,
  EncodingResult,
  ContentFeatures,
  EmotionalContext,
} from '../types.js';
import type { HexacoTraits, PADState, EncodingConfig } from '../config.js';
import { DEFAULT_ENCODING_CONFIG } from '../config.js';

// ---------------------------------------------------------------------------
// HEXACO → Encoding attention weights
// ---------------------------------------------------------------------------

const clamp01 = (v: number | undefined): number =>
  v == null ? 0.5 : Math.max(0, Math.min(1, v));

/**
 * Derive per-feature attention weights from HEXACO personality traits.
 * Each weight is in [0, 1] and modulates how much a given content feature
 * contributes to encoding strength.
 */
export function computeEncodingWeights(traits: HexacoTraits): EncodingWeights {
  const o = clamp01(traits.openness);
  const c = clamp01(traits.conscientiousness);
  const e = clamp01(traits.emotionality);
  const x = clamp01(traits.extraversion);
  const a = clamp01(traits.agreeableness);
  const h = clamp01(traits.honesty);

  return {
    noveltyAttention: 0.3 + o * 0.7,
    proceduralAttention: 0.3 + c * 0.7,
    emotionalSensitivity: 0.2 + e * 0.8,
    socialAttention: 0.2 + x * 0.8,
    cooperativeAttention: 0.2 + a * 0.8,
    ethicalAttention: 0.2 + h * 0.8,
  };
}

// ---------------------------------------------------------------------------
// Yerkes-Dodson inverted U
// ---------------------------------------------------------------------------

/**
 * Encoding quality modifier based on arousal level.
 * Returns a multiplier in [0.3, 1.0], peaking at arousal = 0.5 (moderate).
 *
 *   f(a) = 1 - 4 * (a - 0.5)^2
 *
 * @param arousal01 Arousal normalised to 0..1 range.
 */
export function yerksDodson(arousal01: number): number {
  const centered = arousal01 - 0.5;
  return Math.max(0.3, 1.0 - 4 * centered * centered);
}

// ---------------------------------------------------------------------------
// Content-type attention multiplier
// ---------------------------------------------------------------------------

/**
 * Compute a composite attention multiplier from content features weighted
 * by personality-derived encoding weights.
 */
export function computeAttentionMultiplier(
  weights: EncodingWeights,
  features: ContentFeatures,
): number {
  let m = 0.5; // base attention

  if (features.hasNovelty) m += weights.noveltyAttention * 0.15;
  if (features.hasProcedure) m += weights.proceduralAttention * 0.15;
  if (features.hasEmotion) m += weights.emotionalSensitivity * 0.10;
  if (features.hasSocialContent) m += weights.socialAttention * 0.10;
  if (features.hasCooperation) m += weights.cooperativeAttention * 0.10;
  if (features.hasEthicalContent) m += weights.ethicalAttention * 0.10;
  if (features.hasContradiction) m += 0.15; // contradictions always draw attention
  m += features.topicRelevance * 0.15;

  return Math.min(1.0, m);
}

// ---------------------------------------------------------------------------
// Mood-congruent encoding bias
// ---------------------------------------------------------------------------

/**
 * Boost factor when content emotional valence matches current mood.
 *
 * Positive product means mood and content are congruent
 * (both positive or both negative).
 */
export function moodCongruenceBoost(
  currentValence: number,
  contentValence: number,
  emotionalSensitivity: number,
): number {
  const congruence = Math.max(0, currentValence * contentValence);
  return 1 + congruence * emotionalSensitivity * 0.3;
}

// ---------------------------------------------------------------------------
// Flashbulb detection
// ---------------------------------------------------------------------------

/**
 * Determine whether this memory qualifies as a flashbulb memory.
 * Flashbulb criteria: emotional intensity > threshold.
 */
export function isFlashbulbMemory(
  emotionalIntensity: number,
  threshold: number = DEFAULT_ENCODING_CONFIG.flashbulbThreshold,
): boolean {
  return emotionalIntensity > threshold;
}

// ---------------------------------------------------------------------------
// Build emotional context from PAD state + content sentiment
// ---------------------------------------------------------------------------

/**
 * Create the EmotionalContext snapshot for a memory trace.
 * Blends content sentiment with current mood (70/30 split).
 *
 * @param currentMood  Current PAD state from MoodEngine.
 * @param contentSentiment  Estimated sentiment of the content (-1..1). Defaults to 0.
 * @param gmiMood  Current GMI mood enum string.
 */
export function buildEmotionalContext(
  currentMood: PADState,
  gmiMood: string,
  contentSentiment: number = 0,
): EmotionalContext {
  const valence = contentSentiment * 0.7 + currentMood.valence * 0.3;
  // Normalise arousal from PAD range (-1..1) to (0..1)
  const arousal = (currentMood.arousal + 1) / 2;
  const intensity = Math.abs(valence) * arousal;

  return {
    valence,
    arousal,
    dominance: currentMood.dominance,
    intensity,
    gmiMood,
  };
}

// ---------------------------------------------------------------------------
// Main encoding function
// ---------------------------------------------------------------------------

/**
 * Compute encoding parameters for a new memory trace.
 *
 * Combines personality-modulated attention, Yerkes-Dodson arousal curve,
 * mood-congruent encoding bias, and flashbulb detection into a single
 * encoding result.
 */
export function computeEncodingStrength(
  currentMood: PADState,
  traits: HexacoTraits,
  contentFeatures: ContentFeatures,
  contentSentiment: number = 0,
  config: EncodingConfig = DEFAULT_ENCODING_CONFIG,
): EncodingResult {
  const weights = computeEncodingWeights(traits);
  const base = config.baseStrength;

  // Arousal boost via Yerkes-Dodson (normalise -1..1 → 0..1)
  const arousal01 = (currentMood.arousal + 1) / 2;
  const arousalBoost = yerksDodson(arousal01);

  // Emotional intensity
  const valence = contentSentiment * 0.7 + currentMood.valence * 0.3;
  const emotionalIntensity = Math.abs(valence) * arousal01;
  const emotionalBoost = 1 + emotionalIntensity * weights.emotionalSensitivity * 0.5;

  // Content-type attention multiplier
  const attentionMultiplier = computeAttentionMultiplier(weights, contentFeatures);

  // Mood-congruent encoding
  const congruenceBoost = moodCongruenceBoost(
    currentMood.valence,
    contentSentiment,
    weights.emotionalSensitivity,
  );

  // Flashbulb detection
  const flashbulb = isFlashbulbMemory(emotionalIntensity, config.flashbulbThreshold);
  const flashbulbBoost = flashbulb ? config.flashbulbStrengthMultiplier : 1.0;

  // Composite initial strength
  const strength = Math.min(
    1.0,
    base * arousalBoost * emotionalBoost * attentionMultiplier * congruenceBoost * flashbulbBoost,
  );

  // Stability: higher strength → more stable; flashbulb → much more stable
  const stabilityMultiplier = flashbulb ? config.flashbulbStabilityMultiplier : 1.0;
  const stability = config.baseStabilityMs * (1 + strength * 6) * stabilityMultiplier;

  // Importance: blend of strength and content relevance
  const importance = Math.min(1.0, strength * 0.6 + attentionMultiplier * 0.4);

  return {
    initialStrength: strength,
    stability,
    importance,
    isFlashbulb: flashbulb,
  };
}

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
import type { EncodingWeights, EncodingResult, ContentFeatures, EmotionalContext } from '../types.js';
import type { HexacoTraits, PADState, EncodingConfig } from '../config.js';
/**
 * Derive per-feature attention weights from HEXACO personality traits.
 * Each weight is in [0, 1] and modulates how much a given content feature
 * contributes to encoding strength.
 */
export declare function computeEncodingWeights(traits: HexacoTraits): EncodingWeights;
/**
 * Encoding quality modifier based on arousal level.
 * Returns a multiplier in [0.3, 1.0], peaking at arousal = 0.5 (moderate).
 *
 *   f(a) = 1 - 4 * (a - 0.5)^2
 *
 * @param arousal01 Arousal normalised to 0..1 range.
 */
export declare function yerksDodson(arousal01: number): number;
/**
 * Compute a composite attention multiplier from content features weighted
 * by personality-derived encoding weights.
 */
export declare function computeAttentionMultiplier(weights: EncodingWeights, features: ContentFeatures): number;
/**
 * Boost factor when content emotional valence matches current mood.
 *
 * Positive product means mood and content are congruent
 * (both positive or both negative).
 */
export declare function moodCongruenceBoost(currentValence: number, contentValence: number, emotionalSensitivity: number): number;
/**
 * Determine whether this memory qualifies as a flashbulb memory.
 * Flashbulb criteria: emotional intensity > threshold.
 */
export declare function isFlashbulbMemory(emotionalIntensity: number, threshold?: number): boolean;
/**
 * Create the EmotionalContext snapshot for a memory trace.
 * Blends content sentiment with current mood (70/30 split).
 *
 * @param currentMood  Current PAD state from MoodEngine.
 * @param contentSentiment  Estimated sentiment of the content (-1..1). Defaults to 0.
 * @param gmiMood  Current GMI mood enum string.
 */
export declare function buildEmotionalContext(currentMood: PADState, gmiMood: string, contentSentiment?: number): EmotionalContext;
/**
 * Compute encoding parameters for a new memory trace.
 *
 * Combines personality-modulated attention, Yerkes-Dodson arousal curve,
 * mood-congruent encoding bias, and flashbulb detection into a single
 * encoding result.
 */
export declare function computeEncodingStrength(currentMood: PADState, traits: HexacoTraits, contentFeatures: ContentFeatures, contentSentiment?: number, config?: EncodingConfig): EncodingResult;
//# sourceMappingURL=EncodingModel.d.ts.map
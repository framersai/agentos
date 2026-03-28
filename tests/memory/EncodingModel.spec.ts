/**
 * @fileoverview Unit tests for the cognitive memory encoding model.
 * Tests Yerkes-Dodson curve, flashbulb detection, mood congruence,
 * HEXACO personality weight mapping, and composite encoding strength.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEncodingWeights,
  yerksDodson,
  computeAttentionMultiplier,
  moodCongruenceBoost,
  isFlashbulbMemory,
  buildEmotionalContext,
  computeEncodingStrength,
} from '../../src/memory/core/encoding/EncodingModel';
import type { ContentFeatures } from '../../src/memory/core/types';
import type { HexacoTraits, PADState, EncodingConfig } from '../../src/memory/core/config';
import { DEFAULT_ENCODING_CONFIG } from '../../src/memory/core/config';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const neutralMood: PADState = { valence: 0, arousal: 0, dominance: 0 };
const happyMood: PADState = { valence: 0.8, arousal: 0.3, dominance: 0.2 };
const anxiousMood: PADState = { valence: -0.4, arousal: 0.8, dominance: -0.3 };

const emptyFeatures: ContentFeatures = {
  hasNovelty: false,
  hasProcedure: false,
  hasEmotion: false,
  hasSocialContent: false,
  hasCooperation: false,
  hasEthicalContent: false,
  hasContradiction: false,
  topicRelevance: 0.5,
};

const richFeatures: ContentFeatures = {
  hasNovelty: true,
  hasProcedure: true,
  hasEmotion: true,
  hasSocialContent: true,
  hasCooperation: true,
  hasEthicalContent: true,
  hasContradiction: true,
  topicRelevance: 0.9,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EncodingModel', () => {
  describe('computeEncodingWeights', () => {
    it('returns neutral weights for empty traits', () => {
      const weights = computeEncodingWeights({});
      // All traits default to 0.5, so: 0.3 + 0.5 * 0.7 = 0.65 for openness-based
      expect(weights.noveltyAttention).toBeCloseTo(0.65);
      expect(weights.proceduralAttention).toBeCloseTo(0.65);
      expect(weights.emotionalSensitivity).toBeCloseTo(0.6);
      expect(weights.socialAttention).toBeCloseTo(0.6);
    });

    it('high openness → high novelty attention', () => {
      const weights = computeEncodingWeights({ openness: 1.0 });
      expect(weights.noveltyAttention).toBeCloseTo(1.0);
    });

    it('low openness → low novelty attention', () => {
      const weights = computeEncodingWeights({ openness: 0.0 });
      expect(weights.noveltyAttention).toBeCloseTo(0.3);
    });

    it('high conscientiousness → high procedural attention', () => {
      const weights = computeEncodingWeights({ conscientiousness: 1.0 });
      expect(weights.proceduralAttention).toBeCloseTo(1.0);
    });

    it('high emotionality → high emotional sensitivity', () => {
      const weights = computeEncodingWeights({ emotionality: 1.0 });
      expect(weights.emotionalSensitivity).toBeCloseTo(1.0);
    });

    it('clamps traits outside [0,1] range', () => {
      const weights = computeEncodingWeights({ openness: 2.0, emotionality: -1.0 });
      expect(weights.noveltyAttention).toBeCloseTo(1.0); // clamped to 1.0
      expect(weights.emotionalSensitivity).toBeCloseTo(0.2); // clamped to 0.0
    });
  });

  describe('yerksDodson', () => {
    it('peaks at moderate arousal (0.5)', () => {
      expect(yerksDodson(0.5)).toBeCloseTo(1.0);
    });

    it('is lower at very low arousal (0.0)', () => {
      expect(yerksDodson(0.0)).toBeLessThan(yerksDodson(0.5));
    });

    it('is lower at very high arousal (1.0)', () => {
      expect(yerksDodson(1.0)).toBeLessThan(yerksDodson(0.5));
    });

    it('is symmetric around 0.5', () => {
      expect(yerksDodson(0.3)).toBeCloseTo(yerksDodson(0.7));
    });

    it('never drops below 0.3', () => {
      expect(yerksDodson(0.0)).toBeGreaterThanOrEqual(0.3);
      expect(yerksDodson(1.0)).toBeGreaterThanOrEqual(0.3);
    });

    it('returns expected value at 0: 1 - 4*(0.5)^2 = 0.0, clamped to 0.3', () => {
      expect(yerksDodson(0.0)).toBeCloseTo(0.3);
    });
  });

  describe('computeAttentionMultiplier', () => {
    it('returns base 0.5 for no features', () => {
      const weights = computeEncodingWeights({});
      const features: ContentFeatures = { ...emptyFeatures, topicRelevance: 0 };
      expect(computeAttentionMultiplier(weights, features)).toBeCloseTo(0.5);
    });

    it('is higher with more features present', () => {
      const weights = computeEncodingWeights({});
      const plain = computeAttentionMultiplier(weights, emptyFeatures);
      const rich = computeAttentionMultiplier(weights, richFeatures);
      expect(rich).toBeGreaterThan(plain);
    });

    it('contradictions always add 0.15', () => {
      const weights = computeEncodingWeights({});
      const withoutContra = { ...emptyFeatures, topicRelevance: 0 };
      const withContra = { ...emptyFeatures, hasContradiction: true, topicRelevance: 0 };
      expect(
        computeAttentionMultiplier(weights, withContra) -
        computeAttentionMultiplier(weights, withoutContra),
      ).toBeCloseTo(0.15);
    });

    it('caps at 1.0', () => {
      const weights = computeEncodingWeights({ openness: 1, conscientiousness: 1, emotionality: 1, extraversion: 1, agreeableness: 1, honesty: 1 });
      expect(computeAttentionMultiplier(weights, richFeatures)).toBeLessThanOrEqual(1.0);
    });
  });

  describe('moodCongruenceBoost', () => {
    it('boosts when mood and content valence match (both positive)', () => {
      const boost = moodCongruenceBoost(0.8, 0.6, 0.8);
      expect(boost).toBeGreaterThan(1.0);
    });

    it('boosts when mood and content valence match (both negative)', () => {
      const boost = moodCongruenceBoost(-0.5, -0.7, 0.8);
      expect(boost).toBeGreaterThan(1.0);
    });

    it('returns 1.0 when mood and content are incongruent', () => {
      const boost = moodCongruenceBoost(0.8, -0.5, 0.8);
      expect(boost).toBeCloseTo(1.0);
    });

    it('returns 1.0 when either valence is 0', () => {
      expect(moodCongruenceBoost(0, 0.8, 0.8)).toBeCloseTo(1.0);
    });

    it('scales with emotional sensitivity', () => {
      const low = moodCongruenceBoost(0.5, 0.5, 0.2);
      const high = moodCongruenceBoost(0.5, 0.5, 1.0);
      expect(high).toBeGreaterThan(low);
    });
  });

  describe('isFlashbulbMemory', () => {
    it('returns true when intensity > threshold', () => {
      expect(isFlashbulbMemory(0.9)).toBe(true);
    });

    it('returns false when intensity <= threshold', () => {
      expect(isFlashbulbMemory(0.8)).toBe(false);
      expect(isFlashbulbMemory(0.5)).toBe(false);
    });

    it('respects custom threshold', () => {
      expect(isFlashbulbMemory(0.6, 0.5)).toBe(true);
      expect(isFlashbulbMemory(0.4, 0.5)).toBe(false);
    });
  });

  describe('buildEmotionalContext', () => {
    it('blends content sentiment (70%) with mood (30%)', () => {
      const ctx = buildEmotionalContext({ valence: 1.0, arousal: 0, dominance: 0 }, 'happy', 0);
      // valence = 0 * 0.7 + 1.0 * 0.3 = 0.3
      expect(ctx.valence).toBeCloseTo(0.3);
    });

    it('normalises arousal from PAD range to 0-1', () => {
      const ctx = buildEmotionalContext({ valence: 0, arousal: 0.0, dominance: 0 }, 'neutral');
      // arousal = (0 + 1) / 2 = 0.5
      expect(ctx.arousal).toBeCloseTo(0.5);
    });

    it('computes intensity as |valence| * arousal', () => {
      const ctx = buildEmotionalContext({ valence: -0.5, arousal: 0.6, dominance: 0 }, 'sad', -0.8);
      // valence = -0.8 * 0.7 + (-0.5) * 0.3 = -0.71
      // arousal = (0.6 + 1) / 2 = 0.8
      // intensity = 0.71 * 0.8 = ~0.568
      expect(ctx.intensity).toBeCloseTo(Math.abs(ctx.valence) * ctx.arousal);
    });

    it('preserves gmiMood string', () => {
      const ctx = buildEmotionalContext(neutralMood, 'melancholy');
      expect(ctx.gmiMood).toBe('melancholy');
    });
  });

  describe('computeEncodingStrength', () => {
    it('returns a valid EncodingResult shape', () => {
      const result = computeEncodingStrength(neutralMood, {}, emptyFeatures);
      expect(result).toHaveProperty('initialStrength');
      expect(result).toHaveProperty('stability');
      expect(result).toHaveProperty('importance');
      expect(result).toHaveProperty('isFlashbulb');
    });

    it('strength is higher with rich features than empty features', () => {
      const plain = computeEncodingStrength(neutralMood, {}, emptyFeatures);
      const rich = computeEncodingStrength(neutralMood, {}, richFeatures);
      expect(rich.initialStrength).toBeGreaterThan(plain.initialStrength);
    });

    it('strength is clamped to [0, 1]', () => {
      const result = computeEncodingStrength(happyMood, { openness: 1, emotionality: 1 }, richFeatures, 0.9);
      expect(result.initialStrength).toBeLessThanOrEqual(1.0);
      expect(result.initialStrength).toBeGreaterThanOrEqual(0);
    });

    it('stability is higher for stronger memories', () => {
      const weak = computeEncodingStrength(neutralMood, {}, emptyFeatures, 0);
      const strong = computeEncodingStrength(happyMood, { emotionality: 1 }, richFeatures, 0.8);
      expect(strong.stability).toBeGreaterThan(weak.stability);
    });

    it('flashbulb memories get multiplied strength and stability', () => {
      // High emotion content + high arousal → flashbulb
      const extreme: PADState = { valence: 0.9, arousal: 0.9, dominance: 0 };
      const result = computeEncodingStrength(extreme, { emotionality: 1.0 }, richFeatures, 0.95);
      expect(result.isFlashbulb).toBe(true);
      expect(result.stability).toBeGreaterThan(DEFAULT_ENCODING_CONFIG.baseStabilityMs * 2);
    });

    it('different HEXACO profiles produce different encoding strengths', () => {
      const openPersona = computeEncodingStrength(neutralMood, { openness: 1.0 }, { ...emptyFeatures, hasNovelty: true });
      const closedPersona = computeEncodingStrength(neutralMood, { openness: 0.0 }, { ...emptyFeatures, hasNovelty: true });
      expect(openPersona.initialStrength).toBeGreaterThan(closedPersona.initialStrength);
    });
  });
});

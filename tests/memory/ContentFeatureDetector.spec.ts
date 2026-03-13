/**
 * @fileoverview Unit tests for content feature detection strategies.
 * Tests keyword patterns, LLM fallback, hybrid mode, and factory.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  KeywordFeatureDetector,
  LlmFeatureDetector,
  HybridFeatureDetector,
  createFeatureDetector,
} from '../../src/memory/encoding/ContentFeatureDetector';

describe('ContentFeatureDetector', () => {
  describe('KeywordFeatureDetector', () => {
    const detector = new KeywordFeatureDetector();

    it('detects novelty keywords', async () => {
      const result = await detector.detect('This is a brand new discovery!');
      expect(result.hasNovelty).toBe(true);
    });

    it('detects procedure keywords', async () => {
      const result = await detector.detect('Step 1: Open the file. Then save it.');
      expect(result.hasProcedure).toBe(true);
    });

    it('detects emotion keywords', async () => {
      const result = await detector.detect('I am so happy about this!');
      expect(result.hasEmotion).toBe(true);
    });

    it('detects social content', async () => {
      const result = await detector.detect('My colleague said we have a meeting tomorrow.');
      expect(result.hasSocialContent).toBe(true);
    });

    it('detects cooperation patterns', async () => {
      const result = await detector.detect('Let us work together on this and collaborate.');
      expect(result.hasCooperation).toBe(true);
    });

    it('detects ethical content', async () => {
      const result = await detector.detect('This raises serious privacy and ethical concerns.');
      expect(result.hasEthicalContent).toBe(true);
    });

    it('detects contradictions', async () => {
      const result = await detector.detect('Actually, that is incorrect. In fact, the opposite is true.');
      expect(result.hasContradiction).toBe(true);
    });

    it('returns all false for neutral content', async () => {
      const result = await detector.detect('The weather is mild.');
      expect(result.hasNovelty).toBe(false);
      expect(result.hasProcedure).toBe(false);
      expect(result.hasEmotion).toBe(false);
      expect(result.hasSocialContent).toBe(false);
      expect(result.hasCooperation).toBe(false);
      expect(result.hasEthicalContent).toBe(false);
      expect(result.hasContradiction).toBe(false);
    });

    it('always returns topicRelevance 0.5 (keyword cannot assess relevance)', async () => {
      const result = await detector.detect('anything');
      expect(result.topicRelevance).toBe(0.5);
    });
  });

  describe('LlmFeatureDetector', () => {
    it('parses valid LLM JSON response', async () => {
      const mockInvoker = vi.fn().mockResolvedValue(JSON.stringify({
        hasNovelty: true,
        hasProcedure: false,
        hasEmotion: true,
        hasSocialContent: false,
        hasCooperation: false,
        hasEthicalContent: false,
        hasContradiction: false,
        topicRelevance: 0.8,
      }));

      const detector = new LlmFeatureDetector(mockInvoker);
      const result = await detector.detect('test input');

      expect(result.hasNovelty).toBe(true);
      expect(result.hasEmotion).toBe(true);
      expect(result.topicRelevance).toBeCloseTo(0.8);
      expect(mockInvoker).toHaveBeenCalledOnce();
    });

    it('falls back to keyword detection on LLM failure', async () => {
      const mockInvoker = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
      const detector = new LlmFeatureDetector(mockInvoker);

      const result = await detector.detect('This is a new discovery!');
      // Should fall back to keyword detection
      expect(result.hasNovelty).toBe(true);
    });

    it('falls back on invalid JSON', async () => {
      const mockInvoker = vi.fn().mockResolvedValue('not json');
      const detector = new LlmFeatureDetector(mockInvoker);

      const result = await detector.detect('test');
      expect(result).toBeDefined();
      expect(typeof result.hasNovelty).toBe('boolean');
    });

    it('clamps topicRelevance to [0, 1]', async () => {
      const mockInvoker = vi.fn().mockResolvedValue(JSON.stringify({
        hasNovelty: false, hasProcedure: false, hasEmotion: false,
        hasSocialContent: false, hasCooperation: false, hasEthicalContent: false,
        hasContradiction: false, topicRelevance: 5.0,
      }));

      const detector = new LlmFeatureDetector(mockInvoker);
      const result = await detector.detect('test');
      expect(result.topicRelevance).toBeLessThanOrEqual(1.0);
    });
  });

  describe('HybridFeatureDetector', () => {
    it('uses keyword detection for real-time detect()', async () => {
      const mockInvoker = vi.fn();
      const detector = new HybridFeatureDetector(mockInvoker);

      await detector.detect('Step 1: Do this.');
      expect(mockInvoker).not.toHaveBeenCalled(); // LLM not called in real-time mode
    });

    it('uses LLM for deferred detectWithLlm()', async () => {
      const mockInvoker = vi.fn().mockResolvedValue(JSON.stringify({
        hasNovelty: true, hasProcedure: false, hasEmotion: false,
        hasSocialContent: false, hasCooperation: false, hasEthicalContent: false,
        hasContradiction: false, topicRelevance: 0.7,
      }));

      const detector = new HybridFeatureDetector(mockInvoker);
      const result = await detector.detectWithLlm('test');

      expect(mockInvoker).toHaveBeenCalled();
      expect(result.hasNovelty).toBe(true);
    });

    it('falls back to keyword if no LLM invoker provided', async () => {
      const detector = new HybridFeatureDetector();
      const result = await detector.detectWithLlm('New breakthrough!');
      expect(result.hasNovelty).toBe(true);
    });
  });

  describe('createFeatureDetector factory', () => {
    it('creates KeywordFeatureDetector for "keyword" strategy', () => {
      const detector = createFeatureDetector('keyword');
      expect(detector).toBeInstanceOf(KeywordFeatureDetector);
    });

    it('creates LlmFeatureDetector for "llm" strategy', () => {
      const detector = createFeatureDetector('llm', vi.fn());
      expect(detector).toBeInstanceOf(LlmFeatureDetector);
    });

    it('throws for "llm" strategy without invoker', () => {
      expect(() => createFeatureDetector('llm')).toThrow();
    });

    it('creates HybridFeatureDetector for "hybrid" strategy', () => {
      const detector = createFeatureDetector('hybrid', vi.fn());
      expect(detector).toBeInstanceOf(HybridFeatureDetector);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  MemoryTypeEnum,
  MemoryScopeEnum,
  ConfidenceScore,
  EntityArray,
  ImportanceScore,
  ObservationNoteOutput,
  ReflectionTraceOutput,
  ContentFeaturesOutput,
} from '../schema-primitives.js';

describe('schema-primitives', () => {
  describe('MemoryTypeEnum', () => {
    it('accepts all 5 memory types', () => {
      for (const type of ['episodic', 'semantic', 'procedural', 'prospective', 'relational']) {
        expect(MemoryTypeEnum.safeParse(type).success).toBe(true);
      }
    });
    it('rejects invalid types', () => {
      expect(MemoryTypeEnum.safeParse('invalid').success).toBe(false);
    });
  });

  describe('MemoryScopeEnum', () => {
    it('accepts all 4 scopes', () => {
      for (const scope of ['user', 'thread', 'persona', 'organization']) {
        expect(MemoryScopeEnum.safeParse(scope).success).toBe(true);
      }
    });
  });

  describe('ConfidenceScore', () => {
    it('accepts values in [0, 1]', () => {
      expect(ConfidenceScore.safeParse(0).success).toBe(true);
      expect(ConfidenceScore.safeParse(0.5).success).toBe(true);
      expect(ConfidenceScore.safeParse(1).success).toBe(true);
    });
    it('rejects values outside [0, 1]', () => {
      expect(ConfidenceScore.safeParse(-0.1).success).toBe(false);
      expect(ConfidenceScore.safeParse(1.1).success).toBe(false);
    });
  });

  describe('ImportanceScore', () => {
    it('defaults to 0.5 when undefined', () => {
      const result = ImportanceScore.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(0.5);
    });
  });

  describe('EntityArray', () => {
    it('defaults to empty array', () => {
      const result = EntityArray.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual([]);
    });
    it('accepts string arrays', () => {
      const result = EntityArray.safeParse(['user', 'cat']);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(['user', 'cat']);
    });
  });

  describe('ObservationNoteOutput', () => {
    it('validates a well-formed observation note', () => {
      const result = ObservationNoteOutput.safeParse({
        type: 'factual',
        content: 'User is an engineer',
        importance: 0.9,
        entities: ['user'],
      });
      expect(result.success).toBe(true);
    });
    it('rejects missing content', () => {
      const result = ObservationNoteOutput.safeParse({
        type: 'factual',
        importance: 0.5,
      });
      expect(result.success).toBe(false);
    });
    it('applies importance default', () => {
      const result = ObservationNoteOutput.safeParse({
        type: 'emotional',
        content: 'User seemed happy',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.importance).toBe(0.5);
    });
  });

  describe('ReflectionTraceOutput', () => {
    it('validates a well-formed reflection trace with defaults', () => {
      const result = ReflectionTraceOutput.safeParse({
        type: 'semantic',
        scope: 'user',
        content: 'User is a software engineer',
        confidence: 0.95,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entities).toEqual([]);
        expect(result.data.tags).toEqual([]);
        expect(result.data.scopeId).toBe('');
        expect(result.data.sourceType).toBe('reflection');
        expect(result.data.supersedes).toEqual([]);
        expect(result.data.consumedNotes).toEqual([]);
      }
    });
    it('accepts relational type', () => {
      const result = ReflectionTraceOutput.safeParse({
        type: 'relational',
        scope: 'user',
        content: 'User shared vulnerability',
        confidence: 0.8,
      });
      expect(result.success).toBe(true);
    });
    it('preserves optional reasoning field', () => {
      const result = ReflectionTraceOutput.safeParse({
        type: 'semantic',
        scope: 'user',
        content: 'A fact',
        confidence: 0.9,
        reasoning: 'This is a durable fact',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.reasoning).toBe('This is a durable fact');
    });
  });

  describe('ContentFeaturesOutput', () => {
    it('applies defaults for all boolean fields', () => {
      const result = ContentFeaturesOutput.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasNovelty).toBe(false);
        expect(result.data.hasProcedure).toBe(false);
        expect(result.data.hasEmotion).toBe(false);
        expect(result.data.hasSocialContent).toBe(false);
        expect(result.data.topicRelevance).toBe(0.5);
      }
    });
    it('accepts explicit values', () => {
      const result = ContentFeaturesOutput.safeParse({
        hasNovelty: true,
        hasEmotion: true,
        topicRelevance: 0.9,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasNovelty).toBe(true);
        expect(result.data.hasEmotion).toBe(true);
        expect(result.data.topicRelevance).toBe(0.9);
      }
    });
  });
});

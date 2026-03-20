/**
 * @file NerModelRecognizer.spec.ts
 * @description Tests for the Tier 3 NerModelRecognizer with a MOCKED
 * HuggingFace pipeline.
 *
 * The actual @huggingface/transformers library is NOT loaded in tests.
 * Instead, the NER pipeline is mocked via a custom shared service registry
 * that returns pre-defined BIO-tagged token arrays.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NerModelRecognizer } from '../../../../src/extensions/packs/pii-redaction/recognizers/NerModelRecognizer';
import type { NerToken } from '../../../../src/extensions/packs/pii-redaction/recognizers/NerModelRecognizer';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';
import type { PiiEntityType } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Mock pipeline factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock NER pipeline function that returns pre-defined BIO tokens
 * regardless of input text.  This allows deterministic testing of the BIO
 * merging logic without loading a real model.
 *
 * @param tokens - The fixed array of NER tokens to return.
 * @returns A vi.fn() mock that resolves to the given tokens.
 */
function createMockPipeline(tokens?: NerToken[]) {
  const defaultTokens: NerToken[] = [
    { entity: 'B-PER', word: 'John', start: 0, end: 4, score: 0.95 },
    { entity: 'I-PER', word: 'Smith', start: 5, end: 10, score: 0.93 },
    { entity: 'B-LOC', word: 'London', start: 20, end: 26, score: 0.91 },
  ];
  return vi.fn(async (_text: string) => tokens ?? defaultTokens);
}

/**
 * Creates a mock shared service registry that returns the given pipeline
 * function from `getOrCreate`.
 *
 * @param pipeline - The mock pipeline function to serve.
 * @returns A mock ISharedServiceRegistry.
 */
function createMockRegistry(pipeline: ReturnType<typeof createMockPipeline>): ISharedServiceRegistry {
  return {
    getOrCreate: vi.fn().mockResolvedValue(pipeline),
    has: vi.fn().mockReturnValue(false),
    release: vi.fn().mockResolvedValue(undefined),
    releaseAll: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NerModelRecognizer', () => {
  let recognizer: NerModelRecognizer;
  let mockPipeline: ReturnType<typeof createMockPipeline>;
  let mockRegistry: ISharedServiceRegistry;

  beforeEach(() => {
    mockPipeline = createMockPipeline();
    mockRegistry = createMockRegistry(mockPipeline);
    recognizer = new NerModelRecognizer(mockRegistry);
  });

  // -----------------------------------------------------------------------
  // Basic property checks
  // -----------------------------------------------------------------------

  it('should have the name "NerModelRecognizer"', () => {
    expect(recognizer.name).toBe('NerModelRecognizer');
  });

  it('should declare supported entity types', () => {
    expect(recognizer.supportedEntities).toContain('PERSON');
    expect(recognizer.supportedEntities).toContain('LOCATION');
    expect(recognizer.supportedEntities).toContain('ORGANIZATION');
  });

  // -----------------------------------------------------------------------
  // BERT label → PiiEntityType mapping
  // -----------------------------------------------------------------------

  it('should map B-PER/I-PER to PERSON entity type', async () => {
    const entities = await recognizer.recognize('John Smith lives in London');

    const person = entities.find((e) => e.entityType === 'PERSON');
    expect(person).toBeDefined();
    expect(person!.entityType).toBe('PERSON');
  });

  it('should map B-LOC to LOCATION entity type', async () => {
    const entities = await recognizer.recognize('John Smith lives in London');

    const location = entities.find((e) => e.entityType === 'LOCATION');
    expect(location).toBeDefined();
    expect(location!.entityType).toBe('LOCATION');
    expect(location!.text).toBe('London');
  });

  it('should map B-ORG/I-ORG to ORGANIZATION entity type', async () => {
    const orgPipeline = createMockPipeline([
      { entity: 'B-ORG', word: 'Google', start: 0, end: 6, score: 0.88 },
      { entity: 'I-ORG', word: 'Inc', start: 7, end: 10, score: 0.85 },
    ]);
    const orgRegistry = createMockRegistry(orgPipeline);
    const orgRecognizer = new NerModelRecognizer(orgRegistry);

    const entities = await orgRecognizer.recognize('Google Inc is a company');

    const org = entities.find((e) => e.entityType === 'ORGANIZATION');
    expect(org).toBeDefined();
    expect(org!.text).toContain('Google');
    expect(org!.text).toContain('Inc');
  });

  it('should map B-MISC to UNKNOWN_PII entity type', async () => {
    const miscPipeline = createMockPipeline([
      { entity: 'B-MISC', word: 'English', start: 0, end: 7, score: 0.82 },
    ]);
    const miscRegistry = createMockRegistry(miscPipeline);
    const miscRecognizer = new NerModelRecognizer(miscRegistry);

    const entities = await miscRecognizer.recognize('English is a language');

    const misc = entities.find((e) => e.entityType === 'UNKNOWN_PII');
    expect(misc).toBeDefined();
    expect(misc!.text).toBe('English');
  });

  // -----------------------------------------------------------------------
  // BIO token merging
  // -----------------------------------------------------------------------

  it('should merge B- and I- tokens into contiguous entities', async () => {
    const entities = await recognizer.recognize('John Smith lives in London');

    // B-PER + I-PER should produce a single PERSON entity "John Smith".
    const person = entities.find((e) => e.entityType === 'PERSON');
    expect(person).toBeDefined();
    expect(person!.text).toContain('John');
    expect(person!.text).toContain('Smith');
    // Start should be from the first token, end from the last.
    expect(person!.start).toBe(0);
    expect(person!.end).toBe(10);
  });

  it('should handle multiple consecutive I- tokens', async () => {
    const multiPipeline = createMockPipeline([
      { entity: 'B-PER', word: 'Mary', start: 0, end: 4, score: 0.95 },
      { entity: 'I-PER', word: 'Jane', start: 5, end: 9, score: 0.92 },
      { entity: 'I-PER', word: 'Watson', start: 10, end: 16, score: 0.90 },
    ]);
    const multiRegistry = createMockRegistry(multiPipeline);
    const multiRecognizer = new NerModelRecognizer(multiRegistry);

    const entities = await multiRecognizer.recognize('Mary Jane Watson');

    expect(entities).toHaveLength(1);
    expect(entities[0].text).toContain('Mary');
    expect(entities[0].text).toContain('Watson');
    expect(entities[0].start).toBe(0);
    expect(entities[0].end).toBe(16);
  });

  it('should start a new entity when a B- tag of a different type appears', async () => {
    const mixedPipeline = createMockPipeline([
      { entity: 'B-PER', word: 'Alice', start: 0, end: 5, score: 0.94 },
      { entity: 'B-LOC', word: 'Paris', start: 15, end: 20, score: 0.89 },
    ]);
    const mixedRegistry = createMockRegistry(mixedPipeline);
    const mixedRecognizer = new NerModelRecognizer(mixedRegistry);

    const entities = await mixedRecognizer.recognize('Alice went to Paris');

    expect(entities).toHaveLength(2);
    expect(entities[0].entityType).toBe('PERSON');
    expect(entities[1].entityType).toBe('LOCATION');
  });

  // -----------------------------------------------------------------------
  // Score reflects model confidence
  // -----------------------------------------------------------------------

  it('should set score as average of constituent token scores', async () => {
    const entities = await recognizer.recognize('John Smith lives in London');

    const person = entities.find((e) => e.entityType === 'PERSON');
    expect(person).toBeDefined();
    // Average of 0.95 and 0.93 = 0.94
    expect(person!.score).toBeCloseTo(0.94, 2);

    const location = entities.find((e) => e.entityType === 'LOCATION');
    expect(location).toBeDefined();
    // Single token with score 0.91
    expect(location!.score).toBeCloseTo(0.91, 2);
  });

  // -----------------------------------------------------------------------
  // Source field
  // -----------------------------------------------------------------------

  it('should always set source to "ner-model"', async () => {
    const entities = await recognizer.recognize('John Smith lives in London');

    for (const entity of entities) {
      expect(entity.source).toBe('ner-model');
    }
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  it('should include NER metadata (label, model, tokenCount)', async () => {
    const entities = await recognizer.recognize('John Smith lives in London');

    const person = entities.find((e) => e.entityType === 'PERSON');
    expect(person!.metadata).toBeDefined();
    expect(person!.metadata!.nerLabel).toBe('PER');
    expect(person!.metadata!.nerModel).toBe('Xenova/bert-base-NER');
    expect(person!.metadata!.tokenCount).toBe(2); // B-PER + I-PER
  });

  // -----------------------------------------------------------------------
  // Graceful degradation when transformers not installed
  // -----------------------------------------------------------------------

  it('should return empty when transformers fails to load', async () => {
    const brokenRegistry: ISharedServiceRegistry = {
      getOrCreate: vi.fn().mockRejectedValue(new Error('Module not found: @huggingface/transformers')),
      has: vi.fn().mockReturnValue(false),
      release: vi.fn().mockResolvedValue(undefined),
      releaseAll: vi.fn().mockResolvedValue(undefined),
    };

    const brokenRecognizer = new NerModelRecognizer(brokenRegistry);

    // First call should catch the error and degrade gracefully.
    const entities = await brokenRecognizer.recognize('John Smith');
    expect(entities).toEqual([]);

    // Subsequent calls should also return empty without retrying.
    const entities2 = await brokenRecognizer.recognize('Jane Doe');
    expect(entities2).toEqual([]);

    // Should have only tried to load once.
    expect(brokenRegistry.getOrCreate).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Entity type filtering
  // -----------------------------------------------------------------------

  it('should respect entityTypes filter', async () => {
    const entities = await recognizer.recognize('John Smith lives in London', {
      entityTypes: ['LOCATION'],
    });

    expect(entities.every((e) => e.entityType === 'LOCATION')).toBe(true);
    expect(entities.find((e) => e.entityType === 'PERSON')).toBeUndefined();
  });

  it('should return empty when entityTypes has no overlap with supported', async () => {
    const entities = await recognizer.recognize('John Smith', {
      entityTypes: ['EMAIL' as PiiEntityType, 'SSN' as PiiEntityType],
    });

    expect(entities).toEqual([]);
    // Should not even call the pipeline.
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // WordPiece sub-token handling
  // -----------------------------------------------------------------------

  it('should strip ## prefix from WordPiece sub-tokens when merging', async () => {
    const wpPipeline = createMockPipeline([
      { entity: 'B-PER', word: 'Mc', start: 0, end: 2, score: 0.90 },
      { entity: 'I-PER', word: '##Donald', start: 2, end: 8, score: 0.88 },
    ]);
    const wpRegistry = createMockRegistry(wpPipeline);
    const wpRecognizer = new NerModelRecognizer(wpRegistry);

    const entities = await wpRecognizer.recognize('McDonald');

    expect(entities).toHaveLength(1);
    // Should strip ## and concatenate without space.
    expect(entities[0].text).toBe('McDonald');
  });

  // -----------------------------------------------------------------------
  // Empty input / no entities
  // -----------------------------------------------------------------------

  it('should return empty for text with no NER entities', async () => {
    const emptyPipeline = createMockPipeline([]);
    const emptyRegistry = createMockRegistry(emptyPipeline);
    const emptyRecognizer = new NerModelRecognizer(emptyRegistry);

    const entities = await emptyRecognizer.recognize('Hello world');
    expect(entities).toEqual([]);
  });
});

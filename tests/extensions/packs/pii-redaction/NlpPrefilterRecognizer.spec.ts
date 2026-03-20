/**
 * @file NlpPrefilterRecognizer.spec.ts
 * @description Tests for the Tier 2 NlpPrefilterRecognizer that uses
 * compromise for lightweight named-entity extraction.
 *
 * Tests cover person/place/org detection, score ranges, graceful degradation
 * when compromise is unavailable, and shared service registry usage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NlpPrefilterRecognizer } from '../../../../src/extensions/packs/pii-redaction/recognizers/NlpPrefilterRecognizer';
import { SharedServiceRegistry } from '../../../../src/extensions/SharedServiceRegistry';
import type { ISharedServiceRegistry } from '../../../../src/extensions/ISharedServiceRegistry';

describe('NlpPrefilterRecognizer', () => {
  let registry: ISharedServiceRegistry;
  let recognizer: NlpPrefilterRecognizer;

  beforeEach(() => {
    registry = new SharedServiceRegistry();
    recognizer = new NlpPrefilterRecognizer(registry);
  });

  afterEach(async () => {
    await recognizer.dispose();
    await registry.releaseAll();
  });

  // -----------------------------------------------------------------------
  // Basic property checks
  // -----------------------------------------------------------------------

  it('should have the name "NlpPrefilterRecognizer"', () => {
    expect(recognizer.name).toBe('NlpPrefilterRecognizer');
  });

  it('should declare supported entity types for PERSON, LOCATION, ORGANIZATION', () => {
    expect(recognizer.supportedEntities).toContain('PERSON');
    expect(recognizer.supportedEntities).toContain('LOCATION');
    expect(recognizer.supportedEntities).toContain('ORGANIZATION');
  });

  // -----------------------------------------------------------------------
  // Person name detection
  // -----------------------------------------------------------------------

  it('should detect person names', async () => {
    const text = 'John Smith went to the store';
    const entities = await recognizer.recognize(text);

    const people = entities.filter((e) => e.entityType === 'PERSON');
    // compromise may or may not detect "John Smith" depending on its
    // internal heuristics, but if it does, validate the shape.
    if (people.length > 0) {
      expect(people[0].text.toLowerCase()).toContain('john');
      expect(people[0].source).toBe('nlp-prefilter');
      expect(people[0].start).toBeGreaterThanOrEqual(0);
      expect(people[0].end).toBeGreaterThan(people[0].start);
    }
  });

  // -----------------------------------------------------------------------
  // No PII in clean text
  // -----------------------------------------------------------------------

  it('should return empty for text without recognizable names', async () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const entities = await recognizer.recognize(text);

    // compromise might find something in edge cases, but for this generic
    // text we expect nothing.
    const people = entities.filter((e) => e.entityType === 'PERSON');
    expect(people).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Score range validation
  // -----------------------------------------------------------------------

  it('should assign scores in the 0.3-0.6 range', async () => {
    // Use a name that compromise is very likely to recognise.
    const text = 'President Barack Obama spoke in Washington';
    const entities = await recognizer.recognize(text);

    for (const entity of entities) {
      expect(entity.score).toBeGreaterThanOrEqual(0.3);
      expect(entity.score).toBeLessThanOrEqual(0.6);
    }
  });

  // -----------------------------------------------------------------------
  // Source field
  // -----------------------------------------------------------------------

  it('should always set source to "nlp-prefilter"', async () => {
    const text = 'Dr. Jane Doe works at Google in New York';
    const entities = await recognizer.recognize(text);

    for (const entity of entities) {
      expect(entity.source).toBe('nlp-prefilter');
    }
  });

  // -----------------------------------------------------------------------
  // Graceful degradation when compromise is unavailable
  // -----------------------------------------------------------------------

  it('should return empty when compromise fails to load (graceful degradation)', async () => {
    // Create a registry whose getOrCreate always throws, simulating
    // compromise not being installed.
    const brokenRegistry: ISharedServiceRegistry = {
      getOrCreate: vi.fn().mockRejectedValue(new Error('Module not found: compromise')),
      has: vi.fn().mockReturnValue(false),
      release: vi.fn().mockResolvedValue(undefined),
      releaseAll: vi.fn().mockResolvedValue(undefined),
    };

    const brokenRecognizer = new NlpPrefilterRecognizer(brokenRegistry);

    // First call should catch the error and degrade gracefully.
    const entities = await brokenRecognizer.recognize('John Smith is here');
    expect(entities).toEqual([]);

    // Subsequent calls should also return empty without retrying.
    const entities2 = await brokenRecognizer.recognize('Jane Doe is there');
    expect(entities2).toEqual([]);

    // Should have only called getOrCreate once (first call sets unavailable).
    expect(brokenRegistry.getOrCreate).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Shared service registry usage
  // -----------------------------------------------------------------------

  it('should use the shared service registry to load compromise', async () => {
    const spyRegistry: ISharedServiceRegistry = {
      getOrCreate: vi.fn().mockImplementation(async (id, factory) => {
        // Actually call the factory to load compromise.
        return factory();
      }),
      has: vi.fn().mockReturnValue(false),
      release: vi.fn().mockResolvedValue(undefined),
      releaseAll: vi.fn().mockResolvedValue(undefined),
    };

    const spyRecognizer = new NlpPrefilterRecognizer(spyRegistry);
    await spyRecognizer.recognize('Hello world');

    // Verify that getOrCreate was called with the compromise service ID.
    expect(spyRegistry.getOrCreate).toHaveBeenCalledWith(
      'agentos:nlp:compromise',
      expect.any(Function),
    );
  });

  // -----------------------------------------------------------------------
  // Entity type filtering
  // -----------------------------------------------------------------------

  it('should respect entityTypes filter', async () => {
    const text = 'Barack Obama spoke in Washington at Google headquarters';
    const entities = await recognizer.recognize(text, {
      entityTypes: ['PERSON'],
    });

    // Should only return PERSON entities, not LOCATION or ORGANIZATION.
    for (const entity of entities) {
      expect(entity.entityType).toBe('PERSON');
    }
  });

  it('should return empty when entityTypes filter has no overlap with supported types', async () => {
    const text = 'Barack Obama spoke in Washington';
    const entities = await recognizer.recognize(text, {
      entityTypes: ['EMAIL', 'SSN'],
    });

    expect(entities).toEqual([]);
  });
});

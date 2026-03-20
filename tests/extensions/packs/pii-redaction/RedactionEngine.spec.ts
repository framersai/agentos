/**
 * @file RedactionEngine.spec.ts
 * @description Unit tests for the {@link redactText} function.
 *
 * Tests verify all four redaction styles (placeholder, mask, hash,
 * category-tag), correctness of offset-based replacement, handling of
 * multiple entities, empty entity arrays, and hash determinism.
 *
 * No external dependencies are mocked — the tests exercise the real
 * implementation end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { redactText } from '../../../../src/extensions/packs/pii-redaction/RedactionEngine';
import type { PiiEntity } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Sample input text and its corresponding PII entity spans, matching the
 * canonical test case described in the task specification.
 */
const SAMPLE_TEXT = 'Contact John Smith at john@example.com please';

/**
 * Two non-overlapping PII entities within {@link SAMPLE_TEXT}.
 *
 * Offsets verified manually:
 * - "John Smith" → indices 8–18  (SAMPLE_TEXT.slice(8, 18) === 'John Smith')
 * - "john@example.com" → indices 22–38 (SAMPLE_TEXT.slice(22, 38) === 'john@example.com')
 */
const SAMPLE_ENTITIES: PiiEntity[] = [
  {
    entityType: 'PERSON',
    text: 'John Smith',
    start: 8,
    end: 18,
    score: 0.95,
    source: 'ner-model',
  },
  {
    entityType: 'EMAIL',
    text: 'john@example.com',
    start: 22,
    end: 38,
    score: 1.0,
    source: 'regex',
  },
];

// ---------------------------------------------------------------------------
// placeholder style
// ---------------------------------------------------------------------------

describe('redactText — placeholder style', () => {
  it('replaces each entity with [TYPE] tokens', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'placeholder');
    expect(result).toBe('Contact [PERSON] at [EMAIL] please');
  });

  it('preserves all non-PII text verbatim', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'placeholder');
    // Leading and trailing non-PII text must be intact.
    expect(result.startsWith('Contact ')).toBe(true);
    expect(result.endsWith(' please')).toBe(true);
    // The connector " at " between the two entities must also be preserved.
    expect(result).toContain(' at ');
  });

  it('handles a single entity', () => {
    // "John Smith" in "Hello John Smith" starts at index 6, ends at 16.
    const entity: PiiEntity = {
      entityType: 'PERSON',
      text: 'John Smith',
      start: 6,
      end: 16,
      score: 0.95,
      source: 'ner-model',
    };
    const result = redactText('Hello John Smith', [entity], 'placeholder');
    // Only the PERSON span at offset 6–16 should be replaced.
    expect(result).toBe('Hello [PERSON]');
  });
});

// ---------------------------------------------------------------------------
// mask style
// ---------------------------------------------------------------------------

describe('redactText — mask style', () => {
  it('keeps the first character of each word and replaces the rest with *', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'mask');
    // "John Smith" → "J*** S****"
    expect(result).toContain('J***');
    expect(result).toContain('S****');
  });

  it('does NOT contain the original PII text', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'mask');
    expect(result).not.toContain('John Smith');
    expect(result).not.toContain('john@example.com');
  });

  it('preserves non-PII text', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'mask');
    expect(result.startsWith('Contact ')).toBe(true);
    expect(result.endsWith(' please')).toBe(true);
  });

  it('handles single-character words without producing extra *', () => {
    const entity: PiiEntity = {
      entityType: 'PERSON',
      text: 'A B',
      start: 0,
      end: 3,
      score: 1.0,
      source: 'ner-model',
    };

    const result = redactText('A B', [entity], 'mask');
    // Single-char words → no stars appended; the space is preserved.
    expect(result).toBe('A B');
  });
});

// ---------------------------------------------------------------------------
// hash style
// ---------------------------------------------------------------------------

describe('redactText — hash style', () => {
  it('replaces entities with [TYPE:xxxxxxxxxx] tokens (10 hex chars)', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'hash');
    // Each replacement must match the pattern [TYPE:<10 hex chars>].
    expect(result).toMatch(/\[PERSON:[a-f0-9]{10}\]/);
    expect(result).toMatch(/\[EMAIL:[a-f0-9]{10}\]/);
  });

  it('is deterministic — same input always produces the same hash', () => {
    const result1 = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'hash');
    const result2 = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'hash');
    expect(result1).toBe(result2);
  });

  it('produces different hashes for different input texts', () => {
    const entityA: PiiEntity = {
      entityType: 'PERSON',
      text: 'Alice',
      start: 0,
      end: 5,
      score: 0.9,
      source: 'ner-model',
    };
    const entityB: PiiEntity = {
      entityType: 'PERSON',
      text: 'Bob',
      start: 0,
      end: 3,
      score: 0.9,
      source: 'ner-model',
    };

    const resultA = redactText('Alice', [entityA], 'hash');
    const resultB = redactText('Bob', [entityB], 'hash');

    // Different texts → different hashes.
    expect(resultA).not.toBe(resultB);
  });

  it('preserves non-PII text', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'hash');
    expect(result.startsWith('Contact ')).toBe(true);
    expect(result.endsWith(' please')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// category-tag style
// ---------------------------------------------------------------------------

describe('redactText — category-tag style', () => {
  it('wraps each entity in an XML PII tag', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'category-tag');
    expect(result).toContain('<PII type="PERSON">REDACTED</PII>');
    expect(result).toContain('<PII type="EMAIL">REDACTED</PII>');
  });

  it('does NOT contain original PII text', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'category-tag');
    expect(result).not.toContain('John Smith');
    expect(result).not.toContain('john@example.com');
  });

  it('preserves non-PII text', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'category-tag');
    expect(result.startsWith('Contact ')).toBe(true);
    expect(result.endsWith(' please')).toBe(true);
    expect(result).toContain(' at ');
  });

  it('produces a well-formed XML-like structure', () => {
    const result = redactText(SAMPLE_TEXT, SAMPLE_ENTITIES, 'category-tag');
    // The full expected string for the PERSON entity.
    expect(result).toContain('<PII type="PERSON">REDACTED</PII>');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('redactText — edge cases', () => {
  it('returns the original text unchanged when entities array is empty', () => {
    const result = redactText(SAMPLE_TEXT, [], 'placeholder');
    expect(result).toBe(SAMPLE_TEXT);
  });

  it('handles an entity at position 0 (start of string)', () => {
    const entity: PiiEntity = {
      entityType: 'PERSON',
      text: 'Contact',
      start: 0,
      end: 7,
      score: 0.8,
      source: 'ner-model',
    };

    const result = redactText('Contact John', [entity], 'placeholder');
    expect(result).toBe('[PERSON] John');
  });

  it('handles an entity at the very end of the string', () => {
    const entity: PiiEntity = {
      entityType: 'PERSON',
      text: 'John',
      start: 8,
      end: 12,
      score: 0.9,
      source: 'ner-model',
    };

    const result = redactText('Contact John', [entity], 'placeholder');
    expect(result).toBe('Contact [PERSON]');
  });

  it('handles an entity that spans the entire string', () => {
    const text = 'John Smith';
    const entity: PiiEntity = {
      entityType: 'PERSON',
      text,
      start: 0,
      end: text.length,
      score: 0.95,
      source: 'ner-model',
    };

    const result = redactText(text, [entity], 'placeholder');
    expect(result).toBe('[PERSON]');
  });

  it('handles an empty input string with an empty entities array', () => {
    const result = redactText('', [], 'placeholder');
    expect(result).toBe('');
  });

  it('processes multiple entities in reverse order (offset stability)', () => {
    // Three entities — processed right-to-left to avoid index invalidation.
    const text = 'Alice called Bob and said hi to Charlie';
    // Verify offsets: Alice=0-5, Bob=13-16, Charlie=32-39.
    // text.slice(0,5)  === 'Alice'
    // text.slice(13,16) === 'Bob'
    // text.slice(32,39) === 'Charlie'
    const entities: PiiEntity[] = [
      // Intentionally provided out of offset order to test internal sorting.
      { entityType: 'PERSON', text: 'Charlie', start: 32, end: 39, score: 0.9, source: 'ner-model' },
      { entityType: 'PERSON', text: 'Alice', start: 0, end: 5, score: 0.9, source: 'ner-model' },
      { entityType: 'PERSON', text: 'Bob', start: 13, end: 16, score: 0.9, source: 'ner-model' },
    ];

    const result = redactText(text, entities, 'placeholder');
    expect(result).toBe('[PERSON] called [PERSON] and said hi to [PERSON]');
  });

  it('handles an entity with a single-character span', () => {
    // In 'test X value', 'X' is at index 5 (t=0,e=1,s=2,t=3, =4,X=5).
    const entity: PiiEntity = {
      entityType: 'UNKNOWN_PII',
      text: 'X',
      start: 5,
      end: 6,
      score: 1.0,
      source: 'regex',
    };

    const placeholder = redactText('test X value', [entity], 'placeholder');
    expect(placeholder).toBe('test [UNKNOWN_PII] value');

    const masked = redactText('test X value', [entity], 'mask');
    // Single char — mask keeps first char (and has nothing else to star out).
    expect(masked).toBe('test X value');
  });
});

/**
 * @file EntityMerger.spec.ts
 * @description Unit tests for the {@link mergeEntities} function.
 *
 * Tests cover every merge rule in the documented processing pipeline:
 * denylist boosting, allowlist filtering, overlap resolution (exact, subset,
 * partial, adjacent), confidence threshold filtering, and output sort order.
 *
 * All tests use concrete {@link PiiEntity} fixtures rather than mocks so that
 * the behaviour of the function itself — not a test double — is verified.
 */

import { describe, it, expect } from 'vitest';
import { mergeEntities } from '../../../../src/extensions/packs/pii-redaction/EntityMerger';
import type { PiiEntity } from '../../../../src/extensions/packs/pii-redaction/types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid {@link PiiEntity} with sensible defaults so that
 * individual tests only need to specify the fields relevant to them.
 */
function makeEntity(
  overrides: Partial<PiiEntity> & { start: number; end: number; text: string },
): PiiEntity {
  return {
    entityType: 'PERSON',
    score: 0.9,
    source: 'ner-model',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exact / subset overlap de-duplication
// ---------------------------------------------------------------------------

describe('mergeEntities — exact and subset overlaps', () => {
  it('deduplicates exact overlaps by keeping the entity with the highest score', () => {
    // Two entities with identical start/end but different scores.
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John Smith', start: 0, end: 10, score: 0.7 }),
      makeEntity({ text: 'John Smith', start: 0, end: 10, score: 0.95 }),
    ];

    const result = mergeEntities(entities, {});

    // Only one entity should remain.
    expect(result).toHaveLength(1);
    // It must be the higher-scoring one.
    expect(result[0].score).toBe(0.95);
    expect(result[0].text).toBe('John Smith');
  });

  it('keeps the wider span when a shorter span is a subset and both have equal score', () => {
    // "John Smith" contains "John" — the wider span should win.
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John Smith', start: 0, end: 10, score: 0.9 }),
      makeEntity({ text: 'John', start: 0, end: 4, score: 0.9 }),
    ];

    const result = mergeEntities(entities, {});

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('John Smith');
  });

  it('replaces a wider span with a subset span when the subset has a strictly higher score', () => {
    // Rarely happens in practice but the rule should be honoured.
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John Smith', start: 0, end: 10, score: 0.6 }),
      makeEntity({ text: 'John', start: 0, end: 4, score: 0.99 }),
    ];

    const result = mergeEntities(entities, {});

    // The shorter span wins because it has a higher confidence.
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// Partial overlap — longer span preference
// ---------------------------------------------------------------------------

describe('mergeEntities — partial overlaps', () => {
  it('prefers the longer span for partial overlaps when score >= last', () => {
    // "John Sm" overlaps with "n Smith" — neither is a subset of the other.
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John Sm', start: 0, end: 7, score: 0.8 }),
      makeEntity({ text: 'n Smith', start: 3, end: 10, score: 0.8 }),
    ];

    // "n Smith" (length 7) == "John Sm" (length 7) — same length; last wins.
    // Use a longer replacement to trigger the "current is longer" branch.
    const longer: PiiEntity[] = [
      makeEntity({ text: 'John Sm', start: 0, end: 7, score: 0.8 }),
      makeEntity({ text: 'n Smith!', start: 3, end: 11, score: 0.8 }),
    ];

    const result = mergeEntities(longer, {});

    expect(result).toHaveLength(1);
    // Current is longer (8 chars vs 7) with equal score — replaces last.
    expect(result[0].text).toBe('n Smith!');
  });

  it('keeps the earlier span when the later partial-overlap has a lower score', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John Smith Jr', start: 0, end: 13, score: 0.95 }),
      makeEntity({ text: 'Smith Junior', start: 5, end: 17, score: 0.5 }),
    ];

    const result = mergeEntities(entities, {});

    // Later span is longer but has a lower score — keep the earlier one.
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('John Smith Jr');
    expect(result[0].score).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// Adjacent span merging
// ---------------------------------------------------------------------------

describe('mergeEntities — adjacent span merging', () => {
  it('merges adjacent same-type spans separated by ≤ 2 gap characters', () => {
    // "O'" and "Brien" are two PERSON spans separated by a 0-char gap (end 2, start 2).
    // Gap = 0 → should merge.
    const sourceText = "O'Brien";
    const entities: PiiEntity[] = [
      makeEntity({ text: "O'", start: 0, end: 2, score: 0.8 }),
      makeEntity({ text: 'Brien', start: 2, end: 7, score: 0.85 }),
    ];

    const result = mergeEntities(entities, {}, sourceText);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("O'Brien");
    // Merged score is max of the two.
    expect(result[0].score).toBe(0.85);
  });

  it('merges adjacent same-type spans with a 1-character gap', () => {
    // "John" and "Smith" separated by a single space.
    const sourceText = 'John Smith';
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John', start: 0, end: 4, score: 0.8 }),
      makeEntity({ text: 'Smith', start: 5, end: 10, score: 0.9 }),
    ];

    const result = mergeEntities(entities, {}, sourceText);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('John Smith');
    expect(result[0].score).toBe(0.9);
  });

  it('does NOT merge adjacent spans of different entity types', () => {
    const sourceText = 'John@example.com';
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John', start: 0, end: 4, score: 0.9, entityType: 'PERSON' }),
      makeEntity({ text: '@example.com', start: 4, end: 16, score: 0.95, entityType: 'EMAIL' }),
    ];

    const result = mergeEntities(entities, {}, sourceText);

    // Different types — should remain separate.
    expect(result).toHaveLength(2);
  });

  it('does NOT merge spans with a gap > 2 characters', () => {
    const sourceText = 'John   Smith'; // 3-space gap
    const entities: PiiEntity[] = [
      makeEntity({ text: 'John', start: 0, end: 4, score: 0.9 }),
      makeEntity({ text: 'Smith', start: 7, end: 12, score: 0.9 }),
    ];

    const result = mergeEntities(entities, {}, sourceText);

    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Allowlist filtering
// ---------------------------------------------------------------------------

describe('mergeEntities — allowlist filtering', () => {
  it('removes entities whose text is in the allowlist (case-insensitive)', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'support@example.com', start: 0, end: 19, entityType: 'EMAIL', score: 1.0 }),
      makeEntity({ text: 'Jane Doe', start: 25, end: 33, entityType: 'PERSON', score: 0.9 }),
    ];

    // Allowlist entry uses different casing — must still match.
    const result = mergeEntities(entities, { allowlist: ['Support@Example.COM'] });

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Jane Doe');
  });

  it('removes multiple entities matching different allowlist entries', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'alice@example.com', start: 0, end: 17, entityType: 'EMAIL', score: 1.0 }),
      makeEntity({ text: 'bob@example.com', start: 20, end: 35, entityType: 'EMAIL', score: 1.0 }),
      makeEntity({ text: 'Eve', start: 40, end: 43, entityType: 'PERSON', score: 0.85 }),
    ];

    const result = mergeEntities(entities, {
      allowlist: ['alice@example.com', 'BOB@EXAMPLE.COM'],
    });

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Eve');
  });

  it('returns all entities when allowlist is empty', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Alice', start: 0, end: 5 }),
      makeEntity({ text: 'Bob', start: 10, end: 13 }),
    ];

    const result = mergeEntities(entities, { allowlist: [] });

    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Denylist boosting
// ---------------------------------------------------------------------------

describe('mergeEntities — denylist boosting', () => {
  it('boosts the score of denylist entries to exactly 1.0', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'PROJ-SECRET', start: 0, end: 11, score: 0.4 }),
    ];

    const result = mergeEntities(entities, { denylist: ['proj-secret'] });

    expect(result).toHaveLength(1);
    // Score must be boosted to 1.0 regardless of original value.
    expect(result[0].score).toBe(1.0);
  });

  it('matches denylist entries case-insensitively', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'MySecret', start: 5, end: 13, score: 0.3 }),
    ];

    const result = mergeEntities(entities, { denylist: ['MYSECRET'] });

    expect(result[0].score).toBe(1.0);
  });

  it('allows a denylist-boosted entity to survive a high confidenceThreshold', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'classified-id-42', start: 0, end: 16, score: 0.2 }),
    ];

    // Threshold 0.9 would normally filter out score=0.2, but denylist boosts
    // it to 1.0 first.
    const result = mergeEntities(entities, {
      denylist: ['classified-id-42'],
      confidenceThreshold: 0.9,
    });

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Confidence threshold filtering
// ---------------------------------------------------------------------------

describe('mergeEntities — confidence threshold', () => {
  it('filters out entities below the confidence threshold', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Alice', start: 0, end: 5, score: 0.9 }),
      makeEntity({ text: 'Bob', start: 10, end: 13, score: 0.4 }),
      makeEntity({ text: 'Charlie', start: 20, end: 27, score: 0.6 }),
    ];

    const result = mergeEntities(entities, { confidenceThreshold: 0.6 });

    expect(result).toHaveLength(2);
    const texts = result.map((e) => e.text);
    expect(texts).toContain('Alice');
    expect(texts).toContain('Charlie');
    expect(texts).not.toContain('Bob');
  });

  it('keeps entities at exactly the threshold score (inclusive boundary)', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Alice', start: 0, end: 5, score: 0.5 }),
    ];

    const result = mergeEntities(entities, { confidenceThreshold: 0.5 });

    // score === threshold → should be kept (inclusive).
    expect(result).toHaveLength(1);
  });

  it('removes all entities when all are below the threshold', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Alice', start: 0, end: 5, score: 0.3 }),
      makeEntity({ text: 'Bob', start: 10, end: 13, score: 0.1 }),
    ];

    const result = mergeEntities(entities, { confidenceThreshold: 0.8 });

    expect(result).toHaveLength(0);
  });

  it('applies no threshold filtering when confidenceThreshold is omitted', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Alice', start: 0, end: 5, score: 0.01 }),
    ];

    const result = mergeEntities(entities, {});

    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Output sort order
// ---------------------------------------------------------------------------

describe('mergeEntities — output sort order', () => {
  it('sorts the output by start offset in ascending order', () => {
    // Provide entities in reverse order to verify sorting is applied.
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Charlie', start: 30, end: 37 }),
      makeEntity({ text: 'Alice', start: 0, end: 5 }),
      makeEntity({ text: 'Bob', start: 15, end: 18 }),
    ];

    const result = mergeEntities(entities, {});

    expect(result[0].text).toBe('Alice');
    expect(result[1].text).toBe('Bob');
    expect(result[2].text).toBe('Charlie');
  });

  it('returns an empty array when given an empty input', () => {
    expect(mergeEntities([], {})).toEqual([]);
  });

  it('returns a single-element array unchanged (except cloned)', () => {
    const entities: PiiEntity[] = [
      makeEntity({ text: 'Alice', start: 0, end: 5, score: 0.9 }),
    ];

    const result = mergeEntities(entities, {});

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Alice');
  });
});

// ---------------------------------------------------------------------------
// Combined scenarios
// ---------------------------------------------------------------------------

describe('mergeEntities — combined option scenarios', () => {
  it('applies denylist boost before allowlist filter (denylist takes precedence)', () => {
    // An entity appears in BOTH denylist and allowlist.  Denylist is applied
    // first (boost to 1.0), then allowlist is checked.  The spec states
    // denylist boost happens before allowlist filter in Step 1→2 order, but
    // since they are mutually exclusive branches the allowlist will still
    // remove an entry that was also denylisted if the implementation checks
    // denylist first via `continue`.
    //
    // The contract: denylist entries are processed in Step 1 via `continue`,
    // so they bypass the allowlist check in Step 2.  Result: the entity
    // survives with score=1.0.
    const entities: PiiEntity[] = [
      makeEntity({ text: 'sensitive-word', start: 0, end: 14, score: 0.3 }),
    ];

    const result = mergeEntities(entities, {
      denylist: ['sensitive-word'],
      allowlist: ['sensitive-word'],
    });

    // Denylist was processed first (Step 1 `continue`) — entity survives.
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1.0);
  });

  it('handles a mix of filtering, boosting, overlap resolution, and sorting correctly', () => {
    const sourceText = 'Alice and Bob Smith met mallory';
    const entities: PiiEntity[] = [
      // Should be removed by allowlist.
      makeEntity({ text: 'Alice', start: 0, end: 5, entityType: 'PERSON', score: 0.9 }),
      // "Bob" and "Smith" are adjacent PERSON spans — should merge to "Bob Smith".
      makeEntity({ text: 'Bob', start: 10, end: 13, entityType: 'PERSON', score: 0.75 }),
      makeEntity({ text: 'Smith', start: 14, end: 19, entityType: 'PERSON', score: 0.8 }),
      // Should be boosted by denylist.
      makeEntity({ text: 'mallory', start: 24, end: 31, entityType: 'PERSON', score: 0.1 }),
    ];

    const result = mergeEntities(entities, {
      allowlist: ['alice'],
      denylist: ['mallory'],
      confidenceThreshold: 0.7,
    }, sourceText);

    // Alice removed, Bob+Smith merged to "Bob Smith" (score 0.8), mallory boosted to 1.0.
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Bob Smith');
    expect(result[0].score).toBe(0.8);
    expect(result[1].text).toBe('mallory');
    expect(result[1].score).toBe(1.0);
  });
});

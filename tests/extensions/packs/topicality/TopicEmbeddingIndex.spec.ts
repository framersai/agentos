/**
 * @fileoverview Unit tests for TopicEmbeddingIndex.
 *
 * All tests use a deterministic mock embeddingFn that returns fixed
 * pre-defined vectors, eliminating network calls and making assertions exact.
 *
 * Coverage:
 *  - isBuilt transitions (false → true)
 *  - match returns results sorted descending by similarity
 *  - matchByVector does not invoke embeddingFn again after build
 *  - isOnTopic respects threshold comparisons
 *  - build with empty topics array
 *  - similarity values are clamped to [0, 1] (no negatives)
 *  - centroid averaging across description + examples
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicEmbeddingIndex } from '../../../../src/extensions/packs/topicality/TopicEmbeddingIndex';
import type { TopicDescriptor } from '../../../../src/extensions/packs/topicality/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal two-topic fixture with controlled, non-degenerate embeddings.
 *
 * Topic A ("sports") centroid ≈ average of [1,0,0] and [0.9,0.1,0] = [0.95, 0.05, 0]
 * Topic B ("cooking") centroid ≈ average of [0,1,0] and [0.1,0.9,0] = [0.05, 0.95, 0]
 */
const TOPIC_A: TopicDescriptor = {
  id: 'sports',
  name: 'Sports',
  description: 'Sports and athletics discussion.',
  examples: ['football game results', 'basketball scores'],
};

const TOPIC_B: TopicDescriptor = {
  id: 'cooking',
  name: 'Cooking',
  description: 'Food and cooking discussion.',
  examples: ['recipe for pasta', 'how to bake bread'],
};

/**
 * Embedding map used by the mock function.
 *
 * Key: text string.
 * Value: 3-dimensional vector.
 *
 * Topic A texts are aligned with [1, 0, 0].
 * Topic B texts are aligned with [0, 1, 0].
 * Query vectors for assertions are also defined here.
 */
const EMBED_MAP: Record<string, number[]> = {
  // Topic A (sports) — description + 2 examples
  'Sports and athletics discussion.': [1, 0, 0],
  'football game results': [0.9, 0.1, 0],
  'basketball scores': [0.95, 0.05, 0],

  // Topic B (cooking) — description + 2 examples
  'Food and cooking discussion.': [0, 1, 0],
  'recipe for pasta': [0.1, 0.9, 0],
  'how to bake bread': [0.05, 0.95, 0],

  // Query texts used in tests
  'Who won the game last night?': [0.92, 0.08, 0], // close to sports
  'How do I make carbonara?': [0.05, 0.95, 0],     // close to cooking
  'Unrelated topic XYZ': [0, 0, 1],                // orthogonal to both
};

/**
 * Deterministic mock embedding function.
 * Returns fixed vectors from EMBED_MAP; throws for unknown text so tests fail
 * loudly if an unexpected string is embedded.
 */
function makeMockEmbeddingFn() {
  return vi.fn(async (texts: string[]): Promise<number[][]> => {
    return texts.map((t) => {
      const vec = EMBED_MAP[t];
      if (!vec) throw new Error(`Mock embeddingFn: unknown text "${t}"`);
      return vec;
    });
  });
}

// ---------------------------------------------------------------------------
// isBuilt — transitions
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex.isBuilt', () => {
  it('is false before build() is called', () => {
    const index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    expect(index.isBuilt).toBe(false);
  });

  it('is true after build() completes with topics', async () => {
    const index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([TOPIC_A, TOPIC_B]);
    expect(index.isBuilt).toBe(true);
  });

  it('is true after build() completes with an empty topic array', async () => {
    const index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([]);
    expect(index.isBuilt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// build — batch embedding call count
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex.build', () => {
  it('calls embeddingFn exactly once with all texts batched', async () => {
    const fn = makeMockEmbeddingFn();
    const index = new TopicEmbeddingIndex(fn);
    await index.build([TOPIC_A, TOPIC_B]);

    // Only one call regardless of the number of topics.
    expect(fn).toHaveBeenCalledTimes(1);

    // The batch must contain description + all examples for every topic.
    const calledWith: string[] = fn.mock.calls[0][0];
    expect(calledWith).toContain(TOPIC_A.description);
    expect(calledWith).toContain(TOPIC_A.examples[0]);
    expect(calledWith).toContain(TOPIC_A.examples[1]);
    expect(calledWith).toContain(TOPIC_B.description);
    expect(calledWith).toContain(TOPIC_B.examples[0]);
    expect(calledWith).toContain(TOPIC_B.examples[1]);
  });

  it('returns empty match list when built with no topics', async () => {
    const index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([]);
    const matches = index.matchByVector([1, 0, 0]);
    expect(matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// match — results are sorted descending
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex.match', () => {
  let index: TopicEmbeddingIndex;
  let fn: ReturnType<typeof makeMockEmbeddingFn>;

  beforeEach(async () => {
    fn = makeMockEmbeddingFn();
    index = new TopicEmbeddingIndex(fn);
    await index.build([TOPIC_A, TOPIC_B]);
    // Reset call count so match() calls can be counted independently.
    fn.mockClear();
  });

  it('returns matches sorted descending by similarity', async () => {
    // A sports-like query should rank TOPIC_A first.
    const matches = await index.match('Who won the game last night?');
    expect(matches.length).toBe(2);
    // First result must have the highest similarity.
    expect(matches[0].topicId).toBe('sports');
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
  });

  it('returns the correct topicName in each match', async () => {
    const matches = await index.match('Who won the game last night?');
    const sportsMatch = matches.find((m) => m.topicId === 'sports');
    expect(sportsMatch?.topicName).toBe('Sports');
  });

  it('calls embeddingFn once for the query text', async () => {
    await index.match('Who won the game last night?');
    // One call for the single query text.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// matchByVector — no extra embedding calls
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex.matchByVector', () => {
  it('does not call embeddingFn after build is complete', async () => {
    const fn = makeMockEmbeddingFn();
    const index = new TopicEmbeddingIndex(fn);
    await index.build([TOPIC_A, TOPIC_B]);

    // Reset after build to isolate matchByVector behaviour.
    fn.mockClear();

    // A pre-computed sports-like vector.
    index.matchByVector([1, 0, 0]);

    expect(fn).not.toHaveBeenCalled();
  });

  it('returns matches sorted descending for a sports-aligned vector', async () => {
    const index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([TOPIC_A, TOPIC_B]);

    const matches = index.matchByVector([1, 0, 0]);
    expect(matches[0].topicId).toBe('sports');
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
  });

  it('returns matches sorted descending for a cooking-aligned vector', async () => {
    const index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([TOPIC_A, TOPIC_B]);

    const matches = index.matchByVector([0, 1, 0]);
    expect(matches[0].topicId).toBe('cooking');
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
  });
});

// ---------------------------------------------------------------------------
// isOnTopic — threshold comparison
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex.isOnTopic', () => {
  let index: TopicEmbeddingIndex;

  beforeEach(async () => {
    index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([TOPIC_A, TOPIC_B]);
  });

  it('returns true when best similarity exceeds threshold', async () => {
    // Sports-like text should score well above 0.35 against TOPIC_A.
    const result = await index.isOnTopic('Who won the game last night?', 0.35);
    expect(result).toBe(true);
  });

  it('returns false when best similarity is below a strict threshold', async () => {
    // Completely unrelated text maps to [0,0,1], orthogonal to both topics.
    const result = await index.isOnTopic('Unrelated topic XYZ', 0.35);
    expect(result).toBe(false);
  });

  it('returns false when threshold is 1.0 (impossible to exceed)', async () => {
    // Nothing short of an exact centroid match can exceed similarity = 1.0.
    const result = await index.isOnTopic('Who won the game last night?', 1.0);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isOnTopicByVector — threshold comparison without embedding
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex.isOnTopicByVector', () => {
  let index: TopicEmbeddingIndex;

  beforeEach(async () => {
    index = new TopicEmbeddingIndex(makeMockEmbeddingFn());
    await index.build([TOPIC_A, TOPIC_B]);
  });

  it('returns true for a vector well-aligned with a topic centroid', () => {
    // [1, 0, 0] is the sports description embedding — very high similarity.
    expect(index.isOnTopicByVector([1, 0, 0], 0.35)).toBe(true);
  });

  it('returns false for an orthogonal vector', () => {
    // [0, 0, 1] is orthogonal to both topic centroids → similarity = 0.
    expect(index.isOnTopicByVector([0, 0, 1], 0.35)).toBe(false);
  });

  it('respects an exact threshold boundary (similarity must be strictly greater)', () => {
    // Directly use a cooking vector — find the exact similarity first.
    const matches = index.matchByVector([0, 1, 0]);
    const bestSim = matches[0].similarity;
    // Threshold equal to bestSim → NOT on-topic (must be strictly greater).
    expect(index.isOnTopicByVector([0, 1, 0], bestSim)).toBe(false);
    // Threshold just below bestSim → on-topic.
    expect(index.isOnTopicByVector([0, 1, 0], bestSim - 0.001)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Similarity clamping — no negative values
// ---------------------------------------------------------------------------

describe('TopicEmbeddingIndex similarity clamping', () => {
  it('clamps negative cosine similarities to 0', async () => {
    // Use a custom embed map where the query points opposite to a topic.
    const customMap: Record<string, number[]> = {
      'Topic description.': [1, 0, 0],
      'example one': [1, 0, 0],
      'opposite query': [-1, 0, 0], // exact opposite → raw cosine = -1
    };
    const fn = vi.fn(async (texts: string[]) => texts.map((t) => customMap[t]));

    const topic: TopicDescriptor = {
      id: 'topic',
      name: 'Topic',
      description: 'Topic description.',
      examples: ['example one'],
    };

    const index = new TopicEmbeddingIndex(fn);
    await index.build([topic]);

    // Directly test matchByVector with an opposite vector.
    const matches = index.matchByVector([-1, 0, 0]);
    // Raw cosine would be -1; clamped to 0.
    expect(matches[0].similarity).toBe(0);
  });
});

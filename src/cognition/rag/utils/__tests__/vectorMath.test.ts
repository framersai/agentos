import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  dotProduct,
  euclideanDistance,
  embeddingToBlob,
  blobToEmbedding,
  blobToFloat32,
  isLegacyJsonBlob,
} from '../vectorMath.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 1 for parallel non-unit vectors', () => {
    expect(cosineSimilarity([2, 4], [1, 2])).toBeCloseTo(1.0);
  });

  it('returns 0 for empty arrays', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 0])).toBe(0);
  });

  it('works with Float32Array', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0.9, 0.1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.9);
  });
});

describe('dotProduct', () => {
  it('computes correct dot product', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 4+10+18
  });

  it('returns 0 for orthogonal unit vectors', () => {
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 for empty arrays', () => {
    expect(dotProduct([], [])).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(dotProduct([1], [1, 2])).toBe(0);
  });
});

describe('euclideanDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('computes correct L2 distance', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBeCloseTo(5); // 3-4-5 triangle
  });

  it('returns 0 for empty arrays', () => {
    expect(euclideanDistance([], [])).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(euclideanDistance([1], [1, 2])).toBe(0);
  });
});

describe('binary blob helpers', () => {
  it('round-trips embedding through blob', () => {
    const original = [0.1, 0.2, 0.3, 0.4];
    const blob = embeddingToBlob(original);
    const restored = blobToEmbedding(blob);
    // Float32 has limited precision
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('blobToFloat32 returns a Float32Array view', () => {
    const blob = embeddingToBlob([1.0, 2.0, 3.0]);
    const f32 = blobToFloat32(blob);
    expect(f32).toBeInstanceOf(Float32Array);
    expect(f32.length).toBe(3);
    expect(f32[0]).toBeCloseTo(1.0);
  });

  it('blob is ~50% smaller than JSON', () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => Math.random());
    const jsonSize = JSON.stringify(embedding).length;
    const blobSize = embeddingToBlob(embedding).length;
    expect(blobSize).toBeLessThan(jsonSize * 0.6);
  });

  it('detects legacy JSON blobs', () => {
    expect(isLegacyJsonBlob('[0.1,0.2,0.3]')).toBe(true);
    expect(isLegacyJsonBlob(Buffer.from('[0.1'))).toBe(true);
    expect(isLegacyJsonBlob(embeddingToBlob([0.1, 0.2]))).toBe(false);
  });

  it('cosineSimilarity works directly with blobToFloat32 output', () => {
    const a = embeddingToBlob([1, 0, 0, 0]);
    const b = embeddingToBlob([0.9, 0.1, 0, 0]);
    const sim = cosineSimilarity(blobToFloat32(a), blobToFloat32(b));
    expect(sim).toBeGreaterThan(0.9);
  });
});

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../IFaceEmbeddingService';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns 1.0 for parallel vectors with different magnitudes', () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 10);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it('returns 0 for zero vectors', () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(v, zero)).toBe(0);
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vector dimension mismatch');
  });

  it('produces > 0.9 for realistic similar 512-dim vectors', () => {
    // Simulate two face embeddings from the same identity with small noise
    const base = Array.from({ length: 512 }, () => Math.random() * 2 - 1);
    const noisy = base.map((v) => v + (Math.random() - 0.5) * 0.1);
    const sim = cosineSimilarity(base, noisy);
    expect(sim).toBeGreaterThan(0.9);
  });

  it('produces low similarity for random 512-dim vectors', () => {
    // Two independent random vectors should have low but nonzero similarity
    const a = Array.from({ length: 512 }, () => Math.random() * 2 - 1);
    const b = Array.from({ length: 512 }, () => Math.random() * 2 - 1);
    const sim = cosineSimilarity(a, b);
    // Random orthogonal-ish vectors: similarity should be close to 0
    expect(Math.abs(sim)).toBeLessThan(0.3);
  });

  it('handles single-element vectors', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0, 10);
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0, 10);
  });
});

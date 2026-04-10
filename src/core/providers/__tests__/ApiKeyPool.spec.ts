import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiKeyPool } from '../ApiKeyPool.js';

describe('ApiKeyPool', () => {
  describe('construction', () => {
    it('parses comma-separated string into keys', () => {
      const pool = new ApiKeyPool('sk_a,sk_b,sk_c');
      expect(pool.size).toBe(3);
      expect(pool.hasKeys).toBe(true);
    });

    it('accepts a single key string', () => {
      const pool = new ApiKeyPool('sk_a');
      expect(pool.size).toBe(1);
    });

    it('accepts an array of keys', () => {
      const pool = new ApiKeyPool(['sk_a', 'sk_b']);
      expect(pool.size).toBe(2);
    });

    it('trims whitespace from keys', () => {
      const pool = new ApiKeyPool(' sk_a , sk_b ');
      expect(pool.next()).toBe('sk_a');
    });

    it('filters empty segments', () => {
      const pool = new ApiKeyPool('sk_a,,sk_b,');
      expect(pool.size).toBe(2);
    });

    it('handles empty string', () => {
      const pool = new ApiKeyPool('');
      expect(pool.size).toBe(0);
      expect(pool.hasKeys).toBe(false);
    });
  });

  describe('round-robin', () => {
    it('single key always returns the same key', () => {
      const pool = new ApiKeyPool('sk_only');
      expect(pool.next()).toBe('sk_only');
      expect(pool.next()).toBe('sk_only');
      expect(pool.next()).toBe('sk_only');
    });

    it('rotates through keys in order', () => {
      const pool = new ApiKeyPool('sk_a,sk_b,sk_c', { primaryWeight: 1 });
      expect(pool.next()).toBe('sk_a');
      expect(pool.next()).toBe('sk_b');
      expect(pool.next()).toBe('sk_c');
      expect(pool.next()).toBe('sk_a');
    });

    it('gives first key higher weight with default primaryWeight=2', () => {
      const pool = new ApiKeyPool('sk_a,sk_b');
      const counts: Record<string, number> = { sk_a: 0, sk_b: 0 };
      for (let i = 0; i < 90; i++) counts[pool.next()]++;
      expect(counts.sk_a).toBeGreaterThan(counts.sk_b);
    });
  });

  describe('exhaustion', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('skips exhausted key', () => {
      const pool = new ApiKeyPool('sk_a,sk_b', { primaryWeight: 1 });
      pool.next(); // sk_a
      pool.markExhausted('sk_a');
      expect(pool.next()).toBe('sk_b');
      expect(pool.next()).toBe('sk_b');
    });

    it('re-includes key after cooldown expires', () => {
      const pool = new ApiKeyPool('sk_a,sk_b', { primaryWeight: 1, cooldownMs: 1000 });
      pool.next(); // sk_a
      pool.markExhausted('sk_a');
      expect(pool.next()).toBe('sk_b');

      vi.advanceTimersByTime(1001);
      const next3 = [pool.next(), pool.next()];
      expect(next3).toContain('sk_a');
    });

    it('returns least-exhausted key when all are exhausted', () => {
      const pool = new ApiKeyPool('sk_a,sk_b', { primaryWeight: 1, cooldownMs: 10_000 });
      pool.markExhausted('sk_a');
      vi.advanceTimersByTime(5000);
      pool.markExhausted('sk_b');
      expect(pool.next()).toBe('sk_a');
    });
  });

  describe('edge cases', () => {
    it('next() returns empty string for empty pool', () => {
      const pool = new ApiKeyPool('');
      expect(pool.next()).toBe('');
    });

    it('markExhausted on unknown key is a no-op', () => {
      const pool = new ApiKeyPool('sk_a');
      pool.markExhausted('sk_unknown');
      expect(pool.next()).toBe('sk_a');
    });
  });
});

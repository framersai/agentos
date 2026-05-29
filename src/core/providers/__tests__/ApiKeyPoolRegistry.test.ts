import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getKeyPool, resetAllPools } from '../ApiKeyPoolRegistry.js';

describe('ApiKeyPoolRegistry', () => {
  beforeEach(() => {
    resetAllPools();
    vi.unstubAllEnvs();
  });

  it('creates a pool from an env var', () => {
    vi.stubEnv('TEST_API_KEY', 'sk_a,sk_b');
    const pool = getKeyPool('TEST_API_KEY');
    expect(pool.size).toBe(2);
  });

  it('returns the same pool instance for the same env var', () => {
    vi.stubEnv('TEST_API_KEY', 'sk_a');
    const a = getKeyPool('TEST_API_KEY');
    const b = getKeyPool('TEST_API_KEY');
    expect(a).toBe(b);
  });

  it('returns different pools for different env vars', () => {
    vi.stubEnv('KEY_A', 'sk_a');
    vi.stubEnv('KEY_B', 'sk_b');
    expect(getKeyPool('KEY_A')).not.toBe(getKeyPool('KEY_B'));
  });

  it('shares exhaustion state across calls', () => {
    vi.stubEnv('TEST_API_KEY', 'sk_a,sk_b');
    const pool1 = getKeyPool('TEST_API_KEY');
    pool1.next(); // advance
    pool1.markExhausted('sk_a');

    const pool2 = getKeyPool('TEST_API_KEY');
    expect(pool2.next()).toBe('sk_b');
  });

  it('handles missing env var gracefully', () => {
    const pool = getKeyPool('NONEXISTENT_KEY');
    expect(pool.size).toBe(0);
    expect(pool.hasKeys).toBe(false);
  });
});

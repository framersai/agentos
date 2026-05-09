import { describe, expect, it, vi } from 'vitest';
import {
  resolveProviderChain,
  resolveProviderOrder,
  selectWeightedProvider,
} from '../ProviderPreferences.js';

// ---------------------------------------------------------------------------
// resolveProviderOrder
// ---------------------------------------------------------------------------

describe('resolveProviderOrder', () => {
  it('returns available unchanged when no preferences are provided', () => {
    const available = ['openai', 'stability', 'replicate'];
    const result = resolveProviderOrder(available);

    expect(result).toEqual(['openai', 'stability', 'replicate']);
  });

  it('reorders by preferred order', () => {
    const available = ['openai', 'stability', 'replicate'];
    const result = resolveProviderOrder(available, {
      preferred: ['replicate', 'openai'],
    });

    expect(result).toEqual(['replicate', 'openai']);
  });

  it('filters unavailable providers from the preferred list', () => {
    const available = ['openai', 'replicate'];
    const result = resolveProviderOrder(available, {
      preferred: ['stability', 'replicate', 'fal', 'openai'],
    });

    // stability and fal are not available — only replicate and openai survive.
    expect(result).toEqual(['replicate', 'openai']);
  });

  it('filters blocked providers', () => {
    const available = ['openai', 'stability', 'replicate'];
    const result = resolveProviderOrder(available, {
      blocked: ['stability'],
    });

    expect(result).toEqual(['openai', 'replicate']);
  });

  it('combines preferred and blocked (block wins)', () => {
    const available = ['openai', 'stability', 'replicate'];
    const result = resolveProviderOrder(available, {
      preferred: ['replicate', 'stability', 'openai'],
      blocked: ['stability'],
    });

    // stability is preferred but also blocked — block wins.
    expect(result).toEqual(['replicate', 'openai']);
  });

  it('returns an empty list when all providers are blocked', () => {
    const available = ['openai', 'stability'];
    const result = resolveProviderOrder(available, {
      blocked: ['openai', 'stability'],
    });

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectWeightedProvider
// ---------------------------------------------------------------------------

describe('selectWeightedProvider', () => {
  it('returns the first provider when no weights are provided', () => {
    const result = selectWeightedProvider(['alpha', 'beta', 'gamma']);

    expect(result).toBe('alpha');
  });

  it('returns the single element for a one-element list', () => {
    const result = selectWeightedProvider(['solo'], { solo: 5, other: 10 });

    expect(result).toBe('solo');
  });

  it('throws when the provider list is empty', () => {
    expect(() => selectWeightedProvider([])).toThrow(
      'Cannot select from an empty provider list',
    );
  });

  it('respects weights over many iterations (~90/10 split)', () => {
    // Seed Math.random so the test is deterministic-ish by running enough
    // iterations that the statistical distribution converges.
    const counts: Record<string, number> = { heavy: 0, light: 0 };
    const iterations = 10_000;

    for (let i = 0; i < iterations; i++) {
      const picked = selectWeightedProvider(['heavy', 'light'], {
        heavy: 9,
        light: 1,
      });
      counts[picked]++;
    }

    // With 9:1 weights, heavy should get ~90%. Allow a generous tolerance
    // band (80%-98%) to avoid flaky failures.
    const heavyRatio = counts.heavy / iterations;
    expect(heavyRatio).toBeGreaterThan(0.8);
    expect(heavyRatio).toBeLessThan(0.98);
  });

  it('defaults unlisted providers to weight 1', () => {
    // Two providers: listed gets weight 100, unlisted defaults to 1.
    // Over many iterations the listed provider should dominate.
    const counts: Record<string, number> = { listed: 0, unlisted: 0 };
    const iterations = 5_000;

    for (let i = 0; i < iterations; i++) {
      const picked = selectWeightedProvider(['listed', 'unlisted'], {
        listed: 100,
        // "unlisted" is intentionally absent — should default to weight 1.
      });
      counts[picked]++;
    }

    // listed:unlisted should be approximately 100:1 — listed > 95%.
    const listedRatio = counts.listed / iterations;
    expect(listedRatio).toBeGreaterThan(0.9);
  });

  it('throws for invalid negative weights', () => {
    expect(() =>
      selectWeightedProvider(['alpha', 'beta'], { alpha: -1, beta: 1 }),
    ).toThrow(/Invalid weight for provider "alpha"/);
  });

  it('throws when every configured weight is zero', () => {
    expect(() =>
      selectWeightedProvider(['alpha', 'beta'], { alpha: 0, beta: 0 }),
    ).toThrow('Cannot select from providers with zero total weight');
  });
});

// ---------------------------------------------------------------------------
// resolveProviderChain
// ---------------------------------------------------------------------------

describe('resolveProviderChain', () => {
  it('returns ordered providers unchanged when no weights are supplied', () => {
    expect(
      resolveProviderChain(['openai', 'stability', 'replicate'], {
        preferred: ['replicate', 'openai'],
      }),
    ).toEqual(['replicate', 'openai']);
  });

  it('moves the weighted primary to the front while preserving fallback order', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.95);

    const result = resolveProviderChain(['openai', 'stability', 'replicate'], {
      preferred: ['openai', 'stability', 'replicate'],
      weights: {
        openai: 0,
        stability: 1,
        replicate: 10,
      },
    });

    expect(result).toEqual(['replicate', 'openai', 'stability']);
  });
});

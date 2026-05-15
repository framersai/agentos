/**
 * Tests for {@link LLMProviderHealthRegistry}.
 *
 * The registry encodes the policy that a payment / auth error from a
 * shared provider (OpenRouter 402, OpenAI 401, etc.) should NOT cost
 * the next caller a full TLS round-trip to rediscover the same dead
 * provider. Status-aware open-immediate behavior is the whole point —
 * tests assert that 401 / 402 / 403 open the circuit after the FIRST
 * failure, while transient classes (429, 5xx) require a small streak.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  LLMProviderHealthRegistry,
} from '../../../src/core/safety/LLMProviderHealthRegistry';

describe('LLMProviderHealthRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed for any providerId', () => {
    const registry = new LLMProviderHealthRegistry();
    expect(registry.isOpen('openrouter')).toBe(false);
    expect(registry.isOpen('anything')).toBe(false);
  });

  describe('402 insufficient credits — open after 1 failure, 5 min cooldown', () => {
    it('opens immediately on a single 402 error', () => {
      const registry = new LLMProviderHealthRegistry();
      const err = new Error('[402] This request requires more credits');
      registry.recordFailure('openrouter', err);
      expect(registry.isOpen('openrouter')).toBe(true);
    });

    it('clears 5 minutes after the 402', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402] Insufficient credits'));
      expect(registry.isOpen('openrouter')).toBe(true);
      vi.advanceTimersByTime(5 * 60_000 - 1);
      expect(registry.isOpen('openrouter')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(registry.isOpen('openrouter')).toBe(false);
    });
  });

  describe('401 / 403 auth — open after 1 failure, 30 min cooldown', () => {
    it('401 opens immediately on first failure', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[401] Invalid API key'));
      expect(registry.isOpen('openrouter')).toBe(true);
    });

    it('403 opens immediately on first failure', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[403] Forbidden'));
      expect(registry.isOpen('openrouter')).toBe(true);
    });

    it('clears 30 minutes after the 401', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[401] Invalid API key'));
      vi.advanceTimersByTime(30 * 60_000 - 1);
      expect(registry.isOpen('openrouter')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(registry.isOpen('openrouter')).toBe(false);
    });
  });

  describe('429 rate limit — open after 3 failures, 30s cooldown', () => {
    it('stays closed for the first 2 failures', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openai', new Error('[429] Rate limit exceeded'));
      expect(registry.isOpen('openai')).toBe(false);
      registry.recordFailure('openai', new Error('[429] Rate limit exceeded'));
      expect(registry.isOpen('openai')).toBe(false);
    });

    it('opens on the 3rd 429 failure', () => {
      const registry = new LLMProviderHealthRegistry();
      for (let i = 0; i < 3; i++) {
        registry.recordFailure('openai', new Error('[429] Rate limit'));
      }
      expect(registry.isOpen('openai')).toBe(true);
    });

    it('clears 30s after the trip', () => {
      const registry = new LLMProviderHealthRegistry();
      for (let i = 0; i < 3; i++) {
        registry.recordFailure('openai', new Error('[429]'));
      }
      vi.advanceTimersByTime(30_000 - 1);
      expect(registry.isOpen('openai')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(registry.isOpen('openai')).toBe(false);
    });
  });

  describe('5xx server errors — open after 5 failures, 60s cooldown', () => {
    it('opens on the 5th 5xx failure', () => {
      const registry = new LLMProviderHealthRegistry();
      for (let i = 0; i < 4; i++) {
        registry.recordFailure('anthropic', new Error('[502] Bad gateway'));
        expect(registry.isOpen('anthropic')).toBe(false);
      }
      registry.recordFailure('anthropic', new Error('[503] Service unavailable'));
      expect(registry.isOpen('anthropic')).toBe(true);
    });

    it('clears 60s after the 5xx trip', () => {
      const registry = new LLMProviderHealthRegistry();
      for (let i = 0; i < 5; i++) {
        registry.recordFailure('anthropic', new Error('[502]'));
      }
      vi.advanceTimersByTime(60_000 - 1);
      expect(registry.isOpen('anthropic')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(registry.isOpen('anthropic')).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('clears accumulated failures so the streak counter resets', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openai', new Error('[429]'));
      registry.recordFailure('openai', new Error('[429]'));
      registry.recordSuccess('openai');
      // After success, two more 429s should NOT trip the breaker
      // because the streak counter is back at zero.
      registry.recordFailure('openai', new Error('[429]'));
      registry.recordFailure('openai', new Error('[429]'));
      expect(registry.isOpen('openai')).toBe(false);
    });

    it('does NOT clear an already-open circuit before the cooldown elapses', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402]'));
      expect(registry.isOpen('openrouter')).toBe(true);
      // A spurious recordSuccess (e.g. probe race) must not let
      // callers slip past the cooldown.
      registry.recordSuccess('openrouter');
      expect(registry.isOpen('openrouter')).toBe(true);
    });
  });

  describe('error classification', () => {
    it('reads status from "[NNN] ..." message prefix', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402] This request requires more credits, or fewer max_tokens.'));
      expect(registry.isOpen('openrouter')).toBe(true);
    });

    it('reads status from a `statusCode` property on the error', () => {
      const registry = new LLMProviderHealthRegistry();
      const err = Object.assign(new Error('Payment Required'), { statusCode: 402 });
      registry.recordFailure('openrouter', err);
      expect(registry.isOpen('openrouter')).toBe(true);
    });

    it('reads status from a `status` property on the error (Anthropic SDK shape)', () => {
      const registry = new LLMProviderHealthRegistry();
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      registry.recordFailure('anthropic', err);
      expect(registry.isOpen('anthropic')).toBe(true);
    });

    it('treats unclassifiable errors as transient 5xx-equivalent (5-failure threshold)', () => {
      const registry = new LLMProviderHealthRegistry();
      // An error with no status info should NOT trip on a single
      // failure — it could just be a network blip.
      registry.recordFailure('openrouter', new Error('socket hang up'));
      expect(registry.isOpen('openrouter')).toBe(false);
      for (let i = 0; i < 4; i++) {
        registry.recordFailure('openrouter', new Error('socket hang up'));
      }
      expect(registry.isOpen('openrouter')).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears state for a single provider', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402]'));
      registry.recordFailure('openai', new Error('[401]'));
      expect(registry.isOpen('openrouter')).toBe(true);
      expect(registry.isOpen('openai')).toBe(true);
      registry.reset('openrouter');
      expect(registry.isOpen('openrouter')).toBe(false);
      expect(registry.isOpen('openai')).toBe(true);
    });

    it('clears state for every provider when called without an id', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402]'));
      registry.recordFailure('openai', new Error('[401]'));
      registry.reset();
      expect(registry.isOpen('openrouter')).toBe(false);
      expect(registry.isOpen('openai')).toBe(false);
    });
  });

  describe('isolation', () => {
    it('failures on one provider do NOT affect another', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402]'));
      expect(registry.isOpen('openrouter')).toBe(true);
      expect(registry.isOpen('openai')).toBe(false);
      expect(registry.isOpen('anthropic')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns null for an untouched provider', () => {
      const registry = new LLMProviderHealthRegistry();
      expect(registry.getStats('openrouter')).toBeNull();
    });

    it('returns the open-state + remaining cooldown for an open circuit', () => {
      const registry = new LLMProviderHealthRegistry();
      registry.recordFailure('openrouter', new Error('[402]'));
      const stats = registry.getStats('openrouter');
      expect(stats).not.toBeNull();
      expect(stats!.state).toBe('open');
      expect(stats!.cooldownRemainingMs).toBeGreaterThan(0);
      expect(stats!.cooldownRemainingMs).toBeLessThanOrEqual(5 * 60_000);
      expect(stats!.lastStatusCode).toBe(402);
    });
  });
});

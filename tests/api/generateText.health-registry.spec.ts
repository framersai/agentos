/**
 * Integration test: `generateText` consults the global LLM provider
 * health registry before each primary attempt.
 *
 * The registry's per-class status policy is unit-tested separately
 * (see `tests/core/safety/LLMProviderHealthRegistry.spec.ts`). This
 * file asserts the *wiring*: a pre-tripped circuit causes generateText
 * to skip the primary, and a real provider error records a failure on
 * the registry so subsequent calls inside the same process bypass the
 * dead provider entirely.
 *
 * The tests use the global singleton (and reset it in beforeEach) so
 * the wiring assertion exercises the actual code path the production
 * runtime uses: not a DI-injected double.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { globalLLMProviderHealth } from '../../src/core/safety/LLMProviderHealthRegistry';

describe('generateText × globalLLMProviderHealth wiring', () => {
  beforeEach(() => {
    globalLLMProviderHealth.reset();
  });

  it('records a failure on the registry when the primary errors', async () => {
    // Force a failure path that doesn't hit the network: invalid
    // model string causes resolveProvider to throw a non-provider
    // error. Even so, when a primary provider does resolve and then
    // throws, the registry must observe a recordFailure call. Using a
    // spy lets us assert the wiring without standing up a mock LLM.
    const recordSpy = vi.spyOn(globalLLMProviderHealth, 'recordFailure');
    const { generateText } = await import('../../src/api/generateText.js');
    // Use a provider that resolves but has no API key in the env so
    // the call fails downstream of provider resolution. The test
    // environment doesn't have OPENAI_API_KEY set: we set a fake one
    // so the resolver succeeds but the upstream call fails.
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-deliberately-invalid';
    try {
      await generateText({
        model: 'openai:gpt-4o-mini',
        prompt: 'hi',
        fallbackProviders: [], // empty array = explicit opt-out of fallback chain
      }).catch(() => undefined);
    } finally {
      if (origKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = origKey;
    }
    // The recordFailure spy should have been called with providerId
    // 'openai' (the resolved primary).
    const openaiFailureCalls = recordSpy.mock.calls.filter(
      (call) => call[0] === 'openai',
    );
    expect(openaiFailureCalls.length).toBeGreaterThan(0);
  }, 30_000);

  it('skips the primary attempt entirely when its circuit is open', async () => {
    // Pre-trip the breaker for openai so the next generateText call
    // should skip the network attempt and route into the fallback
    // chain. With no fallback providers configured, the call must
    // reject with the synthetic circuit-open error (httpStatus=503).
    // A fake API key keeps `resolveProvider` from failing earlier in
    // the chain: we want the circuit check to be the first thing
    // that throws, not the env-var lookup.
    globalLLMProviderHealth.recordFailure(
      'openai',
      new Error('[402] Insufficient credits'),
    );
    expect(globalLLMProviderHealth.isOpen('openai')).toBe(true);
    const { generateText } = await import('../../src/api/generateText.js');
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-resolver-passthrough';
    try {
      await expect(
        generateText({
          model: 'openai:gpt-4o-mini',
          prompt: 'hi',
          fallbackProviders: [], // no fallback: bubble the circuit-open error
        }),
      ).rejects.toThrow(/circuit open|503/i);
    } finally {
      if (origKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = origKey;
    }
  }, 30_000);
});

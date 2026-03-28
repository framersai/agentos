/**
 * @module media/audio/__tests__/SunoProvider.test
 *
 * Unit tests for {@link SunoProvider} (Suno AI via Replicate predictions API).
 *
 * Uses mocked `fetch` to simulate the Replicate create-prediction -> poll flow.
 *
 * ## What is tested
 *
 * - Music generation sends correct URL, headers, body (with make_instrumental)
 * - supports() returns true for music, false for sfx
 * - API errors are propagated with status codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SunoProvider } from '../providers/SunoProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchSpy = ReturnType<typeof vi.fn>;

/**
 * Create a mock Response-like object for fetch.
 * @param body - JSON-serialisable response body.
 * @param ok - Whether the response has a 2xx status.
 * @param status - HTTP status code.
 */
function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SunoProvider', () => {
  let provider: SunoProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new SunoProvider();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Music generation
  // -------------------------------------------------------------------------

  it('should generate music with correct URL, headers, and body', async () => {
    await provider.initialize({ apiKey: 'r8_suno_key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-suno-1',
      status: 'succeeded',
      output: 'https://replicate.delivery/suno-output.mp3',
    }));

    const result = await provider.generateMusic({
      prompt: 'Upbeat jazz fusion track',
      durationSec: 60,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toBe('https://replicate.delivery/suno-output.mp3');
    expect(result.providerId).toBe('suno');
    expect(result.modelId).toBe('suno-ai/suno');

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://api.replicate.com/v1/predictions');
    expect(submitOpts.headers.Authorization).toBe('Token r8_suno_key');
    expect(submitOpts.headers.Prefer).toBe('wait=60');

    const body = JSON.parse(submitOpts.body);
    expect(body.model).toBe('suno-ai/suno');
    expect(body.input.prompt).toBe('Upbeat jazz fusion track');
    expect(body.input.duration).toBe(60);
    expect(body.input.make_instrumental).toBe(true);
  });

  // -------------------------------------------------------------------------
  // supports()
  // -------------------------------------------------------------------------

  it('should support music but not sfx', () => {
    expect(provider.supports('music')).toBe(true);
    expect(provider.supports('sfx')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('should throw on API error with status code', async () => {
    await provider.initialize({ apiKey: 'r8_key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({ detail: 'unauthorized' }, false, 401));

    await expect(
      provider.generateMusic({ prompt: 'test' }),
    ).rejects.toThrow(/submission failed \(401\)/);
  });
});

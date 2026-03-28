/**
 * @module media/audio/__tests__/UdioProvider.test
 *
 * Unit tests for {@link UdioProvider} (Udio via Replicate predictions API).
 *
 * Uses mocked `fetch` to simulate the Replicate create-prediction -> poll flow.
 *
 * ## What is tested
 *
 * - Music generation sends correct URL, headers, and body
 * - supports() returns true for music, false for sfx
 * - API errors are propagated with status codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UdioProvider } from '../providers/UdioProvider.js';

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

describe('UdioProvider', () => {
  let provider: UdioProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new UdioProvider();
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
    await provider.initialize({ apiKey: 'r8_udio_key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-udio-1',
      status: 'succeeded',
      output: 'https://replicate.delivery/udio-output.mp3',
    }));

    const result = await provider.generateMusic({
      prompt: 'Epic orchestral film score',
      durationSec: 120,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toBe('https://replicate.delivery/udio-output.mp3');
    expect(result.providerId).toBe('udio');
    expect(result.modelId).toBe('udio/udio');

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://api.replicate.com/v1/predictions');
    expect(submitOpts.headers.Authorization).toBe('Token r8_udio_key');
    expect(submitOpts.headers.Prefer).toBe('wait=60');

    const body = JSON.parse(submitOpts.body);
    expect(body.model).toBe('udio/udio');
    expect(body.input.prompt).toBe('Epic orchestral film score');
    expect(body.input.duration).toBe(120);
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

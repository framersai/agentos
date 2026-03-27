/**
 * @module core/audio/__tests__/StableAudioProvider.test
 *
 * Unit tests for {@link StableAudioProvider} (Stability AI Stable Audio API).
 *
 * Uses mocked `fetch` to simulate the synchronous audio generation flow.
 *
 * ## What is tested
 *
 * - Music generation sends correct URL, headers, and body
 * - SFX generation works with the same endpoint
 * - supports() returns true for both music and sfx
 * - API errors are propagated with status codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StableAudioProvider } from '../providers/StableAudioProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchSpy = ReturnType<typeof vi.fn>;

/**
 * Create a mock Response-like object for fetch.
 * @param body - Response body (ArrayBuffer for success, JSON for errors).
 * @param ok - Whether the response has a 2xx status.
 * @param status - HTTP status code.
 */
function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    arrayBuffer: vi.fn(async () => body),
    json: vi.fn(async () => body),
    text: vi.fn(async () => typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StableAudioProvider', () => {
  let provider: StableAudioProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new StableAudioProvider();
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
    await provider.initialize({ apiKey: 'sa_test_key' });

    const fakeAudio = new ArrayBuffer(128);
    fetchSpy.mockResolvedValueOnce(mockResponse(fakeAudio));

    const result = await provider.generateMusic({
      prompt: 'Upbeat electronic dance track',
      durationSec: 30,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].mimeType).toBe('audio/mpeg');
    expect(result.providerId).toBe('stable-audio');
    expect(result.modelId).toBe('stable-audio-open-1.0');

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://api.stability.ai/v2beta/audio/generate');
    expect(submitOpts.headers.Authorization).toBe('Bearer sa_test_key');
    expect(submitOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(submitOpts.body);
    expect(body.prompt).toBe('Upbeat electronic dance track');
    expect(body.duration).toBe(30);
    expect(body.output_format).toBe('mp3');
  });

  // -------------------------------------------------------------------------
  // SFX generation
  // -------------------------------------------------------------------------

  it('should generate SFX using the same endpoint', async () => {
    await provider.initialize({ apiKey: 'sa_test_key' });

    const fakeAudio = new ArrayBuffer(64);
    fetchSpy.mockResolvedValueOnce(mockResponse(fakeAudio));

    const result = await provider.generateSFX({
      prompt: 'Door slamming shut',
      durationSec: 2,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.providerId).toBe('stable-audio');
    expect(result.usage?.totalAudioClips).toBe(1);
  });

  // -------------------------------------------------------------------------
  // supports()
  // -------------------------------------------------------------------------

  it('should support both music and sfx capabilities', () => {
    expect(provider.supports('music')).toBe(true);
    expect(provider.supports('sfx')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('should throw on API error with status code', async () => {
    await provider.initialize({ apiKey: 'sa_test_key' });

    fetchSpy.mockResolvedValueOnce(mockResponse('Unauthorized', false, 401));

    await expect(
      provider.generateMusic({ prompt: 'test' }),
    ).rejects.toThrow(/Stable Audio generation failed \(401\)/);
  });
});

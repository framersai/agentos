/**
 * @module media/audio/__tests__/FalAudioProvider.test
 *
 * Unit tests for {@link FalAudioProvider} (Fal.ai queue API).
 *
 * Uses mocked `fetch` to simulate the Fal.ai three-step queue flow:
 * submit -> poll status -> fetch result.
 *
 * ## What is tested
 *
 * - Music generation completes the full submit -> poll -> fetch flow
 * - SFX generation uses the same endpoint
 * - supports() returns true for both music and sfx
 * - API errors are propagated with status codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalAudioProvider } from '../providers/FalAudioProvider.js';

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

describe('FalAudioProvider', () => {
  let provider: FalAudioProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new FalAudioProvider();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Music generation (full flow)
  // -------------------------------------------------------------------------

  it('should complete the full submit -> poll -> fetch flow for music', async () => {
    await provider.initialize({ apiKey: 'fal_audio_key', pollIntervalMs: 1 });

    // Call 1: Submit
    fetchSpy.mockResolvedValueOnce(mockResponse({ request_id: 'req-audio-1' }));
    // Call 2: Poll (COMPLETED)
    fetchSpy.mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }));
    // Call 3: Fetch result
    fetchSpy.mockResolvedValueOnce(mockResponse({
      audio: {
        url: 'https://fal.ai/output/music.mp3',
        content_type: 'audio/mpeg',
        duration: 30,
      },
      seed: 42,
    }));

    const result = await provider.generateMusic({
      prompt: 'Ambient electronic soundscape',
      durationSec: 30,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toBe('https://fal.ai/output/music.mp3');
    expect(result.audio[0].mimeType).toBe('audio/mpeg');
    expect(result.audio[0].durationSec).toBe(30);
    expect(result.providerId).toBe('fal-audio');
    expect(result.modelId).toBe('fal-ai/stable-audio');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Verify submit URL and auth
    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://queue.fal.run/fal-ai/stable-audio');
    expect(submitOpts.headers.Authorization).toBe('Key fal_audio_key');

    const body = JSON.parse(submitOpts.body);
    expect(body.prompt).toBe('Ambient electronic soundscape');
    expect(body.duration).toBe(30);
  });

  // -------------------------------------------------------------------------
  // SFX generation
  // -------------------------------------------------------------------------

  it('should generate SFX using the same endpoint', async () => {
    await provider.initialize({ apiKey: 'fal_key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-sfx-1' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({
        audio: { url: 'https://fal.ai/output/sfx.mp3' },
      }));

    const result = await provider.generateSFX({
      prompt: 'Explosion with debris',
      durationSec: 3,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toBe('https://fal.ai/output/sfx.mp3');
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
    await provider.initialize({ apiKey: 'fal_key' });

    fetchSpy.mockResolvedValueOnce(mockResponse({ error: 'unauthorized' }, false, 403));

    await expect(
      provider.generateMusic({ prompt: 'test' }),
    ).rejects.toThrow(/submission failed \(403\)/);
  });
});

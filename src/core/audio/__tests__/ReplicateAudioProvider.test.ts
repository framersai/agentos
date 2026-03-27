/**
 * @module core/audio/__tests__/ReplicateAudioProvider.test
 *
 * Unit tests for {@link ReplicateAudioProvider} (Replicate predictions API).
 *
 * Uses mocked `fetch` to simulate the Replicate create-prediction -> poll flow.
 *
 * ## What is tested
 *
 * - Music generation uses defaultMusicModel and correct headers
 * - SFX generation uses defaultSfxModel
 * - supports() returns true for both music and sfx
 * - API errors are propagated with status codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplicateAudioProvider } from '../providers/ReplicateAudioProvider.js';

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

describe('ReplicateAudioProvider', () => {
  let provider: ReplicateAudioProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new ReplicateAudioProvider();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Music generation
  // -------------------------------------------------------------------------

  it('should generate music using the default music model', async () => {
    await provider.initialize({ apiKey: 'r8_audio_key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-music-1',
      status: 'succeeded',
      output: 'https://replicate.delivery/music.mp3',
    }));

    const result = await provider.generateMusic({
      prompt: 'Upbeat indie rock',
      durationSec: 30,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toBe('https://replicate.delivery/music.mp3');
    expect(result.providerId).toBe('replicate-audio');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe('meta/musicgen');
    expect(body.input.prompt).toBe('Upbeat indie rock');
    expect(body.input.duration).toBe(30);

    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Token r8_audio_key');
    expect(fetchSpy.mock.calls[0][1].headers.Prefer).toBe('wait=60');
  });

  // -------------------------------------------------------------------------
  // SFX generation
  // -------------------------------------------------------------------------

  it('should generate SFX using the default SFX model', async () => {
    await provider.initialize({ apiKey: 'r8_audio_key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-sfx-1',
      status: 'succeeded',
      output: 'https://replicate.delivery/sfx.mp3',
    }));

    const result = await provider.generateSFX({
      prompt: 'Glass shattering',
      durationSec: 3,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toBe('https://replicate.delivery/sfx.mp3');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe('meta/audiogen');
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
    await provider.initialize({ apiKey: 'r8_key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({ detail: 'unauthorized' }, false, 401));

    await expect(
      provider.generateMusic({ prompt: 'test' }),
    ).rejects.toThrow(/submission failed \(401\)/);
  });
});

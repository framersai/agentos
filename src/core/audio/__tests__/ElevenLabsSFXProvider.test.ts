/**
 * @module core/audio/__tests__/ElevenLabsSFXProvider.test
 *
 * Unit tests for {@link ElevenLabsSFXProvider} (ElevenLabs Sound Generation API).
 *
 * Uses mocked `fetch` to simulate the synchronous SFX generation flow.
 *
 * ## What is tested
 *
 * - SFX generation sends correct URL, headers, and body
 * - supports() returns true for sfx, false for music
 * - API errors are propagated with status codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElevenLabsSFXProvider } from '../providers/ElevenLabsSFXProvider.js';

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

describe('ElevenLabsSFXProvider', () => {
  let provider: ElevenLabsSFXProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new ElevenLabsSFXProvider();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // SFX generation
  // -------------------------------------------------------------------------

  it('should generate SFX with correct URL, headers, and body', async () => {
    await provider.initialize({ apiKey: 'xi_test_key' });

    const fakeAudio = new ArrayBuffer(128);
    fetchSpy.mockResolvedValueOnce(mockResponse(fakeAudio));

    const result = await provider.generateSFX({
      prompt: 'Thunder crack followed by rain',
      durationSec: 5,
    });

    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].mimeType).toBe('audio/mpeg');
    expect(result.providerId).toBe('elevenlabs-sfx');

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://api.elevenlabs.io/v1/sound-generation');
    expect(submitOpts.headers['xi-api-key']).toBe('xi_test_key');
    expect(submitOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(submitOpts.body);
    expect(body.text).toBe('Thunder crack followed by rain');
    expect(body.duration_seconds).toBe(5);
    expect(body.prompt_influence).toBe(0.3);
  });

  // -------------------------------------------------------------------------
  // supports()
  // -------------------------------------------------------------------------

  it('should support sfx but not music', () => {
    expect(provider.supports('sfx')).toBe(true);
    expect(provider.supports('music')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('should throw on API error with status code', async () => {
    await provider.initialize({ apiKey: 'xi_test_key' });

    fetchSpy.mockResolvedValueOnce(mockResponse('Forbidden', false, 403));

    await expect(
      provider.generateSFX({ prompt: 'test' }),
    ).rejects.toThrow(/ElevenLabs SFX generation failed \(403\)/);
  });
});

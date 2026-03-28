import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { FallbackAudioProxy, type AudioFallbackEvent } from '../FallbackAudioProxy.js';
import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, AudioResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal mock audio generation result. */
function makeResult(providerId: string): AudioResult {
  return {
    created: Date.now(),
    modelId: 'test-model',
    providerId,
    audio: [{ url: `https://audio.test/${providerId}` }],
  };
}

/** Creates a minimal mock music request. */
function makeRequest(): MusicGenerateRequest {
  return { prompt: 'Upbeat lo-fi hip hop with vinyl crackle' };
}

/**
 * Creates a mock {@link IAudioGenerator} with configurable behaviour.
 *
 * @param id - Provider identifier.
 * @param overrides - Optional overrides for individual methods.
 * @param supportedCaps - Set of capabilities reported by `supports()`.
 *   Defaults to `['music']`.
 */
function createMockProvider(
  id: string,
  overrides: {
    generateMusic?: () => Promise<AudioResult>;
    generateSFX?: ((req: never) => Promise<AudioResult>) | undefined;
  } = {},
  supportedCaps: Array<'music' | 'sfx'> = ['music'],
): IAudioGenerator {
  const capsSet = new Set(supportedCaps);

  const provider: IAudioGenerator = {
    providerId: id,
    isInitialized: true,
    initialize: vi.fn(async () => {}),
    generateMusic: overrides.generateMusic ?? vi.fn(async () => makeResult(id)),
    supports: vi.fn((cap: 'music' | 'sfx') => capsSet.has(cap)),
  };

  // Only attach generateSFX when explicitly provided — lets tests exercise
  // the "method does not exist" path.
  if (overrides.generateSFX !== undefined) {
    provider.generateSFX = overrides.generateSFX;
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FallbackAudioProxy', () => {
  // -----------------------------------------------------------------------
  // generateMusic — first succeeds
  // -----------------------------------------------------------------------

  it('returns the result from the first provider when it succeeds', async () => {
    const emitter = new EventEmitter();
    const p1 = createMockProvider('alpha');
    const p2 = createMockProvider('beta');

    const proxy = new FallbackAudioProxy([p1, p2], emitter);
    const result = await proxy.generateMusic(makeRequest());

    expect(result.providerId).toBe('alpha');
    expect(p1.generateMusic).toHaveBeenCalledOnce();
    expect(p2.generateMusic).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // generateMusic — fallback on failure
  // -----------------------------------------------------------------------

  it('falls back to the second provider when the first fails', async () => {
    const emitter = new EventEmitter();
    const fallbackSpy = vi.fn();
    emitter.on('audio:generate:fallback', fallbackSpy);

    const p1 = createMockProvider('alpha', {
      generateMusic: vi.fn(async () => {
        throw new Error('alpha is down');
      }),
    });
    const p2 = createMockProvider('beta');

    const proxy = new FallbackAudioProxy([p1, p2], emitter);
    const result = await proxy.generateMusic(makeRequest());

    expect(result.providerId).toBe('beta');
    expect(fallbackSpy).toHaveBeenCalledOnce();

    const event: AudioFallbackEvent = fallbackSpy.mock.calls[0][0];
    expect(event.type).toBe('audio:generate:fallback');
    expect(event.from).toBe('alpha');
    expect(event.to).toBe('beta');
    expect(event.reason).toBe('alpha is down');
  });

  // -----------------------------------------------------------------------
  // generateMusic — all fail → AggregateError
  // -----------------------------------------------------------------------

  it('throws an AggregateError when all providers fail', async () => {
    const emitter = new EventEmitter();
    const p1 = createMockProvider('alpha', {
      generateMusic: vi.fn(async () => {
        throw new Error('alpha boom');
      }),
    });
    const p2 = createMockProvider('beta', {
      generateMusic: vi.fn(async () => {
        throw new Error('beta boom');
      }),
    });

    const proxy = new FallbackAudioProxy([p1, p2], emitter);

    try {
      await proxy.generateMusic(makeRequest());
      expect.fail('Expected AggregateError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AggregateError);
      const agg = err as AggregateError;
      expect(agg.errors).toHaveLength(2);
      expect(agg.message).toContain('alpha boom');
      expect(agg.message).toContain('beta boom');
    }
  });

  // -----------------------------------------------------------------------
  // Empty chain
  // -----------------------------------------------------------------------

  it('throws immediately when the chain is empty', async () => {
    const emitter = new EventEmitter();
    const proxy = new FallbackAudioProxy([], emitter);

    await expect(proxy.generateMusic(makeRequest())).rejects.toThrow(
      'No providers in audio fallback chain',
    );
  });

  // -----------------------------------------------------------------------
  // generateSFX — skips music-only providers
  // -----------------------------------------------------------------------

  it('generateSFX skips providers that only support music', async () => {
    const emitter = new EventEmitter();
    const fallbackSpy = vi.fn();
    emitter.on('audio:generate:fallback', fallbackSpy);

    // p1 only supports music (no SFX)
    const p1 = createMockProvider('suno', {}, ['music']);

    // p2 supports SFX
    const p2 = createMockProvider(
      'elevenlabs',
      {
        generateSFX: vi.fn(async () => makeResult('elevenlabs')),
      },
      ['sfx'],
    );

    const proxy = new FallbackAudioProxy([p1, p2], emitter);
    const result = await proxy.generateSFX({
      prompt: 'Thunder crack followed by heavy rain',
    });

    expect(result.providerId).toBe('elevenlabs');
    expect(fallbackSpy).toHaveBeenCalledOnce();
    expect(fallbackSpy.mock.calls[0][0].reason).toBe('generateSFX not supported');
  });

  // -----------------------------------------------------------------------
  // Fallback event emission
  // -----------------------------------------------------------------------

  it('emits audio:generate:fallback events along the chain', async () => {
    const emitter = new EventEmitter();
    const events: AudioFallbackEvent[] = [];
    emitter.on('audio:generate:fallback', (evt) => events.push(evt));

    const p1 = createMockProvider('alpha', {
      generateMusic: vi.fn(async () => {
        throw new Error('alpha timeout');
      }),
    });
    const p2 = createMockProvider('beta', {
      generateMusic: vi.fn(async () => {
        throw new Error('beta 503');
      }),
    });
    const p3 = createMockProvider('gamma');

    const proxy = new FallbackAudioProxy([p1, p2, p3], emitter);
    const result = await proxy.generateMusic(makeRequest());

    expect(result.providerId).toBe('gamma');
    expect(events).toHaveLength(2);

    expect(events[0].from).toBe('alpha');
    expect(events[0].to).toBe('beta');
    expect(events[0].reason).toBe('alpha timeout');

    expect(events[1].from).toBe('beta');
    expect(events[1].to).toBe('gamma');
    expect(events[1].reason).toBe('beta 503');
  });
});

import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { FallbackVideoProxy, type VideoFallbackEvent } from '../FallbackVideoProxy.js';
import type { IVideoGenerator } from '../IVideoGenerator.js';
import type { VideoGenerateRequest, VideoResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal mock video generation result. */
function makeResult(providerId: string): VideoResult {
  return {
    created: Date.now(),
    modelId: 'test-model',
    providerId,
    videos: [{ url: `https://video.test/${providerId}` }],
  };
}

/** Creates a minimal mock request. */
function makeRequest(): VideoGenerateRequest {
  return { modelId: 'test-model', prompt: 'a red panda playing piano' };
}

/**
 * Creates a mock {@link IVideoGenerator} with configurable behaviour.
 *
 * @param id - Provider identifier.
 * @param overrides - Optional overrides for individual methods.
 * @param supportedCaps - Set of capabilities reported by `supports()`.
 *   Defaults to `['text-to-video']`.
 */
function createMockProvider(
  id: string,
  overrides: {
    generateVideo?: () => Promise<VideoResult>;
    imageToVideo?: ((req: never) => Promise<VideoResult>) | undefined;
  } = {},
  supportedCaps: Array<'text-to-video' | 'image-to-video'> = ['text-to-video'],
): IVideoGenerator {
  const capsSet = new Set(supportedCaps);

  const provider: IVideoGenerator = {
    providerId: id,
    isInitialized: true,
    initialize: vi.fn(async () => {}),
    generateVideo: overrides.generateVideo ?? vi.fn(async () => makeResult(id)),
    supports: vi.fn((cap: 'text-to-video' | 'image-to-video') => capsSet.has(cap)),
  };

  // Only attach imageToVideo when explicitly provided — lets tests exercise
  // the "method does not exist" path.
  if (overrides.imageToVideo !== undefined) {
    provider.imageToVideo = overrides.imageToVideo;
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FallbackVideoProxy', () => {
  // -----------------------------------------------------------------------
  // generateVideo
  // -----------------------------------------------------------------------

  describe('generateVideo', () => {
    it('returns the result from the first provider when it succeeds', async () => {
      const emitter = new EventEmitter();
      const p1 = createMockProvider('alpha');
      const p2 = createMockProvider('beta');

      const proxy = new FallbackVideoProxy([p1, p2], emitter);
      const result = await proxy.generateVideo(makeRequest());

      expect(result.providerId).toBe('alpha');
      expect(p1.generateVideo).toHaveBeenCalledOnce();
      expect(p2.generateVideo).not.toHaveBeenCalled();
    });

    it('falls back to the second provider when the first fails', async () => {
      const emitter = new EventEmitter();
      const fallbackSpy = vi.fn();
      emitter.on('video:generate:fallback', fallbackSpy);

      const p1 = createMockProvider('alpha', {
        generateVideo: vi.fn(async () => {
          throw new Error('alpha is down');
        }),
      });
      const p2 = createMockProvider('beta');

      const proxy = new FallbackVideoProxy([p1, p2], emitter);
      const result = await proxy.generateVideo(makeRequest());

      expect(result.providerId).toBe('beta');
      expect(fallbackSpy).toHaveBeenCalledOnce();

      const event: VideoFallbackEvent = fallbackSpy.mock.calls[0][0];
      expect(event.type).toBe('video:generate:fallback');
      expect(event.from).toBe('alpha');
      expect(event.to).toBe('beta');
      expect(event.reason).toBe('alpha is down');
    });

    it('throws an AggregateError when all providers fail', async () => {
      const emitter = new EventEmitter();
      const p1 = createMockProvider('alpha', {
        generateVideo: vi.fn(async () => {
          throw new Error('alpha boom');
        }),
      });
      const p2 = createMockProvider('beta', {
        generateVideo: vi.fn(async () => {
          throw new Error('beta boom');
        }),
      });

      const proxy = new FallbackVideoProxy([p1, p2], emitter);

      try {
        await proxy.generateVideo(makeRequest());
        expect.fail('Expected AggregateError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AggregateError);
        const agg = err as AggregateError;
        expect(agg.errors).toHaveLength(2);
        expect(agg.message).toContain('alpha boom');
        expect(agg.message).toContain('beta boom');
      }
    });

    it('throws immediately when the chain is empty', async () => {
      const emitter = new EventEmitter();
      const proxy = new FallbackVideoProxy([], emitter);

      await expect(proxy.generateVideo(makeRequest())).rejects.toThrow(
        'No providers in video fallback chain',
      );
    });
  });

  // -----------------------------------------------------------------------
  // imageToVideo
  // -----------------------------------------------------------------------

  describe('imageToVideo', () => {
    it('skips providers that do not support image-to-video', async () => {
      const emitter = new EventEmitter();
      const fallbackSpy = vi.fn();
      emitter.on('video:generate:fallback', fallbackSpy);

      // p1 only supports text-to-video (no image-to-video)
      const p1 = createMockProvider('alpha', {}, ['text-to-video']);

      // p2 supports image-to-video
      const p2 = createMockProvider(
        'beta',
        {
          imageToVideo: vi.fn(async () => makeResult('beta')),
        },
        ['text-to-video', 'image-to-video'],
      );

      const proxy = new FallbackVideoProxy([p1, p2], emitter);
      const result = await proxy.imageToVideo({
        modelId: 'test-model',
        image: Buffer.from('fake-image'),
        prompt: 'animate this',
      });

      expect(result.providerId).toBe('beta');
      expect(fallbackSpy).toHaveBeenCalledOnce();
      expect(fallbackSpy.mock.calls[0][0].reason).toBe('imageToVideo not supported');
    });
  });

  // -----------------------------------------------------------------------
  // Fallback event emission
  // -----------------------------------------------------------------------

  describe('event emission', () => {
    it('emits a video:generate:fallback event when falling back', async () => {
      const emitter = new EventEmitter();
      const events: VideoFallbackEvent[] = [];
      emitter.on('video:generate:fallback', (evt) => events.push(evt));

      const p1 = createMockProvider('alpha', {
        generateVideo: vi.fn(async () => {
          throw new Error('alpha timeout');
        }),
      });
      const p2 = createMockProvider('beta', {
        generateVideo: vi.fn(async () => {
          throw new Error('beta 503');
        }),
      });
      const p3 = createMockProvider('gamma');

      const proxy = new FallbackVideoProxy([p1, p2, p3], emitter);
      const result = await proxy.generateVideo(makeRequest());

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
});

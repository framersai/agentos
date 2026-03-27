import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { FallbackImageProxy, type ImageFallbackEvent } from '../FallbackImageProxy.js';
import type {
  IImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageEditRequest,
  ImageUpscaleRequest,
  ImageVariateRequest,
} from '../IImageProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal mock image generation result. */
function makeResult(providerId: string): ImageGenerationResult {
  return {
    created: Date.now(),
    modelId: 'test-model',
    providerId,
    images: [{ url: `https://img.test/${providerId}` }],
  };
}

/** Creates a minimal mock request. */
function makeRequest(): ImageGenerationRequest {
  return { modelId: 'test-model', prompt: 'a red panda' };
}

/** Creates a mock IImageProvider with configurable behaviour. */
function createMockProvider(
  id: string,
  overrides: {
    generateImage?: () => Promise<ImageGenerationResult>;
    editImage?: ((req: ImageEditRequest) => Promise<ImageGenerationResult>) | undefined;
    upscaleImage?: ((req: ImageUpscaleRequest) => Promise<ImageGenerationResult>) | undefined;
    variateImage?: ((req: ImageVariateRequest) => Promise<ImageGenerationResult>) | undefined;
  } = {},
): IImageProvider {
  const provider: IImageProvider = {
    providerId: id,
    isInitialized: true,
    initialize: vi.fn(async () => {}),
    generateImage: overrides.generateImage ?? vi.fn(async () => makeResult(id)),
  };

  // Only attach optional methods when explicitly provided — this lets tests
  // exercise the "method does not exist" path.
  if (overrides.editImage !== undefined) {
    provider.editImage = overrides.editImage;
  }
  if (overrides.upscaleImage !== undefined) {
    provider.upscaleImage = overrides.upscaleImage;
  }
  if (overrides.variateImage !== undefined) {
    provider.variateImage = overrides.variateImage;
  }

  return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FallbackImageProxy', () => {
  // -----------------------------------------------------------------------
  // generateImage
  // -----------------------------------------------------------------------

  describe('generateImage', () => {
    it('returns the result from the first provider when it succeeds', async () => {
      const emitter = new EventEmitter();
      const p1 = createMockProvider('alpha');
      const p2 = createMockProvider('beta');

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      const result = await proxy.generateImage(makeRequest());

      expect(result.providerId).toBe('alpha');
      expect(p1.generateImage).toHaveBeenCalledOnce();
      expect(p2.generateImage).not.toHaveBeenCalled();
    });

    it('falls back to the second provider when the first fails', async () => {
      const emitter = new EventEmitter();
      const fallbackSpy = vi.fn();
      emitter.on('image:fallback', fallbackSpy);

      const p1 = createMockProvider('alpha', {
        generateImage: vi.fn(async () => {
          throw new Error('alpha is down');
        }),
      });
      const p2 = createMockProvider('beta');

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      const result = await proxy.generateImage(makeRequest());

      expect(result.providerId).toBe('beta');
      expect(fallbackSpy).toHaveBeenCalledOnce();

      const event: ImageFallbackEvent = fallbackSpy.mock.calls[0][0];
      expect(event.type).toBe('image:fallback');
      expect(event.from).toBe('alpha');
      expect(event.to).toBe('beta');
      expect(event.reason).toBe('alpha is down');
    });

    it('throws an AggregateError when all providers fail', async () => {
      const emitter = new EventEmitter();
      const p1 = createMockProvider('alpha', {
        generateImage: vi.fn(async () => {
          throw new Error('alpha boom');
        }),
      });
      const p2 = createMockProvider('beta', {
        generateImage: vi.fn(async () => {
          throw new Error('beta boom');
        }),
      });

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      await expect(proxy.generateImage(makeRequest())).rejects.toThrow(AggregateError);

      try {
        await proxy.generateImage(makeRequest());
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
      const proxy = new FallbackImageProxy([], emitter);

      await expect(proxy.generateImage(makeRequest())).rejects.toThrow(
        'No providers in image fallback chain',
      );
    });
  });

  // -----------------------------------------------------------------------
  // editImage
  // -----------------------------------------------------------------------

  describe('editImage', () => {
    const editReq: ImageEditRequest = {
      modelId: 'test-model',
      image: Buffer.from('fake-image'),
      prompt: 'make it blue',
    };

    it('skips providers that do not implement editImage and falls back', async () => {
      const emitter = new EventEmitter();
      const fallbackSpy = vi.fn();
      emitter.on('image:fallback', fallbackSpy);

      // p1 has no editImage method at all
      const p1 = createMockProvider('alpha');
      // p2 supports editing
      const p2 = createMockProvider('beta', {
        editImage: vi.fn(async () => makeResult('beta')),
      });

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      const result = await proxy.editImage(editReq);

      expect(result.providerId).toBe('beta');
      expect(fallbackSpy).toHaveBeenCalledOnce();
      expect(fallbackSpy.mock.calls[0][0].reason).toBe('editImage not supported');
    });

    it('skips providers that throw NotSupportedError', async () => {
      const emitter = new EventEmitter();

      const notSupportedErr = Object.assign(
        new Error('Provider "alpha" does not support editImage.'),
        { name: 'ImageEditNotSupportedError' },
      );

      const p1 = createMockProvider('alpha', {
        editImage: vi.fn(async () => {
          throw notSupportedErr;
        }),
      });
      const p2 = createMockProvider('beta', {
        editImage: vi.fn(async () => makeResult('beta')),
      });

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      const result = await proxy.editImage(editReq);

      expect(result.providerId).toBe('beta');
    });

    it('throws AggregateError when no provider supports editing', async () => {
      const emitter = new EventEmitter();
      const p1 = createMockProvider('alpha');
      const p2 = createMockProvider('beta');

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      await expect(proxy.editImage(editReq)).rejects.toThrow(AggregateError);
    });
  });

  // -----------------------------------------------------------------------
  // upscaleImage
  // -----------------------------------------------------------------------

  describe('upscaleImage', () => {
    const upscaleReq: ImageUpscaleRequest = {
      modelId: 'test-model',
      image: Buffer.from('fake-image'),
      scale: 2,
    };

    it('falls back to a provider that supports upscaling', async () => {
      const emitter = new EventEmitter();

      const p1 = createMockProvider('alpha');
      const p2 = createMockProvider('beta', {
        upscaleImage: vi.fn(async () => makeResult('beta')),
      });

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      const result = await proxy.upscaleImage(upscaleReq);

      expect(result.providerId).toBe('beta');
    });
  });

  // -----------------------------------------------------------------------
  // variateImage
  // -----------------------------------------------------------------------

  describe('variateImage', () => {
    const variateReq: ImageVariateRequest = {
      modelId: 'test-model',
      image: Buffer.from('fake-image'),
      n: 2,
    };

    it('falls back to a provider that supports variations', async () => {
      const emitter = new EventEmitter();

      const p1 = createMockProvider('alpha');
      const p2 = createMockProvider('beta', {
        variateImage: vi.fn(async () => makeResult('beta')),
      });

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      const result = await proxy.variateImage(variateReq);

      expect(result.providerId).toBe('beta');
    });
  });

  // -----------------------------------------------------------------------
  // providerId / metadata
  // -----------------------------------------------------------------------

  describe('metadata', () => {
    it('derives providerId from the first provider', () => {
      const emitter = new EventEmitter();
      const p1 = createMockProvider('first');
      const p2 = createMockProvider('second');

      const proxy = new FallbackImageProxy([p1, p2], emitter);
      expect(proxy.providerId).toBe('first');
    });

    it('uses fallback-image when chain is empty', () => {
      const emitter = new EventEmitter();
      const proxy = new FallbackImageProxy([], emitter);
      expect(proxy.providerId).toBe('fallback-image');
    });
  });
});

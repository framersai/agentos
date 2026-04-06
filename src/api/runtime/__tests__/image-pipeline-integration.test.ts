import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { FallbackImageProxy, type ImageFallbackEvent } from '../../../media/images/FallbackImageProxy.js';
import type { IImageProvider, ImageGenerationRequest, ImageGenerationResult } from '../../../media/images/IImageProvider.js';

function createMockProvider(id: string, shouldFail = false): IImageProvider {
  return {
    providerId: id,
    isInitialized: true,
    async initialize() {},
    async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      if (shouldFail) throw new Error(`${id} failed`);
      return {
        created: Date.now(),
        modelId: 'test-model',
        providerId: id,
        images: [{ url: `https://${id}.test/img.png` }],
        usage: { totalImages: 1 },
      };
    },
  };
}

describe('Image Pipeline Integration', () => {
  it('fallback chain tries providers in order until one succeeds', async () => {
    const emitter = new EventEmitter();
    const events: ImageFallbackEvent[] = [];
    emitter.on('image:fallback', (evt: ImageFallbackEvent) => events.push(evt));

    const proxy = new FallbackImageProxy(
      [
        createMockProvider('provider-a', true),
        createMockProvider('provider-b', true),
        createMockProvider('provider-c', false),
      ],
      emitter,
    );

    const result = await proxy.generateImage({ prompt: 'test' });

    expect(result.providerId).toBe('provider-c');
    expect(events).toHaveLength(2);
    expect(events[0].from).toBe('provider-a');
    expect(events[0].to).toBe('provider-b');
    expect(events[1].from).toBe('provider-b');
    expect(events[1].to).toBe('provider-c');
  });

  it('throws AggregateError when all providers fail', async () => {
    const emitter = new EventEmitter();
    const proxy = new FallbackImageProxy(
      [
        createMockProvider('a', true),
        createMockProvider('b', true),
      ],
      emitter,
    );

    await expect(proxy.generateImage({ prompt: 'test' })).rejects.toThrow(AggregateError);
  });

  it('passes character consistency fields through the fallback chain', async () => {
    const emitter = new EventEmitter();
    const capturedRequests: ImageGenerationRequest[] = [];

    const capturingProvider: IImageProvider = {
      providerId: 'capture',
      isInitialized: true,
      async initialize() {},
      async generateImage(request) {
        capturedRequests.push(request);
        return {
          created: Date.now(),
          modelId: 'test',
          providerId: 'capture',
          images: [{ url: 'test' }],
          usage: { totalImages: 1 },
        };
      },
    };

    const proxy = new FallbackImageProxy([capturingProvider], emitter);

    await proxy.generateImage({
      prompt: 'test',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
      faceEmbedding: [0.1, 0.2, 0.3],
    });

    expect(capturedRequests[0].referenceImageUrl).toBe('https://ref.test/face.png');
    expect(capturedRequests[0].consistencyMode).toBe('strict');
    expect(capturedRequests[0].faceEmbedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('first successful provider short-circuits the chain', async () => {
    const emitter = new EventEmitter();
    const callOrder: string[] = [];

    const trackingProvider = (id: string): IImageProvider => ({
      providerId: id,
      isInitialized: true,
      async initialize() {},
      async generateImage() {
        callOrder.push(id);
        return {
          created: Date.now(),
          modelId: 'test',
          providerId: id,
          images: [{ url: `https://${id}.test/img.png` }],
          usage: { totalImages: 1 },
        };
      },
    });

    const proxy = new FallbackImageProxy(
      [trackingProvider('first'), trackingProvider('second')],
      emitter,
    );

    await proxy.generateImage({ prompt: 'test' });

    expect(callOrder).toEqual(['first']);
  });
});

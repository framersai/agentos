/**
 * @module core/video/__tests__/ReplicateVideoProvider.test
 *
 * Unit tests for {@link ReplicateVideoProvider} (Replicate predictions API).
 *
 * Uses mocked `fetch` to simulate the Replicate create-prediction → poll flow.
 *
 * ## What is tested
 *
 * - Initialization with valid/invalid API keys and custom config
 * - Prediction creation sends correct URL, headers, and body
 * - Synchronous completion (prediction finishes within Prefer wait)
 * - Asynchronous polling when prediction is still processing
 * - Timeout during polling throws descriptive error
 * - Failed prediction throws descriptive error
 * - Canceled prediction throws descriptive error
 * - Image-to-video passes image as base64 data URL
 * - Output extraction handles string, array, and object formats
 * - Uninitialized provider rejects calls
 * - supports() returns correct capabilities
 * - shutdown resets initialization state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplicateVideoProvider } from '../providers/ReplicateVideoProvider.js';

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

describe('ReplicateVideoProvider', () => {
  let provider: ReplicateVideoProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new ReplicateVideoProvider();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  it('should initialize with a valid API key', async () => {
    await provider.initialize({ apiKey: 'r8_test_key' });
    expect(provider.isInitialized).toBe(true);
    expect(provider.providerId).toBe('replicate');
    expect(provider.defaultModelId).toBe('klingai/kling-v1');
  });

  it('should throw on initialize without API key', async () => {
    await expect(provider.initialize({})).rejects.toThrow(/requires apiKey/);
  });

  it('should throw on initialize with empty API key', async () => {
    await expect(provider.initialize({ apiKey: '' })).rejects.toThrow(/requires apiKey/);
  });

  it('should use custom defaultModelId when provided', async () => {
    await provider.initialize({ apiKey: 'key', defaultModelId: 'tencent/hunyuan-video' });
    expect(provider.defaultModelId).toBe('tencent/hunyuan-video');
  });

  // -------------------------------------------------------------------------
  // Synchronous completion (Prefer: wait)
  // -------------------------------------------------------------------------

  it('should return immediately when prediction completes synchronously', async () => {
    await provider.initialize({ apiKey: 'r8_key_123', pollIntervalMs: 1 });

    // Single call — prediction succeeds within the wait window
    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-sync',
      status: 'succeeded',
      output: 'https://replicate.delivery/video.mp4',
    }));

    const result = await provider.generateVideo({
      modelId: 'klingai/kling-v1',
      prompt: 'A sunset over the ocean',
    });

    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].url).toBe('https://replicate.delivery/video.mp4');
    expect(result.providerId).toBe('replicate');
    expect(result.modelId).toBe('klingai/kling-v1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Submission with correct headers
  // -------------------------------------------------------------------------

  it('should submit with correct URL, headers, and body', async () => {
    await provider.initialize({ apiKey: 'r8_key_xyz', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-1',
      status: 'succeeded',
      output: 'https://replicate.delivery/video.mp4',
    }));

    await provider.generateVideo({
      modelId: 'klingai/kling-v1',
      prompt: 'test prompt',
      durationSec: 5,
      aspectRatio: '16:9',
      seed: 42,
    });

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://api.replicate.com/v1/predictions');
    expect(submitOpts.headers.Authorization).toBe('Token r8_key_xyz');
    expect(submitOpts.headers['Content-Type']).toBe('application/json');
    expect(submitOpts.headers.Prefer).toBe('wait=60');

    const body = JSON.parse(submitOpts.body);
    expect(body.model).toBe('klingai/kling-v1');
    expect(body.input.prompt).toBe('test prompt');
    expect(body.input.duration).toBe(5);
    expect(body.input.aspect_ratio).toBe('16:9');
    expect(body.input.seed).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Asynchronous polling
  // -------------------------------------------------------------------------

  it('should poll when prediction is still processing', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    // Call 1: Create prediction (still processing)
    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-async',
      status: 'processing',
      urls: { get: 'https://api.replicate.com/v1/predictions/pred-async' },
    }));
    // Call 2: Poll (still processing)
    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-async',
      status: 'processing',
      urls: { get: 'https://api.replicate.com/v1/predictions/pred-async' },
    }));
    // Call 3: Poll (succeeded)
    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-async',
      status: 'succeeded',
      output: 'https://replicate.delivery/video.mp4',
    }));

    const result = await provider.generateVideo({
      modelId: 'klingai/kling-v1',
      prompt: 'async test',
    });

    expect(result.videos[0].url).toBe('https://replicate.delivery/video.mp4');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Verify polling uses the correct URL and auth
    const [pollUrl, pollOpts] = fetchSpy.mock.calls[1];
    expect(pollUrl).toBe('https://api.replicate.com/v1/predictions/pred-async');
    expect(pollOpts.headers.Authorization).toBe('Token key');
  });

  // -------------------------------------------------------------------------
  // Image-to-video
  // -------------------------------------------------------------------------

  it('should pass image as base64 data URL for image-to-video', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-i2v',
      status: 'succeeded',
      output: 'https://replicate.delivery/i2v.mp4',
    }));

    const imageBuffer = Buffer.from('fake-image-bytes');

    const result = await provider.imageToVideo({
      modelId: 'klingai/kling-v1',
      prompt: 'animate this photo',
      image: imageBuffer,
      durationSec: 5,
    });

    expect(result.videos[0].url).toBe('https://replicate.delivery/i2v.mp4');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.input.image).toContain('data:image/png;base64,');
    expect(body.input.prompt).toBe('animate this photo');
    expect(body.input.duration).toBe(5);
  });

  it('should throw when imageToVideo called while not initialized', async () => {
    const imageBuffer = Buffer.from('fake-image-bytes');
    await expect(
      provider.imageToVideo({
        modelId: 'klingai/kling-v1',
        prompt: 'test',
        image: imageBuffer,
      }),
    ).rejects.toThrow(/not initialized/);
  });

  // -------------------------------------------------------------------------
  // Output extraction
  // -------------------------------------------------------------------------

  it('should extract video URL from array output', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-arr',
      status: 'succeeded',
      output: ['https://replicate.delivery/video.mp4'],
    }));

    const result = await provider.generateVideo({
      modelId: 'klingai/kling-v1',
      prompt: 'array output',
    });

    expect(result.videos[0].url).toBe('https://replicate.delivery/video.mp4');
  });

  it('should extract video URL from object output with url property', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-obj',
      status: 'succeeded',
      output: { url: 'https://replicate.delivery/video.mp4' },
    }));

    const result = await provider.generateVideo({
      modelId: 'klingai/kling-v1',
      prompt: 'object output',
    });

    expect(result.videos[0].url).toBe('https://replicate.delivery/video.mp4');
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('should throw on failed prediction', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-fail',
      status: 'failed',
      error: 'Model execution failed: out of memory',
    }));

    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'fail' }),
    ).rejects.toThrow(/Replicate video generation failed.*out of memory/);
  });

  it('should throw on canceled prediction', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-cancel',
      status: 'canceled',
    }));

    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'cancel' }),
    ).rejects.toThrow(/canceled/);
  });

  it('should throw on submission HTTP error', async () => {
    await provider.initialize({ apiKey: 'key' });

    fetchSpy.mockResolvedValueOnce(mockResponse({ detail: 'unauthorized' }, false, 401));

    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'fail' }),
    ).rejects.toThrow(/submission failed \(401\)/);
  });

  it('should throw when not initialized', async () => {
    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'fail' }),
    ).rejects.toThrow(/not initialized/);
  });

  it('should throw on timeout', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1, timeoutMs: 10 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({
        id: 'pred-slow',
        status: 'processing',
        urls: { get: 'https://api.replicate.com/v1/predictions/pred-slow' },
      }))
      .mockResolvedValue(mockResponse({
        id: 'pred-slow',
        status: 'processing',
        urls: { get: 'https://api.replicate.com/v1/predictions/pred-slow' },
      }));

    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'slow' }),
    ).rejects.toThrow(/timed out/);
  });

  it('should throw when prediction succeeds but has no output', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'pred-empty',
      status: 'succeeded',
      output: null,
    }));

    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'empty' }),
    ).rejects.toThrow(/no video output/);
  });

  it('should throw on polling HTTP error', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({
        id: 'pred-poll-err',
        status: 'processing',
        urls: { get: 'https://api.replicate.com/v1/predictions/pred-poll-err' },
      }))
      .mockResolvedValueOnce(mockResponse({ detail: 'server error' }, false, 500));

    await expect(
      provider.generateVideo({ modelId: 'klingai/kling-v1', prompt: 'poll error' }),
    ).rejects.toThrow(/polling failed \(500\)/);
  });

  // -------------------------------------------------------------------------
  // supports()
  // -------------------------------------------------------------------------

  it('should report support for text-to-video', () => {
    expect(provider.supports('text-to-video')).toBe(true);
  });

  it('should report support for image-to-video', () => {
    expect(provider.supports('image-to-video')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // shutdown
  // -------------------------------------------------------------------------

  it('should reset initialization state on shutdown', async () => {
    await provider.initialize({ apiKey: 'key' });
    expect(provider.isInitialized).toBe(true);

    await provider.shutdown();
    expect(provider.isInitialized).toBe(false);
  });
});

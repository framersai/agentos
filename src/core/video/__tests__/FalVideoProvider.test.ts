/**
 * @module core/video/__tests__/FalVideoProvider.test
 *
 * Unit tests for {@link FalVideoProvider} (Fal.ai queue API).
 *
 * Uses mocked `fetch` to simulate the Fal.ai three-step queue flow:
 * submit → poll status → fetch result.
 *
 * ## What is tested
 *
 * - Initialization with valid/invalid API keys and custom config
 * - Task submission sends correct URL, headers, and body
 * - Status polling retries until COMPLETED
 * - Result fetching returns correct video URL
 * - FAILED status during polling throws descriptive error
 * - Timeout during polling throws descriptive error
 * - Image-to-video passes image_url in request body
 * - Empty result throws descriptive error
 * - Uninitialized provider rejects calls
 * - supports() returns correct capabilities
 * - shutdown resets initialization state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalVideoProvider } from '../providers/FalVideoProvider.js';

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

describe('FalVideoProvider', () => {
  let provider: FalVideoProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new FalVideoProvider();
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
    await provider.initialize({ apiKey: 'fal_test_key' });
    expect(provider.isInitialized).toBe(true);
    expect(provider.providerId).toBe('fal');
    expect(provider.defaultModelId).toBe('kling-video/v1');
  });

  it('should throw on initialize without API key', async () => {
    await expect(provider.initialize({})).rejects.toThrow(/requires apiKey/);
  });

  it('should throw on initialize with empty API key', async () => {
    await expect(provider.initialize({ apiKey: '' })).rejects.toThrow(/requires apiKey/);
  });

  it('should use custom defaultModelId when provided', async () => {
    await provider.initialize({ apiKey: 'key', defaultModelId: 'fal-ai/hunyuan-video' });
    expect(provider.defaultModelId).toBe('fal-ai/hunyuan-video');
  });

  it('should use custom baseURL and poll interval when provided', async () => {
    await provider.initialize({
      apiKey: 'key',
      baseURL: 'https://custom.fal.run',
      pollIntervalMs: 500,
      timeoutMs: 60000,
    });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-1' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({
        video: { url: 'https://fal.ai/output/video.mp4' },
      }));

    await provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'test' });

    const [submitUrl] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://custom.fal.run/kling-video/v1');
  });

  // -------------------------------------------------------------------------
  // Full generation flow (submit -> poll -> fetch)
  // -------------------------------------------------------------------------

  it('should complete the full submit -> poll -> fetch flow', async () => {
    await provider.initialize({ apiKey: 'fal_key_123', pollIntervalMs: 1 });

    // Call 1: Submit
    fetchSpy.mockResolvedValueOnce(mockResponse({ request_id: 'req-abc' }));
    // Call 2: Poll (IN_PROGRESS)
    fetchSpy.mockResolvedValueOnce(mockResponse({ status: 'IN_PROGRESS' }));
    // Call 3: Poll (COMPLETED)
    fetchSpy.mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }));
    // Call 4: Fetch result
    fetchSpy.mockResolvedValueOnce(mockResponse({
      video: {
        url: 'https://fal.ai/output/video.mp4',
        content_type: 'video/mp4',
        duration: 5,
      },
      seed: 42,
    }));

    const result = await provider.generateVideo({
      modelId: 'kling-video/v1',
      prompt: 'beautiful landscape timelapse',
    });

    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].url).toBe('https://fal.ai/output/video.mp4');
    expect(result.videos[0].mimeType).toBe('video/mp4');
    expect(result.videos[0].durationSec).toBe(5);
    expect(result.modelId).toBe('kling-video/v1');
    expect(result.providerId).toBe('fal');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  it('should submit with correct URL and auth header', async () => {
    await provider.initialize({ apiKey: 'fal_key_xyz', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-1' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({
        video: { url: 'https://example.com/video.mp4' },
      }));

    await provider.generateVideo({
      modelId: 'fal-ai/hunyuan-video',
      prompt: 'test prompt',
      durationSec: 10,
      aspectRatio: '16:9',
      seed: 42,
    });

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://queue.fal.run/fal-ai/hunyuan-video');
    expect(submitOpts.headers.Authorization).toBe('Key fal_key_xyz');
    expect(submitOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(submitOpts.body);
    expect(body.prompt).toBe('test prompt');
    expect(body.duration).toBe(10);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.seed).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Image-to-video
  // -------------------------------------------------------------------------

  it('should pass image_url in body for image-to-video', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-i2v' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({
        video: { url: 'https://fal.ai/output/i2v.mp4' },
      }));

    const imageBuffer = Buffer.from('fake-image-data');

    const result = await provider.imageToVideo({
      modelId: 'kling-video/v1',
      prompt: 'animate this photo',
      image: imageBuffer,
      durationSec: 5,
    });

    expect(result.videos[0].url).toBe('https://fal.ai/output/i2v.mp4');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.image_url).toContain('data:image/png;base64,');
    expect(body.prompt).toBe('animate this photo');
    expect(body.duration).toBe(5);
  });

  it('should throw when imageToVideo called while not initialized', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    await expect(
      provider.imageToVideo({
        modelId: 'kling-video/v1',
        prompt: 'test',
        image: imageBuffer,
      }),
    ).rejects.toThrow(/not initialized/);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('should throw on FAILED status during polling', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-fail' }))
      .mockResolvedValueOnce(mockResponse({ status: 'FAILED' }));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'fail' }),
    ).rejects.toThrow(/Fal\.ai video generation failed/);
  });

  it('should throw on submission HTTP error', async () => {
    await provider.initialize({ apiKey: 'key' });

    fetchSpy.mockResolvedValueOnce(mockResponse({ error: 'unauthorized' }, false, 403));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'fail' }),
    ).rejects.toThrow(/submission failed \(403\)/);
  });

  it('should throw when not initialized', async () => {
    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'fail' }),
    ).rejects.toThrow(/not initialized/);
  });

  it('should throw on timeout', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1, timeoutMs: 10 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-slow' }))
      .mockResolvedValue(mockResponse({ status: 'IN_QUEUE' }));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'slow' }),
    ).rejects.toThrow(/timed out/);
  });

  it('should throw when result has no video', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-empty' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ video: null }));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'empty' }),
    ).rejects.toThrow(/no video output/);
  });

  it('should throw on polling HTTP error', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-poll-err' }))
      .mockResolvedValueOnce(mockResponse({ error: 'server error' }, false, 500));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'poll error' }),
    ).rejects.toThrow(/polling failed \(500\)/);
  });

  it('should throw on result fetch HTTP error', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-fetch-err' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ error: 'not found' }, false, 404));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'fetch error' }),
    ).rejects.toThrow(/result fetch failed \(404\)/);
  });

  it('should throw when submission response missing request_id', async () => {
    await provider.initialize({ apiKey: 'key' });

    fetchSpy.mockResolvedValueOnce(mockResponse({}));

    await expect(
      provider.generateVideo({ modelId: 'kling-video/v1', prompt: 'no id' }),
    ).rejects.toThrow(/missing request_id/);
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

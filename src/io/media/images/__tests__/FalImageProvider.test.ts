/**
 * @module media/images/__tests__/FalImageProvider.spec
 *
 * Unit tests for {@link FalImageProvider} (Fal.ai queue API).
 *
 * Uses mocked `fetch` to simulate the Fal.ai queue-based
 * submit → poll → fetch-result flow.
 *
 * ## What is tested
 *
 * - Initialization with valid/invalid API keys
 * - Task submission sends correct URL, headers, and body
 * - Status polling retries until COMPLETED
 * - Result fetching returns correct image URLs
 * - FAILED status during polling throws descriptive error
 * - Timeout during polling throws descriptive error
 * - Provider-specific options are forwarded
 * - Multiple images are returned correctly
 * - Uninitialized provider rejects generateImage
 * - listAvailableModels returns known models
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalImageProvider } from '../providers/FalImageProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchSpy = ReturnType<typeof vi.fn>;

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

describe('FalImageProvider', () => {
  let provider: FalImageProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new FalImageProvider();
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
    expect(provider.defaultModelId).toBe('fal-ai/flux/dev');
  });

  it('should throw on initialize without API key', async () => {
    await expect(provider.initialize({})).rejects.toThrow(/requires apiKey/);
  });

  it('should throw on initialize with empty API key', async () => {
    await expect(provider.initialize({ apiKey: '' })).rejects.toThrow(/requires apiKey/);
  });

  it('should use custom defaultModelId when provided', async () => {
    await provider.initialize({ apiKey: 'key', defaultModelId: 'fal-ai/flux-pro' });
    expect(provider.defaultModelId).toBe('fal-ai/flux-pro');
  });

  // -------------------------------------------------------------------------
  // Full generation flow (submit -> poll -> fetch result)
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
      images: [
        { url: 'https://fal.ai/output/img1.png', width: 1024, height: 768, content_type: 'image/png' },
      ],
      seed: 42,
    }));

    const result = await provider.generateImage({
      modelId: 'fal-ai/flux/dev',
      prompt: 'beautiful landscape',
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://fal.ai/output/img1.png');
    expect(result.images[0].mimeType).toBe('image/png');
    expect(result.modelId).toBe('fal-ai/flux/dev');
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
        images: [{ url: 'https://example.com/img.png' }],
      }));

    await provider.generateImage({
      modelId: 'fal-ai/flux-pro',
      prompt: 'test prompt',
    });

    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://queue.fal.run/fal-ai/flux-pro');
    expect(submitOpts.headers.Authorization).toBe('Key fal_key_xyz');
    expect(submitOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(submitOpts.body);
    expect(body.prompt).toBe('test prompt');
  });

  // -------------------------------------------------------------------------
  // Multiple images
  // -------------------------------------------------------------------------

  it('should return multiple images when generated', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-multi' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({
        images: [
          { url: 'https://fal.ai/img1.png' },
          { url: 'https://fal.ai/img2.png' },
        ],
      }));

    const result = await provider.generateImage({
      modelId: 'fal-ai/flux/dev',
      prompt: 'two cats',
      n: 2,
    });

    expect(result.images).toHaveLength(2);
    expect(result.images[0].url).toBe('https://fal.ai/img1.png');
    expect(result.images[1].url).toBe('https://fal.ai/img2.png');
    expect(result.usage?.totalImages).toBe(2);
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
      provider.generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'fail' }),
    ).rejects.toThrow(/Fal\.ai image generation failed/);
  });

  it('should throw on submission HTTP error', async () => {
    await provider.initialize({ apiKey: 'key' });

    fetchSpy.mockResolvedValueOnce(mockResponse({ error: 'unauthorized' }, false, 403));

    await expect(
      provider.generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'fail' }),
    ).rejects.toThrow(/submission failed \(403\)/);
  });

  it('should throw when not initialized', async () => {
    await expect(
      provider.generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'fail' }),
    ).rejects.toThrow(/not initialized/);
  });

  it('should throw on timeout', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1, timeoutMs: 10 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-slow' }))
      .mockResolvedValue(mockResponse({ status: 'IN_QUEUE' }));

    await expect(
      provider.generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'slow' }),
    ).rejects.toThrow(/timed out/);
  });

  it('should throw when result has no images', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-empty' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({ images: [] }));

    await expect(
      provider.generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'empty' }),
    ).rejects.toThrow(/returned no images/);
  });

  // -------------------------------------------------------------------------
  // Provider-specific options
  // -------------------------------------------------------------------------

  it('should forward provider-specific options to the request body', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ request_id: 'req-opts' }))
      .mockResolvedValueOnce(mockResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(mockResponse({
        images: [{ url: 'https://example.com/img.png' }],
      }));

    await provider.generateImage({
      modelId: 'fal-ai/flux/dev',
      prompt: 'test',
      providerOptions: {
        fal: {
          num_images: 3,
          seed: 42,
          num_inference_steps: 28,
          guidance_scale: 7.5,
          enable_safety_checker: false,
        },
      },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.num_images).toBe(3);
    expect(body.seed).toBe(42);
    expect(body.num_inference_steps).toBe(28);
    expect(body.guidance_scale).toBe(7.5);
    expect(body.enable_safety_checker).toBe(false);
  });

  // -------------------------------------------------------------------------
  // listAvailableModels
  // -------------------------------------------------------------------------

  it('should return known Fal.ai models', async () => {
    const models = await provider.listAvailableModels();
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.map((m) => m.modelId)).toContain('fal-ai/flux/dev');
    expect(models.map((m) => m.modelId)).toContain('fal-ai/flux-pro');
    expect(models.map((m) => m.modelId)).toContain('fal-ai/flux/schnell');
  });
});

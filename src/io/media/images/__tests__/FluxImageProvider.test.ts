/**
 * @module media/images/__tests__/FluxImageProvider.spec
 *
 * Unit tests for {@link FluxImageProvider} (BFL direct API).
 *
 * Uses mocked `fetch` to simulate the BFL async submit-then-poll flow.
 *
 * ## What is tested
 *
 * - Initialization with valid/invalid API keys
 * - Task submission sends correct headers and body
 * - Polling loop retries until 'Ready' status
 * - Successful generation returns correct image result
 * - Error status during polling throws descriptive error
 * - Timeout during polling throws descriptive error
 * - Provider-specific options (steps, guidance, seed) are forwarded
 * - Uninitialized provider rejects generateImage
 * - listAvailableModels returns known models
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FluxImageProvider } from '../providers/FluxImageProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience type for the mock fetch spy. */
type FetchSpy = ReturnType<typeof vi.fn>;

/**
 * Create a mock Response-like object for fetch.
 * @param body - JSON-serializable body.
 * @param ok - Whether the response is successful.
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

describe('FluxImageProvider', () => {
  let provider: FluxImageProvider;
  let fetchSpy: FetchSpy;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new FluxImageProvider();
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
    await provider.initialize({ apiKey: 'bfl_test_key' });
    expect(provider.isInitialized).toBe(true);
    expect(provider.providerId).toBe('bfl');
    expect(provider.defaultModelId).toBe('flux-pro-1.1');
  });

  it('should throw on initialize without API key', async () => {
    await expect(provider.initialize({})).rejects.toThrow(/requires apiKey/);
  });

  it('should throw on initialize with empty API key', async () => {
    await expect(provider.initialize({ apiKey: '  ' })).rejects.toThrow(/requires apiKey/);
  });

  it('should use custom defaultModelId when provided', async () => {
    await provider.initialize({ apiKey: 'key', defaultModelId: 'flux-dev' });
    expect(provider.defaultModelId).toBe('flux-dev');
  });

  // -------------------------------------------------------------------------
  // Task submission
  // -------------------------------------------------------------------------

  it('should submit task with correct URL, headers, and body', async () => {
    await provider.initialize({ apiKey: 'bfl_key_123' });

    // Mock: submission returns task ID, then first poll returns Ready
    fetchSpy
      .mockResolvedValueOnce(mockResponse({ id: 'task-abc' }))
      .mockResolvedValueOnce(mockResponse({
        id: 'task-abc',
        status: 'Ready',
        result: { sample: 'https://images.bfl.ml/output.png', seed: 42 },
      }));

    await provider.generateImage({
      modelId: 'flux-pro-1.1',
      prompt: 'test prompt',
      size: '1024x768',
    });

    // Verify submission call
    const [submitUrl, submitOpts] = fetchSpy.mock.calls[0];
    expect(submitUrl).toBe('https://api.bfl.ml/v1/flux-pro-1.1');
    expect(submitOpts.method).toBe('POST');
    expect(submitOpts.headers['X-Key']).toBe('bfl_key_123');
    expect(submitOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(submitOpts.body);
    expect(body.prompt).toBe('test prompt');
    expect(body.width).toBe(1024);
    expect(body.height).toBe(768);
  });

  // -------------------------------------------------------------------------
  // Polling and success
  // -------------------------------------------------------------------------

  it('should poll until Ready and return the image URL', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    // Submit -> Pending -> Pending -> Ready
    fetchSpy
      .mockResolvedValueOnce(mockResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(mockResponse({ id: 'task-1', status: 'Pending' }))
      .mockResolvedValueOnce(mockResponse({ id: 'task-1', status: 'Pending' }))
      .mockResolvedValueOnce(mockResponse({
        id: 'task-1',
        status: 'Ready',
        result: { sample: 'https://images.bfl.ml/result.png', seed: 123 },
      }));

    const result = await provider.generateImage({
      modelId: 'flux-pro-1.1',
      prompt: 'beautiful landscape',
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0].url).toBe('https://images.bfl.ml/result.png');
    expect(result.modelId).toBe('flux-pro-1.1');
    expect(result.providerId).toBe('bfl');
    expect(result.images[0].providerMetadata?.seed).toBe(123);
    // 4 fetch calls: 1 submit + 3 polls
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('should throw on Error status during polling', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ id: 'task-err' }))
      .mockResolvedValueOnce(mockResponse({ id: 'task-err', status: 'Error' }));

    await expect(
      provider.generateImage({ modelId: 'flux-dev', prompt: 'fail' }),
    ).rejects.toThrow(/BFL image generation failed/);
  });

  it('should throw on submission HTTP error', async () => {
    await provider.initialize({ apiKey: 'key' });

    fetchSpy.mockResolvedValueOnce(mockResponse({ error: 'invalid key' }, false, 401));

    await expect(
      provider.generateImage({ modelId: 'flux-dev', prompt: 'fail' }),
    ).rejects.toThrow(/submission failed \(401\)/);
  });

  it('should throw when not initialized', async () => {
    await expect(
      provider.generateImage({ modelId: 'flux-dev', prompt: 'fail' }),
    ).rejects.toThrow(/not initialized/);
  });

  it('should throw on timeout', async () => {
    // Use very short timeout so test doesn't actually wait long
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1, timeoutMs: 10 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ id: 'task-slow' }))
      .mockResolvedValue(mockResponse({ id: 'task-slow', status: 'Pending' }));

    await expect(
      provider.generateImage({ modelId: 'flux-dev', prompt: 'slow' }),
    ).rejects.toThrow(/timed out/);
  });

  // -------------------------------------------------------------------------
  // Provider-specific options
  // -------------------------------------------------------------------------

  it('should forward steps, guidance, and seed from providerOptions', async () => {
    await provider.initialize({ apiKey: 'key', pollIntervalMs: 1 });

    fetchSpy
      .mockResolvedValueOnce(mockResponse({ id: 'task-opts' }))
      .mockResolvedValueOnce(mockResponse({
        id: 'task-opts',
        status: 'Ready',
        result: { sample: 'https://example.com/img.png' },
      }));

    await provider.generateImage({
      modelId: 'flux-pro-1.1',
      prompt: 'test',
      providerOptions: {
        bfl: { steps: 30, guidance: 3.5, seed: 42 },
      },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.steps).toBe(30);
    expect(body.guidance).toBe(3.5);
    expect(body.seed).toBe(42);
  });

  // -------------------------------------------------------------------------
  // listAvailableModels
  // -------------------------------------------------------------------------

  it('should return known BFL models', async () => {
    const models = await provider.listAvailableModels();
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.map((m) => m.modelId)).toContain('flux-pro-1.1');
    expect(models.map((m) => m.modelId)).toContain('flux-dev');
  });
});

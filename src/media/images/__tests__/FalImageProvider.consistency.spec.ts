import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FalImageProvider } from '../providers/FalImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSubmit() {
  return { ok: true, json: async () => ({ request_id: 'req_1' }), text: async () => '' };
}
function mockStatus() {
  return { ok: true, json: async () => ({ status: 'COMPLETED' }), text: async () => '' };
}
function mockResult() {
  return { ok: true, json: async () => ({ images: [{ url: 'https://fal.test/out.png' }] }), text: async () => '' };
}

describe('FalImageProvider — Character Consistency', () => {
  let provider: FalImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new FalImageProvider();
    await provider.initialize({ apiKey: 'fal_test', pollIntervalMs: 1, timeoutMs: 5000 });
  });

  it('maps referenceImageUrl to ip_adapter_image', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_image).toBe('https://ref.test/face.png');
  });

  it('sets ip_adapter_scale to 0.9 for strict mode', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_scale).toBe(0.9);
  });

  it('sets ip_adapter_scale to 0.3 for loose mode', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'loose',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_scale).toBe(0.3);
  });

  it('defaults to balanced (0.6) when consistencyMode not specified', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_scale).toBe(0.6);
  });

  it('does not set ip_adapter fields when no referenceImageUrl', async () => {
    mockFetch.mockResolvedValueOnce(mockSubmit()).mockResolvedValueOnce(mockStatus()).mockResolvedValueOnce(mockResult());

    await provider.generateImage({ prompt: 'no ref' });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.ip_adapter_image).toBeUndefined();
    expect(submitBody.ip_adapter_scale).toBeUndefined();
  });
});

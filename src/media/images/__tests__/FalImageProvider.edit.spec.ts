import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FalImageProvider } from '../providers/FalImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSubmit() {
  return { ok: true, json: async () => ({ request_id: 'req_123' }), text: async () => '' };
}
function mockStatus(status = 'COMPLETED') {
  return { ok: true, json: async () => ({ status }), text: async () => '' };
}
function mockResult(images = [{ url: 'https://fal.test/out.png', width: 1024, height: 1024 }]) {
  return { ok: true, json: async () => ({ images }), text: async () => '' };
}

describe('FalImageProvider — editImage', () => {
  let provider: FalImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new FalImageProvider();
    await provider.initialize({ apiKey: 'fal_test', pollIntervalMs: 1, timeoutMs: 5000 });
  });

  it('performs img2img with strength parameter', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSubmit())
      .mockResolvedValueOnce(mockStatus())
      .mockResolvedValueOnce(mockResult());

    const result = await provider.editImage({
      modelId: 'fal-ai/flux/dev',
      image: Buffer.from('fake'),
      prompt: 'oil painting style',
      strength: 0.65,
    });

    expect(result.images).toHaveLength(1);
    expect(result.providerId).toBe('fal');
    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.image).toBeDefined();
    expect(submitBody.strength).toBe(0.65);
  });

  it('defaults strength to 0.75 when not specified', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSubmit())
      .mockResolvedValueOnce(mockStatus())
      .mockResolvedValueOnce(mockResult());

    await provider.editImage({
      modelId: 'fal-ai/flux/dev',
      image: Buffer.from('fake'),
      prompt: 'test',
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.strength).toBe(0.75);
  });

  it('passes mask as base64 data URL when provided', async () => {
    mockFetch
      .mockResolvedValueOnce(mockSubmit())
      .mockResolvedValueOnce(mockStatus())
      .mockResolvedValueOnce(mockResult());

    await provider.editImage({
      modelId: 'fal-ai/flux/dev',
      image: Buffer.from('fake-image'),
      prompt: 'fill area',
      mask: Buffer.from('fake-mask'),
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.mask).toContain('data:image/png;base64,');
  });

  it('throws when not initialized', async () => {
    const uninit = new FalImageProvider();
    await expect(
      uninit.editImage({ modelId: '', image: Buffer.from('x'), prompt: 'test' })
    ).rejects.toThrow('not initialized');
  });

  describe('listAvailableModels', () => {
    it('returns at least 7 models with descriptions', async () => {
      const models = await provider.listAvailableModels();
      expect(models.length).toBeGreaterThanOrEqual(7);
      expect(models.every(m => m.providerId === 'fal')).toBe(true);
      expect(models.every(m => !!m.description)).toBe(true);
    });
  });
});

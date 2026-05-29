import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StableDiffusionLocalProvider } from '../providers/StableDiffusionLocalProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('StableDiffusionLocalProvider — Character Consistency', () => {
  let provider: StableDiffusionLocalProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Probe responses: A1111 detected
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ([]) });
    provider = new StableDiffusionLocalProvider();
    await provider.initialize({ baseURL: 'http://localhost:7860' });
  });

  it('injects IP-Adapter ControlNet when referenceImageUrl is set with strict mode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64data'] }),
    });

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
    });

    // The generate call is the second mockFetch call (after probe)
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.alwayson_scripts?.controlnet?.args).toBeDefined();
    const cnArg = body.alwayson_scripts.controlnet.args[0];
    expect(cnArg.input_image).toBe('https://ref.test/face.png');
    expect(cnArg.module).toContain('ip-adapter');
    expect(cnArg.weight).toBe(0.9);
  });

  it('uses weight 0.6 for balanced mode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64data'] }),
    });

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'balanced',
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.alwayson_scripts.controlnet.args[0].weight).toBe(0.6);
  });

  it('does not inject ControlNet when no referenceImageUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64data'] }),
    });

    await provider.generateImage({ prompt: 'no ref' });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.alwayson_scripts?.controlnet).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicateImageProvider } from '../providers/ReplicateImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSuccess(output: unknown = ['https://example.com/img.png']) {
  return { ok: true, json: async () => ({ id: 'p1', status: 'succeeded', output }), text: async () => '', headers: new Headers() };
}

describe('ReplicateImageProvider — Character Consistency', () => {
  let provider: ReplicateImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new ReplicateImageProvider();
    await provider.initialize({ apiKey: 'test-key' });
  });

  it('auto-selects Pulid when consistencyMode is strict and no model specified', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'strict',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('zsxkib/pulid');
  });

  it('maps referenceImageUrl to main_face_image for Pulid models', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'zsxkib/pulid',
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.main_face_image).toBe('https://ref.test/face.png');
  });

  it('maps referenceImageUrl to image for Flux Redux models', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-redux-dev',
      prompt: 'style transfer',
      referenceImageUrl: 'https://ref.test/style.png',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.image).toBe('https://ref.test/style.png');
  });

  it('sets image_strength based on consistencyMode for standard Flux models', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-dev',
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
      consistencyMode: 'loose',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.image).toBe('https://ref.test/face.png');
    expect(body.input.image_strength).toBe(0.3);
  });

  it('uses balanced strength (0.6) by default', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-dev',
      prompt: 'portrait',
      referenceImageUrl: 'https://ref.test/face.png',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.image_strength).toBe(0.6);
  });

  it('maps controlImage to control_image for Canny model', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      modelId: 'black-forest-labs/flux-canny-dev',
      prompt: 'guided generation',
      providerOptions: {
        replicate: { controlImage: 'https://ref.test/edges.png' },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.control_image).toBe('https://ref.test/edges.png');
  });

  it('auto-routes to Canny model when controlType is canny and no model set', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({
      prompt: 'edge-guided',
      providerOptions: {
        replicate: {
          controlImage: 'https://ref.test/edges.png',
          controlType: 'canny' as const,
        },
      },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('flux-canny-dev');
  });

  it('ignores referenceImageUrl when not provided', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccess());

    await provider.generateImage({ prompt: 'no ref' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.main_face_image).toBeUndefined();
    expect(body.input.image).toBeUndefined();
    expect(body.input.image_strength).toBeUndefined();
  });
});

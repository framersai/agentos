import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicateSegmentationProvider } from '../providers/ReplicateSegmentationProvider.js';
import type { SegmentationRequest } from '../types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** A 12x10 black PNG with a white 4x3 rect at (2,1), as a data-URL mask ref. */
async function maskDataUrl(): Promise<string> {
  const sharp = (await import('sharp')).default;
  const overlay = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const png = await sharp({ create: { width: 12, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: overlay, left: 2, top: 1 }]).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** A 12x10 source image (so width/height come back correctly). */
async function sourceImage(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 12, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

describe('ReplicateSegmentationProvider', () => {
  let provider: ReplicateSegmentationProvider;
  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new ReplicateSegmentationProvider();
    await provider.initialize({ apiKey: 'test-key' });
  });

  it('reports all four supported modes', () => {
    expect(provider.supportedModes()).toEqual(['text', 'points', 'box', 'automatic']);
  });

  it('box mode: hits modern endpoint and maps box to [x1,y1,x2,y2]', async () => {
    const url = await maskDataUrl();
    mockFetch.mockResolvedValueOnce(ok({ id: 'p1', status: 'succeeded', output: [url] }));

    const req: SegmentationRequest = {
      modelId: 'meta/sam-2',
      image: await sourceImage(),
      mode: 'box',
      box: { x: 2, y: 1, width: 4, height: 3 },
    };
    const result = await provider.segment(req);

    const [calledUrl, opts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.replicate.com/v1/models/meta/sam-2/predictions');
    expect(opts.headers.Authorization).toBe('Token test-key');
    const body = JSON.parse(opts.body);
    expect(body.input.box).toEqual([2, 1, 6, 4]);
    expect(typeof body.input.image).toBe('string');

    expect(result.width).toBe(12);
    expect(result.height).toBe(10);
    expect(result.promptMode).toBe('box');
    expect(result.masks).toHaveLength(1);
    expect(result.masks[0].bbox).toEqual({ x: 2, y: 1, width: 4, height: 3 });
    expect(result.masks[0].score).toBe(1);
    expect(result.masks[0].index).toBe(0);
  });

  it('text mode: sends text_prompt and surfaces label/score from object output', async () => {
    const url = await maskDataUrl();
    mockFetch.mockResolvedValueOnce(ok({
      id: 'p2', status: 'succeeded',
      output: { masks: [{ mask: url, score: 0.91, label: 'chair' }] },
    }));

    const result = await provider.segment({
      modelId: 'grounded/sam', image: await sourceImage(), mode: 'text', prompt: 'chair',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.text_prompt).toBe('chair');
    expect(result.masks[0].label).toBe('chair');
    expect(result.masks[0].score).toBeCloseTo(0.91);
  });

  it('points mode: maps coordinates and labels', async () => {
    const url = await maskDataUrl();
    mockFetch.mockResolvedValueOnce(ok({ id: 'p3', status: 'succeeded', output: [url] }));

    await provider.segment({
      modelId: 'meta/sam-2', image: await sourceImage(), mode: 'points',
      points: [{ x: 5, y: 4, label: 'foreground' }, { x: 1, y: 1, label: 'background' }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.points).toEqual([[5, 4], [1, 1]]);
    expect(body.input.point_labels).toEqual([1, 0]);
  });
});

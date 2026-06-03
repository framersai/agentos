import { describe, it, expect, beforeEach } from 'vitest';
import { segment } from '../../../api/segment.js';
import { maskToEditMask } from '../consumers/maskToEditMask.js';
import { cropRegion } from '../consumers/cropRegion.js';
import { registerSegmentationProvider, resetSegmentationProviders } from '../SegmentationProviderRegistry.js';
import type { ISegmentationProvider, SegmentMask } from '../types.js';

async function fakeMask(): Promise<SegmentMask> {
  const sharp = (await import('sharp')).default;
  const overlay = await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: overlay, left: 5, top: 4 }]).png().toBuffer();
  return { mask: png, bbox: { x: 5, y: 4, width: 6, height: 6 }, score: 1, index: 0 };
}

describe('segmentation round-trips', () => {
  beforeEach(() => resetSegmentationProviders());

  it('segment -> maskToEditMask -> valid editImage mask; segment -> cropRegion -> valid cutout', async () => {
    const mask = await fakeMask();
    const provider: ISegmentationProvider = {
      providerId: 'fake', isInitialized: true, defaultModelId: 'fake/model',
      async initialize() {},
      supportedModes() { return ['box']; },
      async segment() {
        return { masks: [mask], width: 16, height: 16, providerId: 'fake', modelId: 'fake/model', promptMode: 'box', durationMs: 0 };
      },
    };
    registerSegmentationProvider('fake', provider);

    const sharp = (await import('sharp')).default;
    const source = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer();

    const res = await segment({ image: source, provider: 'fake', box: { x: 5, y: 4, width: 6, height: 6 } });
    expect(res.masks).toHaveLength(1);

    const editMask = await maskToEditMask(res.masks);
    const editMeta = await sharp(editMask).metadata();
    expect(editMeta.width).toBe(16);
    expect(editMeta.height).toBe(16);

    const cutout = await cropRegion(source, res.masks[0]);
    const cutMeta = await sharp(cutout).metadata();
    expect(cutMeta.width).toBe(6);
    expect(cutMeta.channels).toBe(4);
  });
});

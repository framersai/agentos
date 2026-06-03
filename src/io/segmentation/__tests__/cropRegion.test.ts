import { describe, it, expect } from 'vitest';
import { cropRegion } from '../consumers/cropRegion.js';
import type { SegmentMask } from '../types.js';

async function setup(): Promise<{ source: Buffer; mask: SegmentMask }> {
  const sharp = (await import('sharp')).default;
  const source = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();
  const overlay = await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const maskPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: overlay, left: 5, top: 4 }]).png().toBuffer();
  return { source, mask: { mask: maskPng, bbox: { x: 5, y: 4, width: 6, height: 6 }, score: 1, index: 0 } };
}

describe('cropRegion', () => {
  it('crops to the bbox and produces an RGBA cutout', async () => {
    const { source, mask } = await setup();
    const out = await cropRegion(source, mask);
    const sharp = (await import('sharp')).default;
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(6);
    expect(meta.height).toBe(6);
    expect(meta.channels).toBe(4); // has alpha

    // Center pixel (inside mask) is opaque.
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(3, 3)).toBeGreaterThan(200);
  });

  it('clamps padding at the image edge without overshooting', async () => {
    const sharp = (await import('sharp')).default;
    const source = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    const overlay = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const maskPng = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: overlay, left: 1, top: 1 }]).png().toBuffer();
    const mask: SegmentMask = { mask: maskPng, bbox: { x: 1, y: 1, width: 4, height: 4 }, score: 1, index: 0 };

    // bbox [1,1,4,4] + pad 5 -> region clamped to [0,0)..[10,10) at the top-left edge.
    const out = await cropRegion(source, mask, { pad: 5 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(10);
    expect(meta.height).toBe(10);
  });
});

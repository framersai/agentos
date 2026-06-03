import { describe, it, expect } from 'vitest';
import { maskToEditMask } from '../consumers/maskToEditMask.js';
import type { SegmentMask } from '../types.js';

async function whiteRectMask(W: number, H: number, rect: { x: number; y: number; w: number; h: number }): Promise<SegmentMask> {
  const sharp = (await import('sharp')).default;
  const overlay = await sharp({ create: { width: rect.w, height: rect.h, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: overlay, left: rect.x, top: rect.y }]).png().toBuffer();
  return { mask: png, bbox: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, score: 1, index: 0 };
}

/** Read the luma at (x,y) from a PNG buffer. */
async function lumaAt(png: Buffer, x: number, y: number): Promise<number> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels];
}

describe('maskToEditMask', () => {
  it('target=object keeps the object white (edit region)', async () => {
    const m = await whiteRectMask(16, 16, { x: 4, y: 4, w: 6, h: 6 });
    const out = await maskToEditMask(m, { target: 'object' });
    expect(await lumaAt(out, 6, 6)).toBeGreaterThan(200);  // inside object
    expect(await lumaAt(out, 0, 0)).toBeLessThan(50);      // background kept
  });

  it('target=background inverts (edit everything except the object)', async () => {
    const m = await whiteRectMask(16, 16, { x: 4, y: 4, w: 6, h: 6 });
    const out = await maskToEditMask(m, { target: 'background' });
    expect(await lumaAt(out, 6, 6)).toBeLessThan(50);      // object kept
    expect(await lumaAt(out, 0, 0)).toBeGreaterThan(200);  // background editable
  });

  it('unions multiple masks', async () => {
    const a = await whiteRectMask(20, 20, { x: 1, y: 1, w: 4, h: 4 });
    const b = await whiteRectMask(20, 20, { x: 12, y: 12, w: 4, h: 4 });
    const out = await maskToEditMask([a, b], { target: 'object' });
    expect(await lumaAt(out, 2, 2)).toBeGreaterThan(200);
    expect(await lumaAt(out, 13, 13)).toBeGreaterThan(200);
  });
});

import { describe, it, expect } from 'vitest';
import { computeMaskBbox } from '../maskGeometry.js';

/** Build a black PNG of WxH with an optional white rect. */
async function makeMask(
  W: number, H: number, rect?: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const base = sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } });
  if (!rect) return base.png().toBuffer();
  const overlay = await sharp({ create: { width: rect.w, height: rect.h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png().toBuffer();
  return base.composite([{ input: overlay, left: rect.x, top: rect.y }]).png().toBuffer();
}

describe('computeMaskBbox', () => {
  it('returns the tight box of the white region', async () => {
    const mask = await makeMask(20, 16, { x: 4, y: 3, w: 6, h: 5 });
    const bbox = await computeMaskBbox(mask);
    expect(bbox).toEqual({ x: 4, y: 3, width: 6, height: 5 });
  });

  it('returns null for an empty (all black) mask', async () => {
    const mask = await makeMask(8, 8);
    expect(await computeMaskBbox(mask)).toBeNull();
  });
});

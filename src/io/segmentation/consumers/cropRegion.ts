/**
 * @module io/segmentation/consumers/cropRegion
 */
import type { SegmentMask } from '../types.js';

/**
 * Apply a mask as the alpha channel of the source image and crop to the mask's
 * bbox, producing a transparent cutout (sprite primitive / CLIP-embed input).
 *
 * @param opts.pad pixels to expand the crop on each side (default 0)
 * @param opts.background `'transparent'` (default) keeps alpha; `'opaque'` flattens to black
 */
export async function cropRegion(
  source: Buffer | Uint8Array | string,
  mask: SegmentMask,
  opts: { pad?: number; background?: 'transparent' | 'opaque' } = {},
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const srcBuf =
    typeof source === 'string' ? source : Buffer.isBuffer(source) ? source : Buffer.from(source);

  const meta = await sharp(srcBuf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const pad = opts.pad ?? 0;

  // Mask luma -> single-channel alpha, resized to source dimensions.
  const alpha = await sharp(mask.mask)
    .resize(W, H, { fit: 'fill' })
    .greyscale()
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  // Source RGB (raw) + joined alpha channel -> RGBA.
  const rgb = await sharp(srcBuf).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const rgba = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();

  const x = Math.max(0, mask.bbox.x - pad);
  const y = Math.max(0, mask.bbox.y - pad);
  const w = Math.min(W - x, mask.bbox.width + pad * 2);
  const h = Math.min(H - y, mask.bbox.height + pad * 2);

  let out = sharp(rgba).extract({ left: x, top: y, width: w, height: h });
  if (opts.background === 'opaque') out = out.flatten({ background: { r: 0, g: 0, b: 0 } });
  return out.png().toBuffer();
}

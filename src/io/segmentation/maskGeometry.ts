/**
 * @module io/segmentation/maskGeometry
 */
import type { SegmentationBox } from './types.js';

/**
 * Compute the tight bounding box of the white (luma >= 128) pixels in a mask.
 * Returns `null` when the mask has no white pixels.
 *
 * sharp is loaded lazily, matching the guarded dynamic-import pattern used by
 * the vision pipeline (src/io/vision/VisionPipeline.ts).
 */
export async function computeMaskBbox(maskPng: Buffer): Promise<SegmentationBox | null> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(maskPng)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels] >= 128) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

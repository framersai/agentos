// Live smoke for segment(). Requires REPLICATE_API_TOKEN. Not run in CI.
//
//   REPLICATE_API_TOKEN=... node examples/segmentation-smoke.mjs ./path/to/image.png
//
// This confirms the real Replicate model slugs and input/output field shapes.
// If a model 404s or rejects a field, adjust DEFAULT_SAM_MODEL /
// DEFAULT_GROUNDED_SAM_MODEL / buildInput in
// src/io/segmentation/providers/ReplicateSegmentationProvider.ts and re-run.
import { readFileSync, writeFileSync } from 'node:fs';
import { segment, maskToEditMask, cropRegion } from '../dist/index.js';

if (!process.env.REPLICATE_API_TOKEN) {
  console.error('Set REPLICATE_API_TOKEN to run this smoke.');
  process.exit(1);
}

const imagePath = process.argv[2] ?? './examples/assets/sample.png';
const image = readFileSync(imagePath);

console.log('1) text prompt: "main subject"');
const byText = await segment({ image, prompt: 'main subject' });
console.log(`   -> ${byText.masks.length} mask(s), ${byText.width}x${byText.height}`);

console.log('2) box prompt (top-left quadrant)');
const byBox = await segment({
  image,
  box: { x: 0, y: 0, width: Math.floor(byText.width / 2), height: Math.floor(byText.height / 2) },
});
console.log(`   -> ${byBox.masks.length} mask(s)`);

if (byText.masks[0]) {
  const editMask = await maskToEditMask(byText.masks[0]);
  writeFileSync('./segmentation-editmask.png', editMask);
  const cutout = await cropRegion(image, byText.masks[0]);
  writeFileSync('./segmentation-cutout.png', cutout);
  console.log('   wrote segmentation-editmask.png and segmentation-cutout.png');
}
console.log('Smoke complete.');

/**
 * @module io/segmentation
 * Public barrel for the image segmentation surface.
 */
export * from './types.js';
export * from './errors.js';
export { resolveSegmentationMode } from './resolveMode.js';
export { computeMaskBbox } from './maskGeometry.js';
export { ReplicateSegmentationProvider } from './providers/ReplicateSegmentationProvider.js';
export {
  resolveSegmentationProvider,
  registerSegmentationProvider,
  resetSegmentationProviders,
} from './SegmentationProviderRegistry.js';
export { maskToEditMask } from './consumers/maskToEditMask.js';
export { cropRegion } from './consumers/cropRegion.js';

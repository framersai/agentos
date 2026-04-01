/**
 * @file IVideoGenerator.ts
 * Provider interface for video generation (text-to-video and image-to-video).
 *
 * Follows the same pattern as {@link IImageProvider} in the image subsystem:
 * each concrete provider implements this interface, and instances are composed
 * into a {@link FallbackVideoProxy} chain for automatic failover.
 *
 * @see {@link FallbackVideoProxy} for the failover wrapper.
 * @see {@link IVideoAnalyzer} for the read-side analysis interface.
 */
export {};
//# sourceMappingURL=IVideoGenerator.js.map
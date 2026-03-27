/**
 * @file index.ts
 * Barrel export for the video generation and analysis subsystem.
 *
 * Re-exports all public types, interfaces, and the fallback proxy so
 * consumers can import from `@agentos/core/video` (or the relative path)
 * without reaching into individual files.
 *
 * Also provides a provider factory registry (modelled on the image
 * subsystem's pattern) so that built-in and third-party video providers
 * can be registered and instantiated by provider ID.
 */

import type { IVideoGenerator } from './IVideoGenerator.js';

export * from './types.js';
export * from './IVideoGenerator.js';
export * from './IVideoAnalyzer.js';
export * from './FallbackVideoProxy.js';
export * from './VideoAnalyzer.js';

// ---------------------------------------------------------------------------
// Provider factory registry
// ---------------------------------------------------------------------------

/** A factory function that creates an uninitialised video provider instance. */
export type VideoProviderFactory = () => IVideoGenerator;

/**
 * Internal registry mapping provider IDs to lazy factory functions.
 *
 * Built-in providers (Runway, Replicate, Fal) are registered with dynamic
 * imports so their modules are only loaded when actually requested — this
 * keeps the barrel import lightweight for consumers who don't use video.
 */
const videoProviderFactories = new Map<string, VideoProviderFactory>([
  [
    'runway',
    () => {
      // Lazy dynamic import — resolved synchronously from the factory
      // because the caller will `await provider.initialize()` anyway.
      // We use a require-style approach via a deferred wrapper.
      const { RunwayVideoProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/RunwayVideoProvider.js') as typeof import('./providers/RunwayVideoProvider.js');
      return new RunwayVideoProvider();
    },
  ],
  [
    'replicate',
    () => {
      const { ReplicateVideoProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/ReplicateVideoProvider.js') as typeof import('./providers/ReplicateVideoProvider.js');
      return new ReplicateVideoProvider();
    },
  ],
  [
    'fal',
    () => {
      const { FalVideoProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/FalVideoProvider.js') as typeof import('./providers/FalVideoProvider.js');
      return new FalVideoProvider();
    },
  ],
]);

/**
 * Register a video provider factory for a given provider ID.
 *
 * Use this to add third-party or custom video providers at runtime.
 * Built-in providers (runway, replicate, fal) are pre-registered.
 *
 * @param providerId - Unique identifier for the provider (lowercased for matching).
 * @param factory - Factory function that creates a new uninitialised provider instance.
 */
export function registerVideoProviderFactory(
  providerId: string,
  factory: VideoProviderFactory,
): void {
  videoProviderFactories.set(providerId.toLowerCase(), factory);
}

/**
 * Create a video provider instance by provider ID.
 *
 * Looks up the factory in the registry and returns a new uninitialised
 * provider. The caller must call `provider.initialize(config)` before use.
 *
 * @param providerId - Provider identifier (e.g. `"runway"`, `"replicate"`, `"fal"`).
 * @returns A new uninitialised {@link IVideoGenerator} instance.
 * @throws {Error} When no factory is registered for the given provider ID.
 */
export function createVideoProvider(providerId: string): IVideoGenerator {
  const factory = videoProviderFactories.get(providerId.toLowerCase());
  if (!factory) {
    throw new Error(`Video generation is not supported for provider "${providerId}".`);
  }
  return factory();
}

/**
 * Check whether a video provider factory is registered for the given ID.
 *
 * @param providerId - Provider identifier to check.
 * @returns `true` if a factory exists for this provider.
 */
export function hasVideoProviderFactory(providerId: string): boolean {
  return videoProviderFactories.has(providerId.toLowerCase());
}

/**
 * List all registered video provider factory IDs, sorted alphabetically.
 *
 * @returns Sorted array of registered provider identifiers.
 */
export function listVideoProviderFactories(): string[] {
  return Array.from(videoProviderFactories.keys()).sort();
}

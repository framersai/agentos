/**
 * @file index.ts
 * Barrel export for the video generation and analysis subsystem.
 *
 * Re-exports all public types, interfaces, and the fallback proxy so
 * consumers can import from `@agentos/media/video` (or the relative path)
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
/** A factory function that creates an uninitialised video provider instance. */
export type VideoProviderFactory = () => IVideoGenerator;
/**
 * Register a video provider factory for a given provider ID.
 *
 * Use this to add third-party or custom video providers at runtime.
 * Built-in providers (runway, replicate, fal) are pre-registered.
 *
 * @param providerId - Unique identifier for the provider (lowercased for matching).
 * @param factory - Factory function that creates a new uninitialised provider instance.
 */
export declare function registerVideoProviderFactory(providerId: string, factory: VideoProviderFactory): void;
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
export declare function createVideoProvider(providerId: string): IVideoGenerator;
/**
 * Check whether a video provider factory is registered for the given ID.
 *
 * @param providerId - Provider identifier to check.
 * @returns `true` if a factory exists for this provider.
 */
export declare function hasVideoProviderFactory(providerId: string): boolean;
/**
 * List all registered video provider factory IDs, sorted alphabetically.
 *
 * @returns Sorted array of registered provider identifiers.
 */
export declare function listVideoProviderFactories(): string[];
//# sourceMappingURL=index.d.ts.map
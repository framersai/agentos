/**
 * @file index.ts
 * Barrel export for the audio generation subsystem.
 *
 * Re-exports all public types, interfaces, and the fallback proxy so
 * consumers can import from `@agentos/media/audio` (or the relative path)
 * without reaching into individual files.
 *
 * Audio processing utilities (AdaptiveVAD, SilenceDetector, etc.) have
 * moved to the `hearing/` module.
 *
 * Also provides a provider factory registry (modelled on the video
 * subsystem's pattern) so that built-in and third-party audio providers
 * can be registered and instantiated by provider ID.
 */
import type { IAudioGenerator } from './IAudioGenerator.js';
export * from './types.js';
export * from './IAudioGenerator.js';
export * from './FallbackAudioProxy.js';
/** A factory function that creates an uninitialised audio provider instance. */
export type AudioProviderFactory = () => IAudioGenerator;
/**
 * Register an audio provider factory for a given provider ID.
 *
 * Use this to add third-party or custom audio providers at runtime.
 * Built-in providers (suno, udio, stable-audio, elevenlabs-sfx,
 * musicgen-local, audiogen-local, replicate-audio, fal-audio) are
 * pre-registered.
 *
 * @param providerId - Unique identifier for the provider (lowercased for matching).
 * @param factory - Factory function that creates a new uninitialised provider instance.
 */
export declare function registerAudioProviderFactory(providerId: string, factory: AudioProviderFactory): void;
/**
 * Create an audio provider instance by provider ID.
 *
 * Looks up the factory in the registry and returns a new uninitialised
 * provider. The caller must call `provider.initialize(config)` before use.
 *
 * @param providerId - Provider identifier (e.g. `"suno"`, `"stable-audio"`, `"elevenlabs-sfx"`).
 * @returns A new uninitialised {@link IAudioGenerator} instance.
 * @throws {Error} When no factory is registered for the given provider ID.
 */
export declare function createAudioProvider(providerId: string): IAudioGenerator;
/**
 * Check whether an audio provider factory is registered for the given ID.
 *
 * @param providerId - Provider identifier to check.
 * @returns `true` if a factory exists for this provider.
 */
export declare function hasAudioProviderFactory(providerId: string): boolean;
/**
 * List all registered audio provider factory IDs, sorted alphabetically.
 *
 * @returns Sorted array of registered provider identifiers.
 */
export declare function listAudioProviderFactories(): string[];
//# sourceMappingURL=index.d.ts.map
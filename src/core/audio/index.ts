/**
 * @file index.ts
 * Barrel export for the audio generation and processing subsystem.
 *
 * Re-exports all public types, interfaces, processing utilities, and the
 * fallback proxy so consumers can import from `@agentos/core/audio` (or the
 * relative path) without reaching into individual files.
 *
 * Also provides a provider factory registry (modelled on the video
 * subsystem's pattern) so that built-in and third-party audio providers
 * can be registered and instantiated by provider ID.
 */

import type { IAudioGenerator } from './IAudioGenerator.js';

// ---------------------------------------------------------------------------
// Audio processing (VAD, silence detection, calibration)
// ---------------------------------------------------------------------------
export * from './AdaptiveVAD.js';
export * from './AudioProcessor.js';
export * from './EnvironmentalCalibrator.js';
export * from './SilenceDetector.js';

// ---------------------------------------------------------------------------
// Audio generation (types, interface, fallback proxy)
// ---------------------------------------------------------------------------
export * from './types.js';
export * from './IAudioGenerator.js';
export * from './FallbackAudioProxy.js';

// ---------------------------------------------------------------------------
// Provider factory registry
// ---------------------------------------------------------------------------

/** A factory function that creates an uninitialised audio provider instance. */
export type AudioProviderFactory = () => IAudioGenerator;

/**
 * Internal registry mapping provider IDs to lazy factory functions.
 *
 * Built-in providers (Suno, Udio, Stable Audio, ElevenLabs SFX) are
 * registered with dynamic imports so their modules are only loaded when
 * actually requested — this keeps the barrel import lightweight for
 * consumers who don't use audio generation.
 */
const audioProviderFactories = new Map<string, AudioProviderFactory>([
  [
    'suno',
    () => {
      const { SunoProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/SunoProvider.js') as typeof import('./providers/SunoProvider.js');
      return new SunoProvider();
    },
  ],
  [
    'udio',
    () => {
      const { UdioProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/UdioProvider.js') as typeof import('./providers/UdioProvider.js');
      return new UdioProvider();
    },
  ],
  [
    'stable-audio',
    () => {
      const { StableAudioProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/StableAudioProvider.js') as typeof import('./providers/StableAudioProvider.js');
      return new StableAudioProvider();
    },
  ],
  [
    'elevenlabs-sfx',
    () => {
      const { ElevenLabsSFXProvider } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./providers/ElevenLabsSFXProvider.js') as typeof import('./providers/ElevenLabsSFXProvider.js');
      return new ElevenLabsSFXProvider();
    },
  ],
]);

/**
 * Register an audio provider factory for a given provider ID.
 *
 * Use this to add third-party or custom audio providers at runtime.
 * Built-in providers (suno, udio, stable-audio, elevenlabs-sfx) are
 * pre-registered.
 *
 * @param providerId - Unique identifier for the provider (lowercased for matching).
 * @param factory - Factory function that creates a new uninitialised provider instance.
 */
export function registerAudioProviderFactory(
  providerId: string,
  factory: AudioProviderFactory,
): void {
  audioProviderFactories.set(providerId.toLowerCase(), factory);
}

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
export function createAudioProvider(providerId: string): IAudioGenerator {
  const factory = audioProviderFactories.get(providerId.toLowerCase());
  if (!factory) {
    throw new Error(`Audio generation is not supported for provider "${providerId}".`);
  }
  return factory();
}

/**
 * Check whether an audio provider factory is registered for the given ID.
 *
 * @param providerId - Provider identifier to check.
 * @returns `true` if a factory exists for this provider.
 */
export function hasAudioProviderFactory(providerId: string): boolean {
  return audioProviderFactories.has(providerId.toLowerCase());
}

/**
 * List all registered audio provider factory IDs, sorted alphabetically.
 *
 * @returns Sorted array of registered provider identifiers.
 */
export function listAudioProviderFactories(): string[] {
  return Array.from(audioProviderFactories.keys()).sort();
}

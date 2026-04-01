/**
 * @file IAudioGenerator.ts
 * Provider interface for audio generation (music and sound effects).
 *
 * Follows the same pattern as {@link IVideoGenerator} in the video subsystem:
 * each concrete provider implements this interface, and instances are composed
 * into a {@link FallbackAudioProxy} chain for automatic failover.
 *
 * ## Sub-modality split
 *
 * Audio generation is split into two sub-modalities:
 *
 * - **Music** — full-length compositions ({@link generateMusic}).
 * - **SFX** — short sound effects ({@link generateSFX}).
 *
 * A provider may support one or both. Capability negotiation is done via
 * {@link supports} — the proxy uses this to skip structurally incapable
 * providers rather than counting them as transient failures.
 *
 * @see {@link FallbackAudioProxy} for the failover wrapper.
 * @see {@link IVideoGenerator} for the analogous video interface.
 */
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from './types.js';
/**
 * Abstraction over an audio generation backend (Suno, Udio, Stable Audio,
 * ElevenLabs, Replicate, etc.).
 *
 * ## Capability negotiation
 *
 * Not every provider supports every sub-modality. The {@link supports} method
 * lets callers (and the {@link FallbackAudioProxy}) query whether a given
 * capability is available before invoking it.
 *
 * ## Lifecycle
 *
 * 1. Construct the provider.
 * 2. Call {@link initialize} with provider-specific configuration (API keys,
 *    base URLs, etc.).
 * 3. Use {@link generateMusic} and/or {@link generateSFX}.
 * 4. Optionally call {@link shutdown} to release resources.
 *
 * @example
 * ```typescript
 * const suno: IAudioGenerator = new SunoProvider();
 * await suno.initialize({ apiKey: process.env.SUNO_API_KEY! });
 *
 * if (suno.supports('music')) {
 *   const result = await suno.generateMusic({ prompt: 'Ambient piano loop' });
 *   console.log(result.audio[0].url);
 * }
 *
 * await suno.shutdown?.();
 * ```
 */
export interface IAudioGenerator {
    /** Unique identifier for this provider (e.g. `'suno'`, `'elevenlabs-sfx'`). */
    readonly providerId: string;
    /** Whether {@link initialize} has been called successfully. */
    readonly isInitialized: boolean;
    /** Default model used when the request omits `modelId`. */
    readonly defaultModelId?: string;
    /**
     * Initialise the provider with runtime configuration.
     *
     * @param config - Provider-specific key/value pairs (API keys, endpoints,
     *   model overrides, etc.).
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Generate music from a text prompt.
     *
     * Providers that do not support music generation should throw an error
     * and have {@link supports} return `false` for `'music'`.
     *
     * @param request - The music generation parameters.
     * @returns A result envelope containing one or more generated audio clips.
     */
    generateMusic(request: MusicGenerateRequest): Promise<AudioResult>;
    /**
     * Generate a sound effect from a text prompt.
     *
     * This method is optional — providers that do not support SFX generation
     * should either omit it or have {@link supports} return `false` for
     * `'sfx'`.
     *
     * @param request - The SFX generation parameters.
     * @returns A result envelope containing one or more generated audio clips.
     */
    generateSFX?(request: SFXGenerateRequest): Promise<AudioResult>;
    /**
     * Query whether this provider supports a given capability.
     *
     * @param capability - The capability to check (`'music'` or `'sfx'`).
     * @returns `true` if the provider can handle the requested capability.
     */
    supports(capability: 'music' | 'sfx'): boolean;
    /**
     * Release any resources held by the provider (HTTP connections, polling
     * loops, temp files, etc.).
     */
    shutdown?(): Promise<void>;
}
//# sourceMappingURL=IAudioGenerator.d.ts.map
/**
 * @module media/audio/providers/ElevenLabsSFXProvider
 *
 * Sound effect generation provider for the ElevenLabs Sound Generation API.
 *
 * ElevenLabs offers a dedicated sound effects endpoint that generates
 * short audio clips from text descriptions. This provider is SFX-only;
 * it does not support music generation.
 *
 * ## API flow (synchronous)
 *
 * 1. **Generate** — `POST ${baseURL}/sound-generation` with text prompt,
 *    duration, and prompt influence. Returns audio data directly.
 *
 * ## Authentication
 *
 * Requires an `ELEVENLABS_API_KEY`. Sent as `xi-api-key: ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 */
import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from '../types.js';
/**
 * Configuration for the ElevenLabs SFX generation provider.
 *
 * @example
 * ```typescript
 * const config: ElevenLabsSFXProviderConfig = {
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 * };
 * ```
 */
export interface ElevenLabsSFXProviderConfig {
    /** ElevenLabs API key. Sent as `xi-api-key: ${apiKey}`. */
    apiKey: string;
    /**
     * Base URL for the ElevenLabs API. Override for testing or proxy setups.
     * @default 'https://api.elevenlabs.io/v1'
     */
    baseURL?: string;
}
/**
 * Sound effect generation provider connecting to the ElevenLabs API.
 *
 * Implements a synchronous request pattern: a single POST request returns
 * the generated audio data directly. Only supports SFX generation — music
 * generation is not available through this endpoint.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new ElevenLabsSFXProvider();
 * await provider.initialize({ apiKey: process.env.ELEVENLABS_API_KEY! });
 *
 * const result = await provider.generateSFX({
 *   prompt: 'Thunder crack followed by heavy rain',
 *   durationSec: 5,
 * });
 * console.log(result.audio[0].base64);
 * ```
 */
export declare class ElevenLabsSFXProvider implements IAudioGenerator {
    /** @inheritdoc */
    readonly providerId = "elevenlabs-sfx";
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /** Internal resolved configuration. */
    private _config;
    /**
     * Initialize the provider with API credentials and optional configuration.
     *
     * @param config - Configuration object. Must include `apiKey`.
     * @throws {Error} If `apiKey` is missing or empty.
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Music generation is not supported by the ElevenLabs SFX endpoint.
     *
     * @throws {Error} Always throws — use a music-capable provider instead.
     */
    generateMusic(_request: MusicGenerateRequest): Promise<AudioResult>;
    /**
     * Generate a sound effect from a text prompt using the ElevenLabs API.
     *
     * @param request - SFX generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error.
     */
    generateSFX(request: SFXGenerateRequest): Promise<AudioResult>;
    /**
     * ElevenLabs SFX provider only supports sound effect generation.
     *
     * @param capability - The capability to check.
     * @returns `true` only for `'sfx'`; `false` for `'music'`.
     */
    supports(capability: 'music' | 'sfx'): boolean;
    /**
     * Release any resources held by the provider. No-op for HTTP-only providers.
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=ElevenLabsSFXProvider.d.ts.map
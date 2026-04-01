import type { AudioResult, AudioOutputFormat, AudioProgressEvent } from '../media/audio/types.js';
import { type MediaProviderPreference } from '../media/ProviderPreferences.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for a {@link generateMusic} call.
 *
 * At minimum, a `prompt` is required. The provider is resolved from
 * `opts.provider`, `opts.apiKey`, or the first music-capable env var found
 * (`SUNO_API_KEY` -> `STABILITY_API_KEY` -> `REPLICATE_API_TOKEN` ->
 * `FAL_API_KEY` -> local MusicGen).
 */
export interface GenerateMusicOptions {
    /** Text prompt describing the desired musical composition. */
    prompt: string;
    /**
     * Explicit provider identifier (e.g. `"suno"`, `"stable-audio"`, `"musicgen-local"`).
     * When omitted, auto-detection from environment variables is used.
     */
    provider?: string;
    /**
     * Model identifier within the provider (e.g. `"suno-v3.5"`,
     * `"stable-audio-open-1.0"`). When omitted, the provider's default
     * model is used.
     */
    model?: string;
    /** Desired output duration in seconds. Provider limits vary. */
    durationSec?: number;
    /** Negative prompt describing musical elements to avoid. */
    negativePrompt?: string;
    /** Output audio format (e.g. `"mp3"`, `"wav"`). Defaults to provider default. */
    outputFormat?: AudioOutputFormat;
    /** Random seed for reproducible generation (provider-dependent). */
    seed?: number;
    /**
     * Maximum time in milliseconds to wait for generation to complete.
     * Provider-dependent — polling providers enforce this directly.
     */
    timeoutMs?: number;
    /** Number of audio clips to generate. Defaults to 1. */
    n?: number;
    /**
     * Optional progress callback invoked during long-running generation.
     * Called with an {@link AudioProgressEvent} at each status transition.
     */
    onProgress?: (event: AudioProgressEvent) => void;
    /** Override the provider API key instead of reading from env vars. */
    apiKey?: string;
    /** Optional user identifier forwarded to the provider for billing. */
    userId?: string;
    /** Arbitrary provider-specific options. */
    providerOptions?: Record<string, unknown>;
    /**
     * Provider preferences for reordering or filtering the fallback chain.
     * When supplied, the available providers are reordered according to
     * `preferred` and filtered by `blocked` before building the chain.
     */
    providerPreferences?: MediaProviderPreference;
    /** Optional durable usage ledger configuration for accounting. */
    usageLedger?: AgentOSUsageLedgerOptions;
}
/**
 * The result returned by {@link generateMusic}.
 *
 * Wraps the core {@link AudioResult} with a simpler, AI-SDK-style shape.
 */
export interface GenerateMusicResult {
    /** Model identifier reported by the provider. */
    model: string;
    /** Provider identifier (e.g. `"suno"`, `"stable-audio"`). */
    provider: string;
    /** Unix timestamp (seconds) when the audio was created. */
    created: number;
    /** Array of generated audio objects containing URLs or base64 data. */
    audio: AudioResult['audio'];
    /** Usage / billing information, if available. */
    usage?: AudioResult['usage'];
}
/**
 * Generates music using a provider-agnostic interface.
 *
 * Resolves provider credentials via explicit options or environment variable
 * auto-detection, initialises the matching audio provider (optionally wrapped
 * in a fallback chain), and returns a normalised {@link GenerateMusicResult}.
 *
 * @param opts - Music generation options.
 * @returns A promise resolving to the generation result with audio data and metadata.
 *
 * @example
 * ```ts
 * const result = await generateMusic({
 *   prompt: 'Upbeat lo-fi hip hop beat with vinyl crackle and mellow piano',
 *   durationSec: 60,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export declare function generateMusic(opts: GenerateMusicOptions): Promise<GenerateMusicResult>;
//# sourceMappingURL=generateMusic.d.ts.map
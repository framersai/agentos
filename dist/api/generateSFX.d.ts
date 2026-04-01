import type { AudioResult, AudioOutputFormat, AudioProgressEvent } from '../media/audio/types.js';
import { type MediaProviderPreference } from '../media/ProviderPreferences.js';
import { type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
/**
 * Options for a {@link generateSFX} call.
 *
 * At minimum, a `prompt` is required. The provider is resolved from
 * `opts.provider`, `opts.apiKey`, or the first SFX-capable env var found
 * (`ELEVENLABS_API_KEY` -> `STABILITY_API_KEY` -> `REPLICATE_API_TOKEN` ->
 * `FAL_API_KEY` -> local AudioGen).
 */
export interface GenerateSFXOptions {
    /** Text prompt describing the desired sound effect. */
    prompt: string;
    /**
     * Explicit provider identifier (e.g. `"elevenlabs-sfx"`, `"stable-audio"`,
     * `"audiogen-local"`). When omitted, auto-detection from environment
     * variables is used.
     */
    provider?: string;
    /**
     * Model identifier within the provider. When omitted, the provider's
     * default model is used.
     */
    model?: string;
    /** Desired output duration in seconds. SFX clips are typically 1-15s. */
    durationSec?: number;
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
 * The result returned by {@link generateSFX}.
 *
 * Wraps the core {@link AudioResult} with a simpler, AI-SDK-style shape.
 */
export interface GenerateSFXResult {
    /** Model identifier reported by the provider. */
    model: string;
    /** Provider identifier (e.g. `"elevenlabs-sfx"`, `"stable-audio"`). */
    provider: string;
    /** Unix timestamp (seconds) when the audio was created. */
    created: number;
    /** Array of generated audio objects containing URLs or base64 data. */
    audio: AudioResult['audio'];
    /** Usage / billing information, if available. */
    usage?: AudioResult['usage'];
}
/**
 * Generates a sound effect using a provider-agnostic interface.
 *
 * Resolves provider credentials via explicit options or environment variable
 * auto-detection, initialises the matching audio provider (optionally wrapped
 * in a fallback chain), and returns a normalised {@link GenerateSFXResult}.
 *
 * @param opts - SFX generation options.
 * @returns A promise resolving to the generation result with audio data and metadata.
 *
 * @example
 * ```ts
 * const result = await generateSFX({
 *   prompt: 'Thunder crack followed by heavy rain on a tin roof',
 *   durationSec: 5,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export declare function generateSFX(opts: GenerateSFXOptions): Promise<GenerateSFXResult>;
//# sourceMappingURL=generateSFX.d.ts.map
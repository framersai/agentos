/**
 * @module media/audio/providers/ReplicateAudioProvider
 *
 * Audio generation provider for the Replicate API, supporting both music
 * and sound effects through different default models.
 *
 * Replicate hosts open-source audio models (MusicGen, AudioGen, etc.) behind
 * a uniform predictions API. This provider mirrors the pattern established
 * by {@link ReplicateVideoProvider}: create a prediction with `Prefer: wait`,
 * then poll if it hasn't completed inline.
 *
 * ## Supported models
 *
 * | Model ID              | Type  | Description                    |
 * |-----------------------|-------|--------------------------------|
 * | `meta/musicgen`       | Music | Meta's MusicGen on Replicate   |
 * | `meta/audiogen`       | SFX   | Meta's AudioGen on Replicate   |
 *
 * ## API flow (submit + sync wait + optional poll)
 *
 * 1. **Create prediction** — `POST ${baseURL}/predictions` with
 *    `Prefer: wait=60`. If the model finishes within 60 seconds the
 *    response already contains the output.
 * 2. **Poll** (if needed) — `GET prediction.urls.get` until `status` is
 *    `succeeded`, `failed`, or `canceled`.
 * 3. **Result** — `output` is the audio URL (string or first array element).
 *
 * ## Authentication
 *
 * Requires a `REPLICATE_API_TOKEN`. Sent as `Authorization: Token ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 * @see {@link ReplicateVideoProvider} for the video counterpart.
 */
import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from '../types.js';
/**
 * Configuration for the Replicate audio generation provider.
 *
 * @example
 * ```typescript
 * const config: ReplicateAudioProviderConfig = {
 *   apiKey: process.env.REPLICATE_API_TOKEN!,
 *   defaultMusicModel: 'meta/musicgen',
 *   defaultSfxModel: 'meta/audiogen',
 * };
 * ```
 */
export interface ReplicateAudioProviderConfig {
    /** Replicate API token. Sent as `Authorization: Token ${apiKey}`. */
    apiKey: string;
    /**
     * Base URL for the Replicate API. Override for testing or proxy setups.
     * @default 'https://api.replicate.com/v1'
     */
    baseURL?: string;
    /**
     * Default model to use for music generation.
     * @default 'meta/musicgen'
     */
    defaultMusicModel?: string;
    /**
     * Default model to use for SFX generation.
     * @default 'meta/audiogen'
     */
    defaultSfxModel?: string;
    /**
     * Milliseconds between prediction status polls.
     * @default 5000
     */
    pollIntervalMs?: number;
    /**
     * Maximum milliseconds to wait for generation before timing out.
     * @default 300000
     */
    timeoutMs?: number;
}
/**
 * Audio generation provider connecting to the Replicate predictions API.
 *
 * Follows the same submit-then-poll pattern as {@link ReplicateVideoProvider}:
 * create a prediction with `Prefer: wait=60`, then poll if the model takes
 * longer than the wait window.
 *
 * Routes to different default models based on whether music or SFX is requested.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new ReplicateAudioProvider();
 * await provider.initialize({ apiKey: process.env.REPLICATE_API_TOKEN! });
 *
 * const music = await provider.generateMusic({
 *   prompt: 'Upbeat indie rock with driving guitars',
 * });
 *
 * const sfx = await provider.generateSFX({
 *   prompt: 'Glass shattering on a hard floor',
 * });
 * ```
 */
export declare class ReplicateAudioProvider implements IAudioGenerator {
    /** @inheritdoc */
    readonly providerId = "replicate-audio";
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
     * Generate music from a text prompt using a music model on Replicate.
     *
     * @param request - Music generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    generateMusic(request: MusicGenerateRequest): Promise<AudioResult>;
    /**
     * Generate a sound effect from a text prompt using an SFX model on Replicate.
     *
     * @param request - SFX generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    generateSFX(request: SFXGenerateRequest): Promise<AudioResult>;
    /**
     * Replicate audio supports both music and SFX generation through
     * different model routing.
     *
     * @param capability - The capability to check.
     * @returns `true` for both `'music'` and `'sfx'`.
     */
    supports(capability: 'music' | 'sfx'): boolean;
    /**
     * Release any resources held by the provider. No-op for HTTP-only providers.
     */
    shutdown(): Promise<void>;
    /**
     * Create a prediction and wait for it to complete.
     *
     * Uses `Prefer: wait=60` to get synchronous completion for fast models.
     * Falls back to polling if the prediction hasn't completed within the
     * wait window.
     *
     * @param model - Model identifier (e.g. 'meta/musicgen').
     * @param input - Model input parameters.
     * @returns The completed prediction object.
     *
     * @throws {Error} If prediction creation fails, the prediction fails,
     *   is canceled, or times out.
     * @internal
     */
    private _runPrediction;
    /**
     * Create a new prediction via `POST /predictions`.
     *
     * @param model - Model identifier.
     * @param input - Model input parameters.
     * @returns The prediction response (may or may not be completed).
     *
     * @throws {Error} If the HTTP request fails.
     * @internal
     */
    private _createPrediction;
    /**
     * Poll a prediction URL until it reaches a terminal state.
     *
     * @param url - The `prediction.urls.get` URL to poll.
     * @returns The completed prediction object.
     *
     * @throws {Error} If polling fails or times out.
     * @internal
     */
    private _pollPrediction;
    /**
     * Build an {@link AudioResult} from a completed Replicate prediction.
     *
     * @param prediction - The succeeded prediction object.
     * @param model - Model ID used for the generation.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If no audio URL could be extracted from the output.
     * @internal
     */
    private _buildResult;
}
//# sourceMappingURL=ReplicateAudioProvider.d.ts.map
/**
 * @module media/audio/providers/UdioProvider
 *
 * Music generation provider for the Udio model via Replicate.
 *
 * Udio is hosted on Replicate and accessed through the predictions API
 * using the submit-then-poll pattern. This provider is music-only; it
 * does not support sound effect generation.
 *
 * ## API flow (Replicate submit-poll)
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
 * @see {@link SunoProvider} for a similar Replicate-hosted music provider.
 */
import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from '../types.js';
/**
 * Configuration for the Udio music generation provider.
 *
 * @example
 * ```typescript
 * const config: UdioProviderConfig = {
 *   apiKey: process.env.REPLICATE_API_TOKEN!,
 * };
 * ```
 */
export interface UdioProviderConfig {
    /** Replicate API token. Sent as `Authorization: Token ${apiKey}`. */
    apiKey: string;
    /**
     * Base URL for the Replicate API. Override for testing or proxy setups.
     * @default 'https://api.replicate.com/v1'
     */
    baseURL?: string;
    /**
     * Default model to use when the request doesn't specify one.
     * @default 'udio/udio'
     */
    defaultModelId?: string;
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
 * Music generation provider connecting to the Udio model on Replicate.
 *
 * Follows the Replicate submit-then-poll pattern: create a prediction with
 * `Prefer: wait=60`, then poll if the model takes longer than the wait window.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new UdioProvider();
 * await provider.initialize({ apiKey: process.env.REPLICATE_API_TOKEN! });
 *
 * const result = await provider.generateMusic({
 *   prompt: 'Epic orchestral film score with dramatic strings',
 *   durationSec: 120,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export declare class UdioProvider implements IAudioGenerator {
    /** @inheritdoc */
    readonly providerId = "udio";
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /** Internal resolved configuration. */
    private _config;
    private keyPool;
    /**
     * Initialize the provider with API credentials and optional configuration.
     *
     * @param config - Configuration object. Must include `apiKey`.
     * @throws {Error} If `apiKey` is missing or empty.
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Generate music from a text prompt using the Udio model on Replicate.
     *
     * Creates a prediction, waits for synchronous completion (up to 60s), then
     * polls if still in progress.
     *
     * @param request - Music generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    generateMusic(request: MusicGenerateRequest): Promise<AudioResult>;
    /**
     * SFX generation is not supported by the Udio model.
     *
     * @throws {Error} Always throws — use an SFX-capable provider instead.
     */
    generateSFX(_request: SFXGenerateRequest): Promise<AudioResult>;
    /**
     * Udio supports music generation only.
     *
     * @param capability - The capability to check.
     * @returns `true` only for `'music'`; `false` for `'sfx'`.
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
     * @param model - Model identifier (e.g. 'udio/udio').
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
//# sourceMappingURL=UdioProvider.d.ts.map
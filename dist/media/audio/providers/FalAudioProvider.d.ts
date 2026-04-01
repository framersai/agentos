/**
 * @module media/audio/providers/FalAudioProvider
 *
 * Audio generation provider for the Fal.ai serverless GPU platform.
 *
 * Fal.ai hosts audio generation models (Stable Audio, etc.) behind a
 * queue-based API. This provider implements the three-step pattern
 * established by {@link FalVideoProvider}: submit to queue, poll for status,
 * then fetch the completed result.
 *
 * ## Supported models
 *
 * | Model ID               | Description                          |
 * |------------------------|--------------------------------------|
 * | `fal-ai/stable-audio`  | Stable Audio on Fal.ai — default     |
 *
 * ## API flow (three-step queue)
 *
 * 1. **Submit** — `POST ${baseURL}/${model}` with prompt/params.
 *    Returns `{ request_id }` immediately.
 * 2. **Poll** — `GET ${baseURL}/${model}/requests/${request_id}/status`
 *    until `status === 'COMPLETED'` or `'FAILED'`.
 * 3. **Fetch** — `GET ${baseURL}/${model}/requests/${request_id}`
 *    returns `{ audio: { url } }`.
 *
 * ## Authentication
 *
 * Requires a `FAL_API_KEY`. Sent as `Authorization: Key ${apiKey}`.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 * @see {@link FalVideoProvider} for the video counterpart.
 * @see {@link FalImageProvider} for the image counterpart.
 */
import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from '../types.js';
/**
 * Configuration for the Fal.ai audio generation provider.
 *
 * @example
 * ```typescript
 * const config: FalAudioProviderConfig = {
 *   apiKey: process.env.FAL_API_KEY!,
 *   defaultModelId: 'fal-ai/stable-audio',
 * };
 * ```
 */
export interface FalAudioProviderConfig {
    /**
     * Fal.ai API key. Sent as `Authorization: Key ${apiKey}`.
     * Obtain from https://fal.ai/dashboard/keys
     */
    apiKey: string;
    /**
     * Base URL for the Fal.ai queue API. Override for testing or proxy setups.
     * @default 'https://queue.fal.run'
     */
    baseURL?: string;
    /**
     * Default model to use when the request doesn't specify one.
     * @default 'fal-ai/stable-audio'
     */
    defaultModelId?: string;
    /**
     * Milliseconds between status polls while waiting for generation.
     * @default 2000
     */
    pollIntervalMs?: number;
    /**
     * Maximum milliseconds to wait for generation before timing out.
     * @default 300000
     */
    timeoutMs?: number;
}
/**
 * Audio generation provider connecting to the Fal.ai serverless platform.
 *
 * Implements the three-step queue pattern: submit a generation task,
 * poll the status endpoint until completion, then fetch the result.
 * This mirrors the flow used by {@link FalVideoProvider}.
 *
 * Supports both music and SFX generation through the same endpoint.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new FalAudioProvider();
 * await provider.initialize({ apiKey: process.env.FAL_API_KEY! });
 *
 * const result = await provider.generateMusic({
 *   modelId: 'fal-ai/stable-audio',
 *   prompt: 'A dreamy ambient track with reverb-heavy synths',
 *   durationSec: 30,
 * });
 * console.log(result.audio[0].url);
 * ```
 */
export declare class FalAudioProvider implements IAudioGenerator {
    /** @inheritdoc */
    readonly providerId = "fal-audio";
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
     * Generate music from a text prompt using the Fal.ai queue API.
     *
     * Submits the task, polls until complete, then fetches the result.
     *
     * @param request - Music generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    generateMusic(request: MusicGenerateRequest): Promise<AudioResult>;
    /**
     * Generate a sound effect from a text prompt using the Fal.ai queue API.
     *
     * Submits the task, polls until complete, then fetches the result.
     *
     * @param request - SFX generation request with prompt and optional params.
     * @returns The generated audio result envelope.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If the API returns an error or times out.
     */
    generateSFX(request: SFXGenerateRequest): Promise<AudioResult>;
    /**
     * Fal.ai audio supports both music and SFX generation.
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
     * Run the full three-step generation flow: submit, poll, fetch.
     *
     * @param prompt - Text description of the desired audio.
     * @param durationSec - Desired duration in seconds.
     * @param modelId - Optional model override.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If any step of the flow fails.
     * @internal
     */
    private _generate;
    /**
     * Submit a generation task to the Fal.ai queue.
     *
     * @param model - Full model path (e.g. 'fal-ai/stable-audio').
     * @param body - Request body with prompt and generation params.
     * @returns The request_id for status polling.
     *
     * @throws {Error} If the submission request fails.
     * @internal
     */
    private _submitTask;
    /**
     * Poll the Fal.ai status endpoint until the task completes or times out.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     *
     * @throws {Error} If the generation fails or times out.
     * @internal
     */
    private _pollStatus;
    /**
     * Fetch the completed generation result from the Fal.ai result endpoint.
     *
     * Called after polling confirms the task is COMPLETED.
     *
     * @param model - Full model path.
     * @param requestId - The request ID from submission.
     * @returns The generation result with audio URL.
     *
     * @throws {Error} If the result fetch fails.
     * @internal
     */
    private _fetchResult;
    /**
     * Build an {@link AudioResult} from a completed Fal.ai result.
     *
     * @param result - The Fal.ai result response.
     * @param model - Model ID used for the generation.
     * @returns Normalized audio result envelope.
     *
     * @throws {Error} If the result has no audio URL.
     * @internal
     */
    private _buildResult;
}
//# sourceMappingURL=FalAudioProvider.d.ts.map
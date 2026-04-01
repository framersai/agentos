/**
 * @module media/audio/providers/AudioGenLocalProvider
 *
 * Local sound effect generation provider using Meta's AudioGen model via
 * the `@huggingface/transformers` library.
 *
 * AudioGen runs entirely on the local machine without any API keys or
 * network requests. The model is loaded lazily on first use through the
 * `pipeline('text-to-audio', ...)` API from HuggingFace Transformers.js.
 *
 * ## Requirements
 *
 * - `@huggingface/transformers` must be installed as a peer dependency.
 *   If not installed, the provider throws a helpful error message.
 * - Sufficient RAM/VRAM for model inference (Xenova/audiogen-medium ~2GB).
 *
 * ## Supported models
 *
 * | Model ID                    | Description                        |
 * |-----------------------------|------------------------------------|
 * | `Xenova/audiogen-medium`    | AudioGen Medium — default, ~2GB    |
 *
 * ## API flow (local inference)
 *
 * 1. **Load** — `pipeline('text-to-audio', modelId)` (lazy, cached).
 * 2. **Generate** — `pipeline(prompt, { max_new_tokens })` returns audio tensor.
 * 3. **Encode** — Convert raw audio data to WAV format.
 *
 * @see {@link IAudioGenerator} for the provider interface contract.
 * @see {@link MusicGenLocalProvider} for the music counterpart.
 */
import type { IAudioGenerator } from '../IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from '../types.js';
/**
 * Configuration for the AudioGen local provider.
 *
 * @example
 * ```typescript
 * const config: AudioGenLocalProviderConfig = {
 *   modelId: 'Xenova/audiogen-medium',
 * };
 * ```
 */
export interface AudioGenLocalProviderConfig {
    /**
     * HuggingFace model ID for the AudioGen model.
     * @default 'Xenova/audiogen-medium'
     */
    modelId?: string;
}
/**
 * Local sound effect generation provider using Meta's AudioGen model.
 *
 * Runs inference entirely on the local machine via `@huggingface/transformers`.
 * The model is loaded lazily on first call to `generateSFX()` or
 * explicitly via `initialize()`.
 *
 * @implements {IAudioGenerator}
 *
 * @example
 * ```typescript
 * const provider = new AudioGenLocalProvider();
 * await provider.initialize({ modelId: 'Xenova/audiogen-medium' });
 *
 * const result = await provider.generateSFX({
 *   prompt: 'Dog barking loudly in a park',
 *   durationSec: 5,
 * });
 * console.log(result.audio[0].base64?.substring(0, 50) + '...');
 * ```
 */
export declare class AudioGenLocalProvider implements IAudioGenerator {
    /** @inheritdoc */
    readonly providerId = "audiogen-local";
    /** @inheritdoc */
    isInitialized: boolean;
    /** @inheritdoc */
    defaultModelId?: string;
    /** The loaded text-to-audio pipeline instance. */
    private _pipeline;
    /** The resolved model ID. */
    private _modelId;
    /**
     * Initialize the provider and optionally pre-load the model.
     *
     * The model is loaded lazily on first generation call. Calling initialize
     * sets the configuration but does not load the model unless the pipeline
     * was already created.
     *
     * @param config - Configuration object with optional `modelId`.
     */
    initialize(config: Record<string, unknown>): Promise<void>;
    /**
     * Music generation is not supported by AudioGen.
     *
     * @throws {Error} Always throws — use {@link MusicGenLocalProvider} instead.
     */
    generateMusic(_request: MusicGenerateRequest): Promise<AudioResult>;
    /**
     * Generate a sound effect from a text prompt using the local AudioGen model.
     *
     * On first call, loads the model pipeline (may take several seconds).
     * Subsequent calls reuse the cached pipeline instance.
     *
     * @param request - SFX generation request with prompt and optional params.
     * @returns The generated audio result envelope with base64-encoded WAV data.
     *
     * @throws {Error} If the provider is not initialized.
     * @throws {Error} If `@huggingface/transformers` is not installed.
     */
    generateSFX(request: SFXGenerateRequest): Promise<AudioResult>;
    /**
     * AudioGen supports SFX generation only.
     *
     * @param capability - The capability to check.
     * @returns `true` only for `'sfx'`; `false` for `'music'`.
     */
    supports(capability: 'music' | 'sfx'): boolean;
    /**
     * Release model resources and reset initialization state.
     */
    shutdown(): Promise<void>;
    /**
     * Ensure the text-to-audio pipeline is loaded, creating it lazily if needed.
     *
     * Uses dynamic `import()` to load `@huggingface/transformers` as an optional
     * peer dependency. Throws a helpful error if the package is not installed.
     *
     * @returns The loaded pipeline callable.
     *
     * @throws {Error} If `@huggingface/transformers` is not installed.
     * @internal
     */
    private _ensurePipeline;
}
//# sourceMappingURL=AudioGenLocalProvider.d.ts.map
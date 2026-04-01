/**
 * @file FallbackImageProxy.ts
 * Automatic failover proxy for image generation, editing, upscaling,
 * and variation providers.
 *
 * Follows the same pattern established by {@link FallbackSTTProxy} and
 * {@link FallbackTTSProxy} in the speech subsystem: an ordered chain of
 * {@link IImageProvider} instances is tried left-to-right for each
 * operation.  The first provider that succeeds wins; earlier failures
 * are caught, logged via an emitted event, and the next provider is
 * tried.
 *
 * ## Unsupported-operation handling
 *
 * For optional operations (`editImage`, `upscaleImage`, `variateImage`)
 * the proxy skips providers that either:
 * - do not implement the method at all (`typeof method !== 'function'`), or
 * - throw an error whose `name` ends with `NotSupportedError` (the convention
 *   used by {@link ImageEditNotSupportedError},
 *   {@link ImageUpscaleNotSupportedError}, and
 *   {@link ImageVariationNotSupportedError}).
 *
 * Both cases are treated as "this provider cannot help" rather than
 * transient failures, so the proxy advances to the next candidate
 * without counting the skip as a true error.
 *
 * @see {@link FallbackSTTProxy} for the analogous speech-to-text proxy.
 * @see {@link FallbackTTSProxy} for the analogous text-to-speech proxy.
 *
 * @example
 * ```ts
 * import { EventEmitter } from 'events';
 * import { FallbackImageProxy } from './FallbackImageProxy.js';
 *
 * const emitter = new EventEmitter();
 * emitter.on('image:fallback', (evt) => {
 *   console.warn(`Image fallback: ${evt.from} -> ${evt.to} (${evt.reason})`);
 * });
 *
 * const proxy = new FallbackImageProxy(
 *   [openaiProvider, stabilityProvider, replicateProvider],
 *   emitter,
 * );
 *
 * // If OpenAI fails, Stability is tried, then Replicate.
 * const result = await proxy.generateImage(request);
 * ```
 */
import { EventEmitter } from 'events';
import type { IImageProvider, ImageGenerationRequest, ImageGenerationResult, ImageEditRequest, ImageUpscaleRequest, ImageVariateRequest, ImageModelInfo } from './IImageProvider.js';
/**
 * Payload emitted on the `image:fallback` event when a provider in the
 * chain fails and the proxy advances to the next candidate.
 *
 * @example
 * ```ts
 * emitter.on('image:fallback', (evt: ImageFallbackEvent) => {
 *   console.warn(`${evt.from} -> ${evt.to}: ${evt.reason}`);
 * });
 * ```
 */
export interface ImageFallbackEvent {
    /** The event discriminator. Always `'image:fallback'`. */
    type: 'image:fallback';
    /** Identifier of the provider that failed. */
    from: string;
    /** Identifier of the provider that will be tried next. */
    to: string;
    /** Human-readable reason for the fallback (error message or "not supported"). */
    reason: string;
}
/**
 * An {@link IImageProvider} that wraps an ordered chain of image providers
 * and implements automatic failover for every operation.
 *
 * ## Retry chain logic
 *
 * Providers are tried left-to-right (index 0 first). The first provider
 * that succeeds returns immediately. When a provider throws:
 *
 * - **If it is NOT the last provider:** a `image:fallback` event is
 *   emitted and the next provider is tried.
 * - **If it IS the last provider:** an `AggregateError` containing every
 *   collected error is thrown.
 * - **If the chain is empty:** an `Error('No providers in image fallback chain')`
 *   is thrown immediately.
 *
 * For optional operations (edit/upscale/variate), providers that do not
 * implement the method or throw a `*NotSupportedError` are silently
 * skipped, since they are structurally incapable rather than transiently
 * failing.
 */
export declare class FallbackImageProxy implements IImageProvider {
    private readonly chain;
    private readonly emitter;
    /** Identifier derived from the first provider in the chain. */
    readonly providerId: string;
    /** Always `true` — the proxy is ready as soon as it is constructed. */
    readonly isInitialized: boolean;
    /** Default model from the first provider, if set. */
    readonly defaultModelId?: string;
    /**
     * Creates a new FallbackImageProxy wrapping the given provider chain.
     *
     * @param chain - Ordered list of image providers to try. Must contain at
     *   least one entry for operations to succeed (an empty chain always throws).
     * @param emitter - EventEmitter on which `image:fallback` events are
     *   published so callers can observe the failover path.
     *
     * @example
     * ```ts
     * const proxy = new FallbackImageProxy(
     *   [openaiProvider, stabilityProvider],
     *   new EventEmitter(),
     * );
     * ```
     */
    constructor(chain: IImageProvider[], emitter: EventEmitter);
    /**
     * No-op initialisation — individual providers in the chain should already
     * be initialised before being passed to the proxy.
     */
    initialize(_config: Record<string, unknown>): Promise<void>;
    /**
     * Generate an image, falling back through the provider chain on failure.
     *
     * @param request - The generation request forwarded to each provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider in the chain fails.
     * @throws {Error} When the chain is empty.
     */
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
    /**
     * Edit an image, falling back through providers that support editing.
     *
     * Providers that do not implement `editImage` or that throw a
     * `*NotSupportedError` are silently skipped.
     *
     * @param request - The edit request forwarded to each capable provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider fails or does not support editing.
     */
    editImage(request: ImageEditRequest): Promise<ImageGenerationResult>;
    /**
     * Upscale an image, falling back through providers that support upscaling.
     *
     * @param request - The upscale request forwarded to each capable provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider fails or does not support upscaling.
     */
    upscaleImage(request: ImageUpscaleRequest): Promise<ImageGenerationResult>;
    /**
     * Generate variations of an image, falling back through providers that
     * support the operation.
     *
     * @param request - The variation request forwarded to each capable provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider fails or does not support variations.
     */
    variateImage(request: ImageVariateRequest): Promise<ImageGenerationResult>;
    /**
     * Returns the model list from the first provider in the chain that
     * implements `listAvailableModels`. Returns an empty array when none do.
     */
    listAvailableModels(): Promise<ImageModelInfo[]>;
    /**
     * Shuts down all providers in the chain. Errors are caught per-provider
     * so a single provider's failure does not prevent the others from
     * cleaning up.
     */
    shutdown(): Promise<void>;
    /**
     * Executes an operation against each provider in the chain until one
     * succeeds or all have been exhausted.
     *
     * @param operationName - Human-readable name of the operation (for error messages).
     * @param execute - Async callback that runs the operation on a single provider.
     * @returns The result from the first successful provider.
     * @throws {AggregateError} When every provider fails.
     */
    private runWithFallback;
}
//# sourceMappingURL=FallbackImageProxy.d.ts.map
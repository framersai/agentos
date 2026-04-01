/**
 * @file FallbackVideoProxy.ts
 * Automatic failover proxy for video generation providers.
 *
 * Follows the same pattern established by {@link FallbackImageProxy} in the
 * image subsystem: an ordered chain of {@link IVideoGenerator} instances is
 * tried left-to-right for each operation. The first provider that succeeds
 * wins; earlier failures are caught, logged via an emitted event, and the
 * next provider is tried.
 *
 * ## Unsupported-operation handling
 *
 * For the optional `imageToVideo` operation the proxy skips providers whose
 * {@link IVideoGenerator.supports} method returns `false` for
 * `'image-to-video'`. Skipped providers are not counted as transient failures
 * — the proxy simply advances to the next candidate.
 *
 * @see {@link FallbackImageProxy} for the analogous image proxy.
 * @see {@link FallbackSTTProxy} for the analogous speech-to-text proxy.
 *
 * @example
 * ```ts
 * import { EventEmitter } from 'events';
 * import { FallbackVideoProxy } from './FallbackVideoProxy.js';
 *
 * const emitter = new EventEmitter();
 * emitter.on('video:generate:fallback', (evt) => {
 *   console.warn(`Video fallback: ${evt.from} -> ${evt.to} (${evt.reason})`);
 * });
 *
 * const proxy = new FallbackVideoProxy(
 *   [runwayProvider, pikaProvider, klingProvider],
 *   emitter,
 * );
 *
 * // If Runway fails, Pika is tried, then Kling.
 * const result = await proxy.generateVideo(request);
 * ```
 */
import { EventEmitter } from 'events';
import type { IVideoGenerator } from './IVideoGenerator.js';
import type { VideoGenerateRequest, ImageToVideoRequest, VideoResult } from './types.js';
/**
 * Payload emitted on the `video:generate:fallback` event when a provider in
 * the chain fails and the proxy advances to the next candidate.
 *
 * @example
 * ```ts
 * emitter.on('video:generate:fallback', (evt: VideoFallbackEvent) => {
 *   console.warn(`${evt.from} -> ${evt.to}: ${evt.reason}`);
 * });
 * ```
 */
export interface VideoFallbackEvent {
    /** The event discriminator. Always `'video:generate:fallback'`. */
    type: 'video:generate:fallback';
    /** Identifier of the provider that failed. */
    from: string;
    /** Identifier of the provider that will be tried next. */
    to: string;
    /** Human-readable reason for the fallback (error message or "not supported"). */
    reason: string;
}
/**
 * An {@link IVideoGenerator} that wraps an ordered chain of video providers
 * and implements automatic failover for every operation.
 *
 * ## Retry chain logic
 *
 * Providers are tried left-to-right (index 0 first). The first provider
 * that succeeds returns immediately. When a provider throws:
 *
 * - **If it is NOT the last provider:** a `video:generate:fallback` event is
 *   emitted and the next provider is tried.
 * - **If it IS the last provider:** an `AggregateError` containing every
 *   collected error is thrown.
 * - **If the chain is empty:** an `Error('No providers in video fallback chain')`
 *   is thrown immediately.
 *
 * For the optional `imageToVideo` operation, providers whose
 * {@link IVideoGenerator.supports} returns `false` for `'image-to-video'`
 * are silently skipped, since they are structurally incapable rather than
 * transiently failing.
 */
export declare class FallbackVideoProxy implements IVideoGenerator {
    private readonly chain;
    private readonly emitter;
    /** Identifier derived from the first provider in the chain. */
    readonly providerId: string;
    /** Always `true` — the proxy is ready as soon as it is constructed. */
    readonly isInitialized: boolean;
    /** Default model from the first provider, if set. */
    readonly defaultModelId?: string;
    /**
     * Creates a new FallbackVideoProxy wrapping the given provider chain.
     *
     * @param chain - Ordered list of video providers to try. Must contain at
     *   least one entry for operations to succeed (an empty chain always throws).
     * @param emitter - EventEmitter on which `video:generate:fallback` events
     *   are published so callers can observe the failover path.
     *
     * @example
     * ```ts
     * const proxy = new FallbackVideoProxy(
     *   [runwayProvider, pikaProvider],
     *   new EventEmitter(),
     * );
     * ```
     */
    constructor(chain: IVideoGenerator[], emitter: EventEmitter);
    /**
     * No-op initialisation — individual providers in the chain should already
     * be initialised before being passed to the proxy.
     */
    initialize(_config: Record<string, unknown>): Promise<void>;
    /**
     * Returns `true` if at least one provider in the chain supports the
     * given capability.
     *
     * @param capability - The capability to query.
     */
    supports(capability: 'text-to-video' | 'image-to-video'): boolean;
    /**
     * Generate a video from a text prompt, falling back through the provider
     * chain on failure.
     *
     * @param request - The generation request forwarded to each provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider in the chain fails.
     * @throws {Error} When the chain is empty.
     */
    generateVideo(request: VideoGenerateRequest): Promise<VideoResult>;
    /**
     * Generate a video from a source image, falling back through providers
     * that support image-to-video.
     *
     * Providers whose {@link IVideoGenerator.supports} returns `false` for
     * `'image-to-video'` are silently skipped.
     *
     * @param request - The image-to-video request forwarded to each capable provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider fails or does not support image-to-video.
     */
    imageToVideo(request: ImageToVideoRequest): Promise<VideoResult>;
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
     * Providers that throw an error whose `name` ends with `NotSupportedError`
     * are treated as structurally incapable — the reason is recorded as
     * "not supported" rather than the raw error message.
     *
     * @param operationName - Human-readable name of the operation (for error messages).
     * @param execute - Async callback that runs the operation on a single provider.
     * @returns The result from the first successful provider.
     * @throws {AggregateError} When every provider fails.
     */
    private runWithFallback;
}
//# sourceMappingURL=FallbackVideoProxy.d.ts.map
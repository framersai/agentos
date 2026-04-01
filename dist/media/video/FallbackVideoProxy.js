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
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Extracts a human-readable reason string from an unknown error value.
 */
function errorReason(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
// ---------------------------------------------------------------------------
// FallbackVideoProxy
// ---------------------------------------------------------------------------
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
export class FallbackVideoProxy {
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
    constructor(chain, emitter) {
        this.chain = chain;
        this.emitter = emitter;
        /** Always `true` — the proxy is ready as soon as it is constructed. */
        this.isInitialized = true;
        this.providerId = chain[0]?.providerId ?? 'fallback-video';
        this.defaultModelId = chain[0]?.defaultModelId;
    }
    // -----------------------------------------------------------------------
    // IVideoGenerator — initialize (no-op for the proxy itself)
    // -----------------------------------------------------------------------
    /**
     * No-op initialisation — individual providers in the chain should already
     * be initialised before being passed to the proxy.
     */
    async initialize(_config) {
        // Each provider in the chain is initialised independently before
        // construction, so the proxy itself has nothing to set up.
    }
    // -----------------------------------------------------------------------
    // IVideoGenerator — supports
    // -----------------------------------------------------------------------
    /**
     * Returns `true` if at least one provider in the chain supports the
     * given capability.
     *
     * @param capability - The capability to query.
     */
    supports(capability) {
        return this.chain.some((provider) => provider.supports(capability));
    }
    // -----------------------------------------------------------------------
    // IVideoGenerator — generateVideo
    // -----------------------------------------------------------------------
    /**
     * Generate a video from a text prompt, falling back through the provider
     * chain on failure.
     *
     * @param request - The generation request forwarded to each provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider in the chain fails.
     * @throws {Error} When the chain is empty.
     */
    async generateVideo(request) {
        return this.runWithFallback('generateVideo', (provider) => provider.generateVideo(request));
    }
    // -----------------------------------------------------------------------
    // IVideoGenerator — imageToVideo (optional)
    // -----------------------------------------------------------------------
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
    async imageToVideo(request) {
        return this.runWithFallback('imageToVideo', (provider) => {
            if (!provider.supports('image-to-video') || typeof provider.imageToVideo !== 'function') {
                throw Object.assign(new Error(`Provider "${provider.providerId}" does not support imageToVideo.`), { name: 'ImageToVideoNotSupportedError' });
            }
            return provider.imageToVideo(request);
        });
    }
    // -----------------------------------------------------------------------
    // IVideoGenerator — shutdown (optional)
    // -----------------------------------------------------------------------
    /**
     * Shuts down all providers in the chain. Errors are caught per-provider
     * so a single provider's failure does not prevent the others from
     * cleaning up.
     */
    async shutdown() {
        for (const provider of this.chain) {
            if (typeof provider.shutdown === 'function') {
                try {
                    await provider.shutdown();
                }
                catch {
                    // Swallow individual shutdown errors — best effort.
                }
            }
        }
    }
    // -----------------------------------------------------------------------
    // Core fallback loop
    // -----------------------------------------------------------------------
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
    async runWithFallback(operationName, execute) {
        if (this.chain.length === 0) {
            throw new Error('No providers in video fallback chain');
        }
        const errors = [];
        for (let i = 0; i < this.chain.length; i++) {
            const provider = this.chain[i];
            try {
                return await execute(provider);
            }
            catch (err) {
                const isNotSupported = err instanceof Error && err.name.endsWith('NotSupportedError');
                const reason = isNotSupported
                    ? `${operationName} not supported`
                    : errorReason(err);
                errors.push(err instanceof Error ? err : new Error(String(err)));
                // Emit a fallback event when there is a next provider to try.
                if (i < this.chain.length - 1) {
                    const event = {
                        type: 'video:generate:fallback',
                        from: provider.providerId,
                        to: this.chain[i + 1].providerId,
                        reason,
                    };
                    this.emitter.emit('video:generate:fallback', event);
                }
            }
        }
        // All providers exhausted — throw an aggregate error.
        throw new AggregateError(errors, `All ${this.chain.length} video providers failed for ${operationName}: ${errors.map((e) => e.message).join('; ')}`);
    }
}
//# sourceMappingURL=FallbackVideoProxy.js.map
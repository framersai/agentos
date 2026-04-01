/**
 * @file FallbackAudioProxy.ts
 * Automatic failover proxy for audio generation providers.
 *
 * Follows the same pattern established by {@link FallbackVideoProxy} in the
 * video subsystem: an ordered chain of {@link IAudioGenerator} instances is
 * tried left-to-right for each operation. The first provider that succeeds
 * wins; earlier failures are caught, logged via an emitted event, and the
 * next provider is tried.
 *
 * ## Sub-modality handling
 *
 * For the optional `generateSFX` operation the proxy skips providers whose
 * {@link IAudioGenerator.supports} method returns `false` for `'sfx'`.
 * Likewise, `generateMusic` skips providers that don't support `'music'`.
 * Skipped providers are not counted as transient failures — the proxy simply
 * advances to the next candidate.
 *
 * @see {@link FallbackVideoProxy} for the analogous video proxy.
 * @see {@link FallbackImageProxy} for the analogous image proxy.
 *
 * @example
 * ```ts
 * import { EventEmitter } from 'events';
 * import { FallbackAudioProxy } from './FallbackAudioProxy.js';
 *
 * const emitter = new EventEmitter();
 * emitter.on('audio:generate:fallback', (evt) => {
 *   console.warn(`Audio fallback: ${evt.from} -> ${evt.to} (${evt.reason})`);
 * });
 *
 * const proxy = new FallbackAudioProxy(
 *   [sunoProvider, stableAudioProvider, elevenLabsProvider],
 *   emitter,
 * );
 *
 * // If Suno fails, Stable Audio is tried, then ElevenLabs.
 * const result = await proxy.generateMusic(request);
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
// FallbackAudioProxy
// ---------------------------------------------------------------------------
/**
 * An {@link IAudioGenerator} that wraps an ordered chain of audio providers
 * and implements automatic failover for every operation.
 *
 * ## Retry chain logic
 *
 * Providers are tried left-to-right (index 0 first). The first provider
 * that succeeds returns immediately. When a provider throws:
 *
 * - **If it is NOT the last provider:** an `audio:generate:fallback` event is
 *   emitted and the next provider is tried.
 * - **If it IS the last provider:** an `AggregateError` containing every
 *   collected error is thrown.
 * - **If the chain is empty:** an `Error('No providers in audio fallback chain')`
 *   is thrown immediately.
 *
 * For `generateMusic`, providers whose {@link IAudioGenerator.supports} returns
 * `false` for `'music'` are silently skipped. For `generateSFX`, providers
 * that don't support `'sfx'` (or lack the method entirely) are skipped.
 */
export class FallbackAudioProxy {
    /**
     * Creates a new FallbackAudioProxy wrapping the given provider chain.
     *
     * @param chain - Ordered list of audio providers to try. Must contain at
     *   least one entry for operations to succeed (an empty chain always throws).
     * @param emitter - EventEmitter on which `audio:generate:fallback` events
     *   are published so callers can observe the failover path.
     *
     * @example
     * ```ts
     * const proxy = new FallbackAudioProxy(
     *   [sunoProvider, stableAudioProvider],
     *   new EventEmitter(),
     * );
     * ```
     */
    constructor(chain, emitter) {
        this.chain = chain;
        this.emitter = emitter;
        /** Always `true` — the proxy is ready as soon as it is constructed. */
        this.isInitialized = true;
        this.providerId = chain[0]?.providerId ?? 'fallback-audio';
        this.defaultModelId = chain[0]?.defaultModelId;
    }
    // -----------------------------------------------------------------------
    // IAudioGenerator — initialize (no-op for the proxy itself)
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
    // IAudioGenerator — supports
    // -----------------------------------------------------------------------
    /**
     * Returns `true` if at least one provider in the chain supports the
     * given capability.
     *
     * @param capability - The capability to query (`'music'` or `'sfx'`).
     */
    supports(capability) {
        return this.chain.some((provider) => provider.supports(capability));
    }
    // -----------------------------------------------------------------------
    // IAudioGenerator — generateMusic
    // -----------------------------------------------------------------------
    /**
     * Generate music from a text prompt, falling back through the provider
     * chain on failure.
     *
     * Providers whose {@link IAudioGenerator.supports} returns `false` for
     * `'music'` are silently skipped.
     *
     * @param request - The generation request forwarded to each provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider in the chain fails.
     * @throws {Error} When the chain is empty.
     */
    async generateMusic(request) {
        return this.runWithFallback('generateMusic', (provider) => {
            if (!provider.supports('music')) {
                throw Object.assign(new Error(`Provider "${provider.providerId}" does not support music generation.`), { name: 'MusicNotSupportedError' });
            }
            return provider.generateMusic(request);
        });
    }
    // -----------------------------------------------------------------------
    // IAudioGenerator — generateSFX (optional)
    // -----------------------------------------------------------------------
    /**
     * Generate a sound effect from a text prompt, falling back through providers
     * that support SFX.
     *
     * Providers whose {@link IAudioGenerator.supports} returns `false` for
     * `'sfx'` or that lack the `generateSFX` method are silently skipped.
     *
     * @param request - The SFX request forwarded to each capable provider.
     * @returns The result from the first provider that succeeds.
     * @throws {AggregateError} When every provider fails or does not support SFX.
     */
    async generateSFX(request) {
        return this.runWithFallback('generateSFX', (provider) => {
            if (!provider.supports('sfx') || typeof provider.generateSFX !== 'function') {
                throw Object.assign(new Error(`Provider "${provider.providerId}" does not support SFX generation.`), { name: 'SFXNotSupportedError' });
            }
            return provider.generateSFX(request);
        });
    }
    // -----------------------------------------------------------------------
    // IAudioGenerator — shutdown (optional)
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
            throw new Error('No providers in audio fallback chain');
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
                        type: 'audio:generate:fallback',
                        from: provider.providerId,
                        to: this.chain[i + 1].providerId,
                        reason,
                    };
                    this.emitter.emit('audio:generate:fallback', event);
                }
            }
        }
        // All providers exhausted — throw an aggregate error.
        throw new AggregateError(errors, `All ${this.chain.length} audio providers failed for ${operationName}: ${errors.map((e) => e.message).join('; ')}`);
    }
}
//# sourceMappingURL=FallbackAudioProxy.js.map
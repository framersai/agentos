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
import { EventEmitter } from 'events';
import type { IAudioGenerator } from './IAudioGenerator.js';
import type { MusicGenerateRequest, SFXGenerateRequest, AudioResult } from './types.js';
/**
 * Payload emitted on the `audio:generate:fallback` event when a provider in
 * the chain fails and the proxy advances to the next candidate.
 *
 * @example
 * ```ts
 * emitter.on('audio:generate:fallback', (evt: AudioFallbackEvent) => {
 *   console.warn(`${evt.from} -> ${evt.to}: ${evt.reason}`);
 * });
 * ```
 */
export interface AudioFallbackEvent {
    /** The event discriminator. Always `'audio:generate:fallback'`. */
    type: 'audio:generate:fallback';
    /** Identifier of the provider that failed. */
    from: string;
    /** Identifier of the provider that will be tried next. */
    to: string;
    /** Human-readable reason for the fallback (error message or "not supported"). */
    reason: string;
}
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
export declare class FallbackAudioProxy implements IAudioGenerator {
    private readonly chain;
    private readonly emitter;
    /** Identifier derived from the first provider in the chain. */
    readonly providerId: string;
    /** Always `true` — the proxy is ready as soon as it is constructed. */
    readonly isInitialized: boolean;
    /** Default model from the first provider, if set. */
    readonly defaultModelId?: string;
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
    constructor(chain: IAudioGenerator[], emitter: EventEmitter);
    /**
     * No-op initialisation — individual providers in the chain should already
     * be initialised before being passed to the proxy.
     */
    initialize(_config: Record<string, unknown>): Promise<void>;
    /**
     * Returns `true` if at least one provider in the chain supports the
     * given capability.
     *
     * @param capability - The capability to query (`'music'` or `'sfx'`).
     */
    supports(capability: 'music' | 'sfx'): boolean;
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
    generateMusic(request: MusicGenerateRequest): Promise<AudioResult>;
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
    generateSFX(request: SFXGenerateRequest): Promise<AudioResult>;
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
//# sourceMappingURL=FallbackAudioProxy.d.ts.map
import { EventEmitter } from 'events';
import type { SpeechToTextProvider, TextToSpeechProvider, SpeechAudioInput, SpeechTranscriptionOptions, SpeechTranscriptionResult, SpeechSynthesisOptions, SpeechSynthesisResult, SpeechVoice } from './types.js';
/**
 * Payload emitted on the `provider_fallback` event when a provider in the
 * chain fails and the proxy advances to the next candidate.
 *
 * This event is emitted on the `EventEmitter` passed to the proxy
 * constructor — typically the `SpeechProviderResolver` instance — so
 * that callers can observe and log the fallback path without coupling to
 * the proxy internals.
 *
 * @see {@link FallbackSTTProxy} for STT fallback chain usage
 * @see {@link FallbackTTSProxy} for TTS fallback chain usage
 *
 * @example
 * ```ts
 * resolver.on('provider_fallback', (event: ProviderFallbackEvent) => {
 *   console.warn(`${event.kind} fallback: ${event.from} -> ${event.to}`, event.error);
 * });
 * ```
 */
export interface ProviderFallbackEvent {
    /** Unique identifier of the provider that failed. */
    from: string;
    /** Unique identifier of the provider that will be tried next. */
    to: string;
    /** Whether this is an STT or TTS fallback chain. */
    kind: 'stt' | 'tts';
    /**
     * The error thrown by the failing provider. Typed as `unknown` because
     * providers may throw non-Error values (e.g. string messages, API response
     * objects). Callers should use `instanceof Error` before accessing `.message`.
     */
    error: unknown;
}
/**
 * A {@link SpeechToTextProvider} that wraps an ordered chain of STT providers
 * and implements automatic failover.
 *
 * ## Retry Chain Logic
 *
 * Providers are tried left-to-right (index 0 first, then 1, etc.). The first
 * successful transcription result is returned immediately. When a provider
 * throws:
 *
 * - **If it is NOT the last provider:** The error is caught, a
 *   `provider_fallback` event is emitted on the shared `EventEmitter`,
 *   and the next provider is tried. Errors are caught per-provider so that a
 *   single API outage doesn't block the entire pipeline.
 *
 * - **If it IS the last provider:** The error is re-thrown to the caller,
 *   since there are no more fallbacks to try.
 *
 * - **If the chain is empty:** An `Error('No providers in fallback chain')`
 *   is thrown immediately.
 *
 * ## Why Errors are Caught Per-Provider
 *
 * Each provider in the chain operates independently. A Deepgram API key
 * expiration should not prevent OpenAI Whisper from transcribing the same
 * audio. Catching errors per-provider ensures maximum availability at the
 * cost of slightly increased latency when early providers fail.
 *
 * @see {@link ProviderFallbackEvent} for the event payload shape
 * See `SpeechProviderResolver.resolveSTT()` for how this proxy is created.
 *
 * @example
 * ```ts
 * const proxy = new FallbackSTTProxy([whisperProvider, deepgramProvider], emitter);
 * const result = await proxy.transcribe(audio);
 * // If whisperProvider fails, deepgramProvider is tried automatically.
 * ```
 */
export declare class FallbackSTTProxy implements SpeechToTextProvider {
    private readonly chain;
    private readonly emitter;
    /**
     * Unique identifier derived from the first provider in the chain.
     * Falls back to `'fallback-stt'` for empty chains to avoid undefined access.
     */
    readonly id: string;
    /**
     * Human-readable name showing the full chain for debugging and logging.
     * Format: `"Fallback STT (provider1 -> provider2 -> ...)"`.
     */
    readonly displayName: string;
    /**
     * Whether the proxy supports streaming. Only `true` when the first
     * (primary) provider supports streaming — fallback providers' streaming
     * capabilities are not considered because mid-stream provider switching
     * is not supported.
     */
    readonly supportsStreaming: boolean;
    /**
     * Creates a new FallbackSTTProxy wrapping the given provider chain.
     *
     * @param chain - Ordered list of STT providers to try. Must contain at least
     *   one entry for `transcribe()` to succeed, though an empty chain is allowed
     *   at construction time (it will always throw on transcribe).
     * @param emitter - EventEmitter on which `provider_fallback` events are
     *   published. Typically the {@link SpeechProviderResolver} instance.
     *
     * @example
     * ```ts
     * const proxy = new FallbackSTTProxy(
     *   [primaryProvider, fallbackProvider],
     *   resolver, // extends EventEmitter
     * );
     * ```
     */
    constructor(chain: SpeechToTextProvider[], emitter: EventEmitter);
    /**
     * Attempt transcription using each provider in the chain in order.
     *
     * Emits a `provider_fallback` event (typed as {@link ProviderFallbackEvent})
     * whenever a non-final provider throws. Re-throws the last provider's error
     * when the entire chain is exhausted.
     *
     * @param audio - The audio input to transcribe.
     * @param options - Optional transcription settings (language, model, etc.).
     * @returns The transcription result from the first provider that succeeds.
     * @throws {Error} `'No providers in fallback chain'` when the chain is empty.
     * @throws {Error} The last provider's error when all providers in the chain fail.
     *
     * @example
     * ```ts
     * const result = await proxy.transcribe(
     *   { data: wavBuffer, mimeType: 'audio/wav' },
     *   { language: 'en-US' },
     * );
     * ```
     */
    transcribe(audio: SpeechAudioInput, options?: SpeechTranscriptionOptions): Promise<SpeechTranscriptionResult>;
    /**
     * Returns the human-readable name of the primary (first) provider in the chain.
     *
     * @returns The provider name string, or `'fallback'` if the chain is empty.
     *
     * @example
     * ```ts
     * proxy.getProviderName(); // 'OpenAI Whisper' (from the first chain entry)
     * ```
     */
    getProviderName(): string;
}
/**
 * A {@link TextToSpeechProvider} that wraps an ordered chain of TTS providers
 * and implements automatic failover.
 *
 * ## Retry Chain Logic
 *
 * Identical to {@link FallbackSTTProxy}: providers are tried left-to-right,
 * the first successful synthesis result is returned, and `provider_fallback`
 * events are emitted on each intermediate failure.
 *
 * ## Voice Listing
 *
 * Voice listing is delegated to the first provider in the chain that exposes
 * a `listAvailableVoices()` method. If no provider supports this, an empty
 * array is returned. This is a best-effort approach — the voice list may not
 * reflect the provider that actually handles synthesis if the primary fails.
 *
 * @see {@link ProviderFallbackEvent} for the event payload shape
 * See `SpeechProviderResolver.resolveTTS()` for how this proxy is created.
 *
 * @example
 * ```ts
 * const proxy = new FallbackTTSProxy([elevenlabsProvider, openaiTtsProvider], emitter);
 * const audio = await proxy.synthesize('Hello world');
 * // If ElevenLabs fails, OpenAI TTS is tried automatically.
 * ```
 */
export declare class FallbackTTSProxy implements TextToSpeechProvider {
    private readonly chain;
    private readonly emitter;
    /**
     * Unique identifier derived from the first provider in the chain.
     * Falls back to `'fallback-tts'` for empty chains.
     */
    readonly id: string;
    /**
     * Human-readable name showing the full chain for debugging and logging.
     * Format: `"Fallback TTS (provider1 -> provider2 -> ...)"`.
     */
    readonly displayName: string;
    /**
     * Whether the proxy supports streaming. Only reflects the first provider's
     * capability — see `FallbackSTTProxy.supportsStreaming` for rationale.
     */
    readonly supportsStreaming: boolean;
    /**
     * Creates a new FallbackTTSProxy wrapping the given provider chain.
     *
     * @param chain - Ordered list of TTS providers to try.
     * @param emitter - EventEmitter on which `provider_fallback` events are published.
     *
     * @example
     * ```ts
     * const proxy = new FallbackTTSProxy(
     *   [elevenlabsProvider, openaiTtsProvider],
     *   resolver,
     * );
     * ```
     */
    constructor(chain: TextToSpeechProvider[], emitter: EventEmitter);
    /**
     * Attempt synthesis using each provider in the chain in order.
     *
     * Emits a `provider_fallback` event (typed as {@link ProviderFallbackEvent})
     * whenever a non-final provider throws. Re-throws the last provider's error
     * when the entire chain is exhausted.
     *
     * @param text - The text to synthesize into speech.
     * @param options - Optional synthesis settings (voice, speed, format, etc.).
     * @returns The synthesis result from the first provider that succeeds.
     * @throws {Error} `'No providers in fallback chain'` when the chain is empty.
     * @throws {Error} The last provider's error when all providers in the chain fail.
     *
     * @example
     * ```ts
     * const result = await proxy.synthesize('Hello world', { voice: 'nova' });
     * ```
     */
    synthesize(text: string, options?: SpeechSynthesisOptions): Promise<SpeechSynthesisResult>;
    /**
     * Returns the human-readable name of the primary (first) provider.
     *
     * @returns The provider name string, or `'fallback'` if the chain is empty.
     *
     * @example
     * ```ts
     * proxy.getProviderName(); // 'ElevenLabs' (from the first chain entry)
     * ```
     */
    getProviderName(): string;
    /**
     * Returns the voice list from the first provider in the chain that supports
     * `listAvailableVoices()`.
     *
     * Iterates through the chain looking for any provider that implements this
     * optional method. Returns an empty array when no provider supports voice
     * listing. This is a best-effort approach — if the primary provider fails
     * during synthesis and a fallback provider handles it, the returned voice
     * list may not match the provider that actually produced the audio.
     *
     * @returns A promise resolving to an array of available voices, or an empty
     *   array if no provider in the chain supports voice listing.
     *
     * @example
     * ```ts
     * const voices = await proxy.listAvailableVoices();
     * // voices from the first provider that implements the method
     * ```
     */
    listAvailableVoices(): Promise<SpeechVoice[]>;
}
//# sourceMappingURL=FallbackProxy.d.ts.map
// ---------------------------------------------------------------------------
// FallbackSTTProxy
// ---------------------------------------------------------------------------
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
export class FallbackSTTProxy {
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
    constructor(chain, emitter) {
        this.chain = chain;
        this.emitter = emitter;
        this.id = chain[0]?.id ?? 'fallback-stt';
        this.displayName = `Fallback STT (${chain.map((p) => p.id).join(' \u2192 ')})`;
        // Only the primary provider's streaming capability is exposed because
        // we cannot seamlessly switch to a fallback mid-stream.
        this.supportsStreaming = chain[0]?.supportsStreaming ?? false;
    }
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
    async transcribe(audio, options) {
        if (this.chain.length === 0) {
            throw new Error('No providers in fallback chain');
        }
        for (let i = 0; i < this.chain.length; i++) {
            try {
                return await this.chain[i].transcribe(audio, options);
            }
            catch (error) {
                // Only emit a fallback event when there IS a next provider to fall back to.
                // The last provider's error is re-thrown to the caller as-is.
                if (i < this.chain.length - 1) {
                    const event = {
                        from: this.chain[i].id,
                        to: this.chain[i + 1].id,
                        kind: 'stt',
                        error,
                    };
                    this.emitter.emit('provider_fallback', event);
                }
                else {
                    throw error;
                }
            }
        }
        // Unreachable in practice — the loop either returns a result or throws.
        // TypeScript's control flow analysis cannot prove this, so we need an
        // explicit throw to satisfy the return type.
        throw new Error('No providers in fallback chain');
    }
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
    getProviderName() {
        return this.chain[0]?.getProviderName() ?? 'fallback';
    }
}
// ---------------------------------------------------------------------------
// FallbackTTSProxy
// ---------------------------------------------------------------------------
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
export class FallbackTTSProxy {
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
    constructor(chain, emitter) {
        this.chain = chain;
        this.emitter = emitter;
        this.id = chain[0]?.id ?? 'fallback-tts';
        this.displayName = `Fallback TTS (${chain.map((p) => p.id).join(' \u2192 ')})`;
        this.supportsStreaming = chain[0]?.supportsStreaming ?? false;
    }
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
    async synthesize(text, options) {
        if (this.chain.length === 0) {
            throw new Error('No providers in fallback chain');
        }
        for (let i = 0; i < this.chain.length; i++) {
            try {
                return await this.chain[i].synthesize(text, options);
            }
            catch (error) {
                // Emit fallback event for all providers except the last one.
                // See FallbackSTTProxy.transcribe for detailed rationale.
                if (i < this.chain.length - 1) {
                    const event = {
                        from: this.chain[i].id,
                        to: this.chain[i + 1].id,
                        kind: 'tts',
                        error,
                    };
                    this.emitter.emit('provider_fallback', event);
                }
                else {
                    throw error;
                }
            }
        }
        // Unreachable — TypeScript requires an explicit throw after the loop.
        throw new Error('No providers in fallback chain');
    }
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
    getProviderName() {
        return this.chain[0]?.getProviderName() ?? 'fallback';
    }
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
    async listAvailableVoices() {
        for (const provider of this.chain) {
            if (typeof provider.listAvailableVoices === 'function') {
                return provider.listAvailableVoices();
            }
        }
        // No provider in the chain supports voice listing.
        return [];
    }
}
//# sourceMappingURL=FallbackProxy.js.map
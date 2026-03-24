import { EventEmitter } from 'events';
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  SpeechAudioInput,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechVoice,
} from './types.js';

/**
 * Payload emitted on the `provider_fallback` event when a provider in the chain
 * fails and the proxy advances to the next candidate.
 */
export interface ProviderFallbackEvent {
  /** ID of the provider that failed. */
  from: string;
  /** ID of the provider that will be tried next. */
  to: string;
  /** Whether this is an STT or TTS chain. */
  kind: 'stt' | 'tts';
  /** The error thrown by the failing provider. */
  error: unknown;
}

// ---------------------------------------------------------------------------
// FallbackSTTProxy
// ---------------------------------------------------------------------------

/**
 * A {@link SpeechToTextProvider} that wraps an ordered chain of STT providers.
 * Providers are tried left-to-right; the first successful result is returned.
 * On each failure (except the last) a `provider_fallback` event is emitted on
 * the supplied {@link EventEmitter} so callers can observe the fallback path.
 *
 * @example
 * ```ts
 * const proxy = new FallbackSTTProxy([whisperProvider, deepgramProvider], emitter);
 * const result = await proxy.transcribe(audio);
 * ```
 */
export class FallbackSTTProxy implements SpeechToTextProvider {
  /** Derived from the first provider in the chain (or `'fallback-stt'` for empty chains). */
  readonly id: string;

  /** Human-readable name showing the full chain: `"Fallback STT (p1 → p2)"`. */
  readonly displayName: string;

  /** `true` only when the first provider in the chain supports streaming. */
  readonly supportsStreaming: boolean;

  /**
   * @param chain   Ordered list of STT providers to try. Must contain at least one entry
   *                for `transcribe()` to succeed, though an empty chain is allowed
   *                (it will always throw).
   * @param emitter EventEmitter on which `provider_fallback` events are published.
   */
  constructor(
    private readonly chain: SpeechToTextProvider[],
    private readonly emitter: EventEmitter,
  ) {
    this.id = chain[0]?.id ?? 'fallback-stt';
    this.displayName = `Fallback STT (${chain.map((p) => p.id).join(' → ')})`;
    this.supportsStreaming = chain[0]?.supportsStreaming ?? false;
  }

  /**
   * Attempt transcription using each provider in order.
   *
   * Emits a `provider_fallback` event (typed as {@link ProviderFallbackEvent})
   * whenever a non-final provider throws.  Re-throws the last provider's error
   * when the entire chain is exhausted, and throws `Error('No providers in
   * fallback chain')` when `chain` is empty.
   */
  async transcribe(
    audio: SpeechAudioInput,
    options?: SpeechTranscriptionOptions,
  ): Promise<SpeechTranscriptionResult> {
    if (this.chain.length === 0) {
      throw new Error('No providers in fallback chain');
    }

    for (let i = 0; i < this.chain.length; i++) {
      try {
        return await this.chain[i].transcribe(audio, options);
      } catch (error) {
        if (i < this.chain.length - 1) {
          const event: ProviderFallbackEvent = {
            from: this.chain[i].id,
            to: this.chain[i + 1].id,
            kind: 'stt',
            error,
          };
          this.emitter.emit('provider_fallback', event);
        } else {
          throw error;
        }
      }
    }

    // Unreachable — TypeScript requires an explicit throw after the loop.
    throw new Error('No providers in fallback chain');
  }

  /** Delegates to the first provider in the chain, or returns `'fallback'` for an empty chain. */
  getProviderName(): string {
    return this.chain[0]?.getProviderName() ?? 'fallback';
  }
}

// ---------------------------------------------------------------------------
// FallbackTTSProxy
// ---------------------------------------------------------------------------

/**
 * A {@link TextToSpeechProvider} that wraps an ordered chain of TTS providers.
 * Providers are tried left-to-right; the first successful result is returned.
 * On each failure (except the last) a `provider_fallback` event is emitted on
 * the supplied {@link EventEmitter}.
 *
 * Voice listing is delegated to the first provider that exposes
 * `listAvailableVoices()`.  If none do, an empty array is returned.
 *
 * @example
 * ```ts
 * const proxy = new FallbackTTSProxy([elevenlabsProvider, openaiTtsProvider], emitter);
 * const audio = await proxy.synthesize('Hello world');
 * ```
 */
export class FallbackTTSProxy implements TextToSpeechProvider {
  /** Derived from the first provider in the chain (or `'fallback-tts'` for empty chains). */
  readonly id: string;

  /** Human-readable name showing the full chain: `"Fallback TTS (p1 → p2)"`. */
  readonly displayName: string;

  /** `true` only when the first provider in the chain supports streaming. */
  readonly supportsStreaming: boolean;

  /**
   * @param chain   Ordered list of TTS providers to try.
   * @param emitter EventEmitter on which `provider_fallback` events are published.
   */
  constructor(
    private readonly chain: TextToSpeechProvider[],
    private readonly emitter: EventEmitter,
  ) {
    this.id = chain[0]?.id ?? 'fallback-tts';
    this.displayName = `Fallback TTS (${chain.map((p) => p.id).join(' → ')})`;
    this.supportsStreaming = chain[0]?.supportsStreaming ?? false;
  }

  /**
   * Attempt synthesis using each provider in order.
   *
   * Emits a `provider_fallback` event (typed as {@link ProviderFallbackEvent})
   * whenever a non-final provider throws.  Re-throws the last provider's error
   * when the entire chain is exhausted, and throws `Error('No providers in
   * fallback chain')` when `chain` is empty.
   */
  async synthesize(
    text: string,
    options?: SpeechSynthesisOptions,
  ): Promise<SpeechSynthesisResult> {
    if (this.chain.length === 0) {
      throw new Error('No providers in fallback chain');
    }

    for (let i = 0; i < this.chain.length; i++) {
      try {
        return await this.chain[i].synthesize(text, options);
      } catch (error) {
        if (i < this.chain.length - 1) {
          const event: ProviderFallbackEvent = {
            from: this.chain[i].id,
            to: this.chain[i + 1].id,
            kind: 'tts',
            error,
          };
          this.emitter.emit('provider_fallback', event);
        } else {
          throw error;
        }
      }
    }

    // Unreachable — TypeScript requires an explicit throw after the loop.
    throw new Error('No providers in fallback chain');
  }

  /** Delegates to the first provider in the chain, or returns `'fallback'` for an empty chain. */
  getProviderName(): string {
    return this.chain[0]?.getProviderName() ?? 'fallback';
  }

  /**
   * Returns voice list from the first provider in the chain that exposes
   * `listAvailableVoices()`.  Falls back to an empty array when no provider
   * supports this method.
   */
  async listAvailableVoices(): Promise<SpeechVoice[]> {
    for (const provider of this.chain) {
      if (typeof provider.listAvailableVoices === 'function') {
        return provider.listAvailableVoices();
      }
    }
    return [];
  }
}

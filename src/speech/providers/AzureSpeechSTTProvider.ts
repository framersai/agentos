import type {
  SpeechAudioInput,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
} from '../types.js';

/**
 * Configuration for the {@link AzureSpeechSTTProvider}.
 *
 * @see {@link AzureSpeechSTTProvider} for usage examples
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text
 */
export interface AzureSpeechSTTProviderConfig {
  /**
   * Azure Cognitive Services subscription key.
   * Sent as the `Ocp-Apim-Subscription-Key` header — this is Azure's
   * standard authentication mechanism for Cognitive Services REST APIs.
   * Obtain from the Azure portal under your Speech resource's "Keys and Endpoint".
   */
  key: string;

  /**
   * Azure region where the Speech resource is deployed, e.g. `'eastus'`,
   * `'westeurope'`, `'southeastasia'`.
   *
   * The region determines the REST endpoint hostname:
   * `https://{region}.stt.speech.microsoft.com`
   *
   * @see https://learn.microsoft.com/azure/ai-services/speech-service/regions
   */
  region: string;

  /**
   * Custom fetch implementation for dependency injection in tests.
   * @default globalThis.fetch
   */
  fetchImpl?: typeof fetch;
}

/**
 * Typed subset of the Azure Speech-to-Text REST API response.
 *
 * ## Recognition Status Values
 *
 * - `'Success'` — Speech was recognized and `DisplayText` is populated.
 * - `'NoMatch'` — Audio was received but no speech was detected. This is NOT
 *   an error — it means the audio contained only silence or noise. We map
 *   this to an empty-text result rather than throwing.
 * - `'InitialSilenceTimeout'` — No speech detected within the initial timeout.
 * - `'BabbleTimeout'` — Non-speech audio was detected for too long.
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text#response-parameters
 */
interface AzureSpeechResponse {
  /**
   * Recognition outcome status. The `string` union fallback accommodates
   * any future status values Azure may add.
   */
  RecognitionStatus: 'Success' | 'NoMatch' | 'InitialSilenceTimeout' | 'BabbleTimeout' | string;

  /** The recognized speech text with punctuation and capitalization applied. */
  DisplayText?: string;

  /**
   * Duration of the recognized audio in 100-nanosecond units (Azure "ticks").
   * Divide by 10,000,000 to convert to seconds.
   *
   * @see {@link ticksToSeconds} for the conversion utility
   */
  Duration?: number;

  /**
   * Offset from the start of the audio stream in 100-nanosecond units.
   * Useful for multi-utterance recognition scenarios.
   */
  Offset?: number;
}

/**
 * Converts Azure's 100-nanosecond tick unit to seconds.
 *
 * Azure Cognitive Services uses "ticks" (100-nanosecond units) for all
 * timing fields. One second = 10,000,000 ticks.
 *
 * @param ticks - Duration in 100-nanosecond Azure ticks.
 * @returns Duration in seconds.
 *
 * @example
 * ```ts
 * ticksToSeconds(30_000_000); // 3.0 seconds
 * ticksToSeconds(15_000_000); // 1.5 seconds
 * ```
 */
function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
}

/**
 * Speech-to-text provider that uses the Azure Cognitive Services Speech REST API.
 *
 * ## Azure REST Endpoint Format
 *
 * The endpoint URL follows this pattern:
 * ```
 * https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language={lang}
 * ```
 *
 * - `{region}` — The Azure region from config (e.g. `eastus`, `westeurope`).
 * - `{lang}` — BCP-47 language code from options or `'en-US'` default.
 * - The `/conversation/` path segment selects the conversation recognition mode
 *   (as opposed to `/interactive/` or `/dictation/`).
 *
 * ## Authentication: `Ocp-Apim-Subscription-Key`
 *
 * Azure Cognitive Services uses the `Ocp-Apim-Subscription-Key` HTTP header
 * for authentication, which differs from the typical `Authorization: Bearer`
 * pattern. The subscription key is sent as a plain-text header value — no
 * "Bearer" or "Token" prefix.
 *
 * An alternative is to use a short-lived token from the token endpoint, but
 * this provider uses the simpler key-based approach for reliability.
 *
 * ## NoMatch Handling
 *
 * When Azure's recognizer detects audio but cannot identify any speech, it
 * returns `RecognitionStatus: 'NoMatch'` instead of raising an HTTP error.
 * This provider maps `NoMatch` to an empty-text result (`text: ''`) with
 * `isFinal: true`, matching the Azure Speech SDK's behaviour. This prevents
 * the fallback proxy from unnecessarily trying another provider when the
 * audio genuinely contains no speech.
 *
 * ## Limitations
 *
 * - Audio must be PCM WAV format. The `Content-Type` is hardcoded to
 *   `audio/wav` regardless of the `audio.mimeType` value.
 * - Streaming is not supported — use the Azure Speech SDK for real-time STT.
 * - Speaker diarization is not available via the REST API.
 *
 * @see {@link AzureSpeechSTTProviderConfig} for configuration options
 * @see {@link AzureSpeechTTSProvider} for the corresponding TTS provider
 *
 * @example
 * ```ts
 * const provider = new AzureSpeechSTTProvider({
 *   key: process.env.AZURE_SPEECH_KEY!,
 *   region: 'eastus',
 * });
 * const result = await provider.transcribe(
 *   { data: wavBuffer, mimeType: 'audio/wav' },
 *   { language: 'de-DE' },
 * );
 * console.log(result.text); // '' if no speech detected
 * ```
 */
export class AzureSpeechSTTProvider implements SpeechToTextProvider {
  /** Unique provider identifier used for registration and resolution. */
  public readonly id = 'azure-speech-stt';

  /** Human-readable display name for UI and logging. */
  public readonly displayName = 'Azure Speech (STT)';

  /** This provider uses synchronous HTTP requests, not WebSocket streaming. */
  public readonly supportsStreaming = false;

  /** Fetch implementation — injected for testability, defaults to global fetch. */
  private readonly fetchImpl: typeof fetch;

  /**
   * Creates a new AzureSpeechSTTProvider.
   *
   * @param config - Provider configuration including the subscription key and region.
   *
   * @example
   * ```ts
   * const provider = new AzureSpeechSTTProvider({
   *   key: 'your-azure-subscription-key',
   *   region: 'eastus',
   * });
   * ```
   */
  constructor(private readonly config: AzureSpeechSTTProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /**
   * Returns the human-readable provider name.
   *
   * @returns The display name string `'Azure Speech (STT)'`.
   *
   * @example
   * ```ts
   * provider.getProviderName(); // 'Azure Speech (STT)'
   * ```
   */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Transcribes an audio buffer using the Azure Speech recognition REST endpoint.
   *
   * Sends the raw audio as PCM WAV and returns a normalized result. Azure's
   * `NoMatch` status is treated as an empty transcript (not an error).
   *
   * @param audio - Raw audio data. Azure expects PCM WAV format; the
   *   Content-Type header is always set to `'audio/wav'` regardless of
   *   `audio.mimeType`.
   * @param options - Optional transcription settings. Only `language` is
   *   supported by the Azure REST endpoint.
   * @returns A promise resolving to the normalized transcription result.
   * @throws {Error} When the Azure API returns a non-2xx HTTP status code.
   *   The error message includes the status and response body text.
   *
   * @example
   * ```ts
   * const result = await provider.transcribe(
   *   { data: wavBuffer, durationSeconds: 5 },
   *   { language: 'fr-FR' },
   * );
   * if (result.text === '') {
   *   console.log('No speech detected in the audio');
   * }
   * ```
   */
  async transcribe(
    audio: SpeechAudioInput,
    options: SpeechTranscriptionOptions = {}
  ): Promise<SpeechTranscriptionResult> {
    const lang = options.language ?? 'en-US';
    const { key, region } = this.config;

    // Build the Azure STT REST endpoint URL.
    // The /conversation/ path selects conversation recognition mode which is
    // the most general-purpose mode for varied audio content.
    const url =
      `https://${region}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(lang)}`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        // Azure uses this non-standard header for subscription key auth
        'Ocp-Apim-Subscription-Key': key,
        // Hardcoded to audio/wav because Azure's REST endpoint requires WAV format
        'Content-Type': 'audio/wav',
      },
      body: audio.data as unknown as BodyInit,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Azure Speech STT failed (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as AzureSpeechResponse;

    // NoMatch means the recognizer detected audio but found no speech content.
    // Return an empty result instead of throwing — this is the expected behaviour
    // for silence or noise-only audio, matching the Azure Speech SDK pattern.
    if (payload.RecognitionStatus === 'NoMatch') {
      return {
        text: '',
        language: lang,
        cost: 0,
        isFinal: true,
        providerResponse: payload,
        usage: {
          durationMinutes: (audio.durationSeconds ?? 0) / 60,
          modelUsed: 'azure-speech-stt',
        },
      };
    }

    // Convert Azure's 100-nanosecond ticks to seconds, falling back to the
    // client-provided duration estimate if the API doesn't return Duration.
    const durationSeconds =
      typeof payload.Duration === 'number'
        ? ticksToSeconds(payload.Duration)
        : audio.durationSeconds;

    return {
      text: payload.DisplayText ?? '',
      language: lang,
      durationSeconds,
      cost: 0,
      providerResponse: payload,
      isFinal: true,
      usage: {
        durationMinutes: (durationSeconds ?? 0) / 60,
        modelUsed: 'azure-speech-stt',
      },
    };
  }
}

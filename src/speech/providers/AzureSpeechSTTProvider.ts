import type {
  SpeechAudioInput,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
} from '../types.js';

/** Configuration for the AzureSpeechSTTProvider. */
export interface AzureSpeechSTTProviderConfig {
  /** Azure Cognitive Services subscription key. */
  key: string;
  /** Azure region, e.g. `'eastus'` or `'westeurope'`. */
  region: string;
  /**
   * Custom fetch implementation, useful for testing.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Typed subset of the Azure Speech-to-Text REST response.
 * See: https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text
 */
interface AzureSpeechResponse {
  RecognitionStatus: 'Success' | 'NoMatch' | 'InitialSilenceTimeout' | 'BabbleTimeout' | string;
  DisplayText?: string;
  /** Duration of the recognized audio in 100-nanosecond units. */
  Duration?: number;
  /** Offset from the start of the audio in 100-nanosecond units. */
  Offset?: number;
}

/** Converts Azure 100-nanosecond ticks to seconds. */
function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
}

/**
 * Speech-to-text provider that uses the Azure Cognitive Services Speech REST API.
 *
 * Sends WAV audio as a raw binary body and returns a normalised
 * {@link SpeechTranscriptionResult}. A `RecognitionStatus` of `'NoMatch'`
 * is mapped to an empty text result rather than an error, matching the
 * Azure SDK behaviour.
 *
 * @example
 * ```ts
 * const provider = new AzureSpeechSTTProvider({ key: process.env.AZURE_SPEECH_KEY!, region: 'eastus' });
 * const result = await provider.transcribe({ data: wavBuffer });
 * console.log(result.text);
 * ```
 */
export class AzureSpeechSTTProvider implements SpeechToTextProvider {
  public readonly id = 'azure-speech-stt';
  public readonly displayName = 'Azure Speech (STT)';
  public readonly supportsStreaming = false;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AzureSpeechSTTProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Returns the human-readable provider name. */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Transcribes an audio buffer using the Azure Speech recognition REST endpoint.
   *
   * @param audio - Raw audio data. Azure expects PCM WAV; pass `mimeType: 'audio/wav'`.
   * @param options - Optional transcription settings (language…).
   * @returns A promise resolving to the normalised transcription result.
   * @throws When the Azure API returns a non-2xx status.
   */
  async transcribe(
    audio: SpeechAudioInput,
    options: SpeechTranscriptionOptions = {}
  ): Promise<SpeechTranscriptionResult> {
    const lang = options.language ?? 'en-US';
    const { key, region } = this.config;

    const url =
      `https://${region}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(lang)}`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'audio/wav',
      },
      body: audio.data as unknown as BodyInit,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Azure Speech STT failed (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as AzureSpeechResponse;

    // NoMatch means the recognizer found no speech — return empty text gracefully.
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

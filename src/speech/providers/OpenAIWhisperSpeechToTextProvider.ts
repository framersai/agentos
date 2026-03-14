import type {
  SpeechAudioInput,
  SpeechResponseFormat,
  SpeechToTextProvider,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
  SpeechTranscriptionSegment,
} from '../types.js';

export interface OpenAIWhisperSpeechToTextProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

function normalizeSegments(input: unknown): SpeechTranscriptionSegment[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .filter((segment) => typeof segment === 'object' && segment !== null)
    .map((segment) => {
      const item = segment as Record<string, unknown>;
      return {
        text: typeof item.text === 'string' ? item.text : '',
        startTime: typeof item.start === 'number' ? item.start : 0,
        endTime: typeof item.end === 'number' ? item.end : 0,
        confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
        speaker:
          typeof item.speaker === 'string' || typeof item.speaker === 'number'
            ? item.speaker
            : undefined,
        words: Array.isArray(item.words)
          ? item.words
              .filter((word) => typeof word === 'object' && word !== null)
              .map((word) => {
                const value = word as Record<string, unknown>;
                return {
                  word: typeof value.word === 'string' ? value.word : '',
                  start: typeof value.start === 'number' ? value.start : 0,
                  end: typeof value.end === 'number' ? value.end : 0,
                  confidence:
                    typeof value.confidence === 'number' ? value.confidence : undefined,
                };
              })
          : undefined,
        id: typeof item.id === 'number' ? item.id : undefined,
        seek: typeof item.seek === 'number' ? item.seek : undefined,
        tokens: Array.isArray(item.tokens)
          ? item.tokens.filter((token): token is number => typeof token === 'number')
          : undefined,
        temperature: typeof item.temperature === 'number' ? item.temperature : undefined,
        avg_logprob: typeof item.avg_logprob === 'number' ? item.avg_logprob : undefined,
        compression_ratio:
          typeof item.compression_ratio === 'number' ? item.compression_ratio : undefined,
        no_speech_prob:
          typeof item.no_speech_prob === 'number' ? item.no_speech_prob : undefined,
      };
    });
}

export class OpenAIWhisperSpeechToTextProvider implements SpeechToTextProvider {
  public readonly id = 'openai-whisper';
  public readonly displayName = 'OpenAI Whisper';
  public readonly supportsStreaming = false;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAIWhisperSpeechToTextProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getProviderName(): string {
    return this.displayName;
  }

  async transcribe(
    audio: SpeechAudioInput,
    options: SpeechTranscriptionOptions = {}
  ): Promise<SpeechTranscriptionResult> {
    const form = new FormData();
    const responseFormat = (options.responseFormat ?? 'verbose_json') as SpeechResponseFormat;
    const model = options.model ?? this.config.model ?? 'whisper-1';
    const fileName = audio.fileName ?? `speech.${audio.format ?? 'wav'}`;

    form.append(
      'file',
      new Blob([Uint8Array.from(audio.data)], { type: audio.mimeType ?? 'audio/wav' }),
      fileName
    );
    form.append('model', model);
    form.append('response_format', responseFormat);
    if (options.language) form.append('language', options.language);
    if (options.prompt) form.append('prompt', options.prompt);
    if (typeof options.temperature === 'number') {
      form.append('temperature', String(options.temperature));
    }

    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: form,
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI Whisper transcription failed (${response.status}): ${message}`);
    }

    if (responseFormat === 'text' || response.headers.get('content-type')?.includes('text/plain')) {
      const text = await response.text();
      return {
        text,
        language: options.language,
        durationSeconds: audio.durationSeconds,
        cost: 0,
        isFinal: true,
        usage: {
          durationMinutes: (audio.durationSeconds ?? 0) / 60,
          modelUsed: model,
        },
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const durationSeconds =
      typeof payload.duration === 'number' ? payload.duration : audio.durationSeconds;

    return {
      text: typeof payload.text === 'string' ? payload.text : '',
      language: typeof payload.language === 'string' ? payload.language : options.language,
      durationSeconds,
      cost: 0,
      segments: normalizeSegments(payload.segments),
      providerResponse: payload,
      isFinal: true,
      usage: {
        durationMinutes: (durationSeconds ?? 0) / 60,
        modelUsed: model,
      },
    };
  }
}

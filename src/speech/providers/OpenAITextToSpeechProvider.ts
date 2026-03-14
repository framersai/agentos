import type {
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechVoice,
  TextToSpeechProvider,
} from '../types.js';

export interface OpenAITextToSpeechProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
}

const OPENAI_VOICES: readonly SpeechVoice[] = [
  { id: 'alloy', name: 'Alloy', provider: 'openai-tts', lang: 'various', isDefault: false },
  { id: 'echo', name: 'Echo', provider: 'openai-tts', lang: 'various', isDefault: false },
  { id: 'fable', name: 'Fable', provider: 'openai-tts', lang: 'various', isDefault: false },
  { id: 'onyx', name: 'Onyx', provider: 'openai-tts', lang: 'various', isDefault: false },
  { id: 'nova', name: 'Nova', provider: 'openai-tts', lang: 'various', isDefault: true },
  { id: 'shimmer', name: 'Shimmer', provider: 'openai-tts', lang: 'various', isDefault: false },
];

function mimeTypeForOutput(format: string | undefined): string {
  switch (format) {
    case 'opus':
      return 'audio/opus';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'wav':
      return 'audio/wav';
    case 'pcm':
      return 'audio/L16';
    default:
      return 'audio/mpeg';
  }
}

export class OpenAITextToSpeechProvider implements TextToSpeechProvider {
  public readonly id = 'openai-tts';
  public readonly displayName = 'OpenAI TTS';
  public readonly supportsStreaming = true;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAITextToSpeechProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getProviderName(): string {
    return this.displayName;
  }

  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {}
  ): Promise<SpeechSynthesisResult> {
    const model = options.model ?? this.config.model ?? 'tts-1';
    const voice = options.voice ?? this.config.voice ?? 'nova';
    const outputFormat = options.outputFormat ?? 'mp3';
    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://api.openai.com/v1'}/audio/speech`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: outputFormat,
          speed: options.speed,
        }),
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI TTS synthesis failed (${response.status}): ${message}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      audioBuffer,
      mimeType: mimeTypeForOutput(outputFormat),
      cost: 0,
      voiceUsed: voice,
      providerName: this.displayName,
      usage: {
        characters: text.length,
        modelUsed: model,
      },
    };
  }

  async listAvailableVoices(): Promise<SpeechVoice[]> {
    return [...OPENAI_VOICES];
  }
}

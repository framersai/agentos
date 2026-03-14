import type {
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechVoice,
  TextToSpeechProvider,
} from '../types.js';

export interface ElevenLabsTextToSpeechProviderConfig {
  apiKey: string;
  baseUrl?: string;
  voiceId?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  public readonly id = 'elevenlabs';
  public readonly displayName = 'ElevenLabs';
  public readonly supportsStreaming = true;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ElevenLabsTextToSpeechProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getProviderName(): string {
    return this.displayName;
  }

  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {}
  ): Promise<SpeechSynthesisResult> {
    const voiceId =
      options.voice ??
      this.config.voiceId ??
      (typeof options.providerSpecificOptions?.voiceId === 'string'
        ? options.providerSpecificOptions.voiceId
        : undefined) ??
      'EXAVITQu4vr4xnSDxMaL';
    const model = options.model ?? this.config.model ?? 'eleven_multilingual_v2';
    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://api.elevenlabs.io/v1'}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: {
            stability:
              typeof options.providerSpecificOptions?.stability === 'number'
                ? options.providerSpecificOptions.stability
                : 0.5,
            similarity_boost:
              typeof options.providerSpecificOptions?.similarityBoost === 'number'
                ? options.providerSpecificOptions.similarityBoost
                : 0.75,
            style:
              typeof options.providerSpecificOptions?.style === 'number'
                ? options.providerSpecificOptions.style
                : undefined,
            use_speaker_boost:
              typeof options.providerSpecificOptions?.useSpeakerBoost === 'boolean'
                ? options.providerSpecificOptions.useSpeakerBoost
                : true,
          },
        }),
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ElevenLabs synthesis failed (${response.status}): ${message}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      audioBuffer,
      mimeType: 'audio/mpeg',
      cost: 0,
      voiceUsed: voiceId,
      providerName: this.displayName,
      usage: {
        characters: text.length,
        modelUsed: model,
      },
    };
  }

  async listAvailableVoices(): Promise<SpeechVoice[]> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? 'https://api.elevenlabs.io/v1'}/voices`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { voices?: Array<Record<string, unknown>> };
    return (payload.voices ?? [])
      .filter((voice) => typeof voice === 'object' && voice !== null)
      .map((voice) => {
        const labels =
          typeof voice.labels === 'object' && voice.labels !== null
            ? (voice.labels as Record<string, unknown>)
            : {};

        return {
          id: typeof voice.voice_id === 'string' ? voice.voice_id : '',
          name: typeof voice.name === 'string' ? voice.name : 'Unknown',
          lang:
            typeof labels.accent === 'string'
              ? labels.accent
              : typeof labels.language === 'string'
              ? labels.language
              : 'various',
          description:
            typeof voice.description === 'string' ? voice.description : undefined,
          provider: this.id,
        };
      })
      .filter((voice) => voice.id);
  }
}

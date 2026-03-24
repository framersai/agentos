import type {
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechVoice,
  TextToSpeechProvider,
} from '../types.js';

/** Configuration for the AzureSpeechTTSProvider. */
export interface AzureSpeechTTSProviderConfig {
  /** Azure Cognitive Services subscription key. */
  key: string;
  /** Azure region, e.g. `'eastus'` or `'westeurope'`. */
  region: string;
  /**
   * Default voice name to use when none is specified per-request.
   * @default 'en-US-JennyNeural'
   */
  defaultVoice?: string;
  /**
   * Custom fetch implementation, useful for testing.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/** Voice entry returned by the Azure TTS voice list endpoint. */
interface AzureVoiceEntry {
  Name: string;
  DisplayName: string;
  LocaleName: string;
  Gender: string;
  ShortName: string;
  Status: string;
}

/**
 * Escapes special XML characters in text before embedding it in SSML.
 * Azure's TTS endpoint expects well-formed XML; unescaped `<`, `>`, or `&`
 * characters in the input text would cause a 400 error.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the SSML payload sent to the Azure TTS REST endpoint.
 *
 * @param text - Plain-text utterance to synthesize.
 * @param voice - Azure voice short-name, e.g. `'en-US-JennyNeural'`.
 */
function buildSsml(text: string, voice: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}">${escapeXml(text)}</voice>` +
    `</speak>`
  );
}

/**
 * Maps an Azure voice list entry to the normalised {@link SpeechVoice} shape.
 */
function mapVoice(entry: AzureVoiceEntry): SpeechVoice {
  const gender = entry.Gender?.toLowerCase();
  return {
    id: entry.ShortName,
    name: entry.DisplayName,
    gender:
      gender === 'male' || gender === 'female' || gender === 'neutral'
        ? (gender as 'male' | 'female' | 'neutral')
        : gender,
    lang: entry.LocaleName,
    provider: 'azure-speech-tts',
  };
}

/**
 * Text-to-speech provider that uses the Azure Cognitive Services Speech REST API.
 *
 * Generates audio via SSML synthesis and returns the raw MP3 buffer. Streaming
 * is supported in the sense that the provider can be used inside a streaming
 * pipeline — the actual HTTP request is a single synchronous call.
 *
 * @example
 * ```ts
 * const provider = new AzureSpeechTTSProvider({ key: process.env.AZURE_SPEECH_KEY!, region: 'eastus' });
 * const result = await provider.synthesize('Hello world');
 * // result.audioBuffer contains MP3 bytes
 * ```
 */
export class AzureSpeechTTSProvider implements TextToSpeechProvider {
  public readonly id = 'azure-speech-tts';
  public readonly displayName = 'Azure Speech (TTS)';
  public readonly supportsStreaming = true;

  private readonly fetchImpl: typeof fetch;
  private readonly defaultVoice: string;

  constructor(private readonly config: AzureSpeechTTSProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.defaultVoice = config.defaultVoice ?? 'en-US-JennyNeural';
  }

  /** Returns the human-readable provider name. */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Synthesizes speech from plain text using the Azure TTS REST endpoint.
   *
   * @param text - The utterance to convert to audio.
   * @param options - Optional synthesis settings (voice override…).
   * @returns A promise resolving to the MP3 audio buffer and metadata.
   * @throws When the Azure API returns a non-2xx status.
   */
  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {}
  ): Promise<SpeechSynthesisResult> {
    const voice = options.voice ?? this.defaultVoice;
    const { key, region } = this.config;

    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = buildSsml(text, voice);

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Azure Speech TTS failed (${response.status}): ${message}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    return {
      audioBuffer,
      mimeType: 'audio/mpeg',
      cost: 0,
      voiceUsed: voice,
      providerName: this.displayName,
      usage: {
        characters: text.length,
        modelUsed: 'azure-speech-tts',
      },
    };
  }

  /**
   * Retrieves the list of available neural voices from the Azure region.
   *
   * @returns A promise resolving to an array of normalised {@link SpeechVoice} entries.
   * @throws When the Azure API returns a non-2xx status.
   */
  async listAvailableVoices(): Promise<SpeechVoice[]> {
    const { key, region } = this.config;
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

    const response = await this.fetchImpl(url, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Azure Speech voice list failed (${response.status}): ${message}`);
    }

    const voices = (await response.json()) as AzureVoiceEntry[];
    return voices.map(mapVoice);
  }
}

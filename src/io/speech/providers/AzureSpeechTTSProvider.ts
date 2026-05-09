import type {
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechVoice,
  TextToSpeechProvider,
} from '../types.js';

/**
 * Configuration for the {@link AzureSpeechTTSProvider}.
 *
 * @see {@link AzureSpeechTTSProvider} for usage examples
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 */
export interface AzureSpeechTTSProviderConfig {
  /**
   * Azure Cognitive Services subscription key.
   * Sent as the `Ocp-Apim-Subscription-Key` header value.
   *
   * See `AzureSpeechSTTProviderConfig.key` for the same pattern on STT.
   */
  key: string;

  /**
   * Azure region where the Speech resource is deployed, e.g. `'eastus'`,
   * `'westeurope'`, `'southeastasia'`.
   *
   * The region determines the REST endpoint hostname:
   * `https://{region}.tts.speech.microsoft.com`
   */
  region: string;

  /**
   * Default voice name to use when none is specified per-request.
   * Must be a valid Azure voice short-name (e.g. `'en-US-JennyNeural'`).
   *
   * @default 'en-US-JennyNeural'
   * @see https://learn.microsoft.com/azure/ai-services/speech-service/language-support#prebuilt-neural-voices
   */
  defaultVoice?: string;

  /**
   * Custom fetch implementation for dependency injection in tests.
   * @default globalThis.fetch
   */
  fetchImpl?: typeof fetch;
}

/**
 * Shape of a single voice entry returned by the Azure TTS voice list endpoint.
 *
 * Azure returns a flat array of these objects from
 * `GET /cognitiveservices/voices/list`.
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices
 */
interface AzureVoiceEntry {
  /** Full internal name (e.g. `'Microsoft Server Speech Text to Speech Voice (en-US, JennyNeural)'`). */
  Name: string;
  /** Human-readable display name (e.g. `'Jenny'`). */
  DisplayName: string;
  /** Locale name (e.g. `'en-US'`, `'de-DE'`). */
  LocaleName: string;
  /** Gender string: `'Female'`, `'Male'`, or potentially other values. */
  Gender: string;
  /** Short voice identifier used in SSML (e.g. `'en-US-JennyNeural'`). */
  ShortName: string;
  /** Availability status (e.g. `'GA'` for Generally Available). */
  Status: string;
}

/**
 * Escapes special XML characters in text before embedding it in SSML.
 *
 * Azure's TTS endpoint expects well-formed XML in the request body. Unescaped
 * `<`, `>`, `&`, `"`, or `'` characters in the input text would cause a 400
 * Bad Request error because they break the XML structure.
 *
 * The five standard XML entity replacements are applied:
 * - `&` -> `&amp;` (must be first to avoid double-escaping)
 * - `<` -> `&lt;`
 * - `>` -> `&gt;`
 * - `"` -> `&quot;`
 * - `'` -> `&apos;`
 *
 * @param text - Raw plain text to escape for safe XML embedding.
 * @returns The XML-safe escaped string.
 *
 * @example
 * ```ts
 * escapeXml('Hello & <world>'); // 'Hello &amp; &lt;world&gt;'
 * ```
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;') // Must be first to avoid double-escaping
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the SSML (Speech Synthesis Markup Language) payload for the Azure
 * TTS REST endpoint.
 *
 * The generated SSML wraps the escaped text in a `<voice>` element with the
 * specified voice name. The outer `<speak>` element declares SSML version 1.0
 * and the W3C synthesis namespace.
 *
 * More advanced SSML features (prosody, emphasis, break) could be added here
 * but are not currently needed for basic synthesis.
 *
 * @param text - Plain-text utterance to synthesize (will be XML-escaped).
 * @param voice - Azure voice short-name, e.g. `'en-US-JennyNeural'`.
 * @returns Well-formed SSML string ready to send as the request body.
 *
 * @see {@link escapeXml} for the XML escaping logic
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/speech-synthesis-markup
 *
 * @example
 * ```ts
 * buildSsml('Hello world', 'en-US-JennyNeural');
 * // '<speak version="1.0" xmlns="..."><voice name="en-US-JennyNeural">Hello world</voice></speak>'
 * ```
 */
function buildSsml(text: string, voice: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}">${escapeXml(text)}</voice>` +
    `</speak>`
  );
}

/**
 * Maps an Azure voice list entry to the normalized {@link SpeechVoice} shape.
 *
 * The gender field is lowercased and validated against known values. Unknown
 * gender strings (if Azure adds new values) are passed through as-is since
 * the {@link SpeechVoice.gender} type accepts `string`.
 *
 * @param entry - A single voice entry from the Azure voices/list endpoint.
 * @returns The normalized voice object.
 *
 * @see {@link AzureVoiceEntry} for the input shape
 * @see {@link SpeechVoice} for the output shape
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
 * ## SSML Generation
 *
 * Azure's TTS REST endpoint requires SSML (Speech Synthesis Markup Language) as
 * the request body — it does not accept plain text. This provider generates
 * minimal SSML via `buildSsml()` that wraps the input text in `<speak>`
 * and `<voice>` elements. Special XML characters in the text are escaped via
 * `escapeXml()` to prevent malformed XML.
 *
 * ## `X-Microsoft-OutputFormat` Options
 *
 * The `X-Microsoft-OutputFormat` header controls the audio encoding. This
 * provider uses `'audio-24khz-96kbitrate-mono-mp3'` which provides:
 * - 24 kHz sample rate (high quality for speech)
 * - 96 kbps bitrate (good balance of quality and file size)
 * - Mono channel (sufficient for speech synthesis)
 * - MP3 format (universally supported)
 *
 * Other available formats include:
 * - `'audio-16khz-128kbitrate-mono-mp3'` — Lower sample rate, higher bitrate
 * - `'audio-24khz-160kbitrate-mono-mp3'` — Higher bitrate for better quality
 * - `'riff-24khz-16bit-mono-pcm'` — Uncompressed WAV
 * - `'ogg-24khz-16bit-mono-opus'` — Opus codec in OGG container
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
 *
 * ## Voice Listing
 *
 * The {@link listAvailableVoices} method fetches the full list of neural voices
 * available in the configured Azure region via
 * `GET /cognitiveservices/voices/list`. Results are mapped to the normalized
 * {@link SpeechVoice} shape.
 *
 * @see {@link AzureSpeechTTSProviderConfig} for configuration options
 * @see {@link AzureSpeechSTTProvider} for the corresponding STT provider
 *
 * @example
 * ```ts
 * const provider = new AzureSpeechTTSProvider({
 *   key: process.env.AZURE_SPEECH_KEY!,
 *   region: 'eastus',
 *   defaultVoice: 'en-US-GuyNeural',
 * });
 * const result = await provider.synthesize('Hello world');
 * // result.audioBuffer contains MP3 bytes
 * // result.mimeType === 'audio/mpeg'
 * ```
 */
export class AzureSpeechTTSProvider implements TextToSpeechProvider {
  /** Unique provider identifier used for registration and resolution. */
  public readonly id = 'azure-speech-tts';

  /** Human-readable display name for UI and logging. */
  public readonly displayName = 'Azure Speech (TTS)';

  /**
   * Marked as streaming-capable because the provider can be used within a
   * streaming pipeline — though the actual HTTP request is a single
   * synchronous call that returns the complete audio buffer.
   */
  public readonly supportsStreaming = true;

  /** Fetch implementation — injected for testability, defaults to global fetch. */
  private readonly fetchImpl: typeof fetch;

  /** Resolved default voice name used when no voice is specified per-request. */
  private readonly defaultVoice: string;

  /**
   * Creates a new AzureSpeechTTSProvider.
   *
   * @param config - Provider configuration including the subscription key,
   *   region, and optional default voice.
   *
   * @example
   * ```ts
   * const provider = new AzureSpeechTTSProvider({
   *   key: 'your-azure-subscription-key',
   *   region: 'westeurope',
   *   defaultVoice: 'de-DE-ConradNeural',
   * });
   * ```
   */
  constructor(private readonly config: AzureSpeechTTSProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.defaultVoice = config.defaultVoice ?? 'en-US-JennyNeural';
  }

  /**
   * Returns the human-readable provider name.
   *
   * @returns The display name string `'Azure Speech (TTS)'`.
   *
   * @example
   * ```ts
   * provider.getProviderName(); // 'Azure Speech (TTS)'
   * ```
   */
  getProviderName(): string {
    return this.displayName;
  }

  /**
   * Synthesizes speech from plain text using the Azure TTS REST endpoint.
   *
   * The text is wrapped in SSML, sent to Azure, and the response audio buffer
   * (MP3 format) is returned along with metadata.
   *
   * @param text - The plain-text utterance to convert to audio. XML special
   *   characters are automatically escaped.
   * @param options - Optional synthesis settings. Use `options.voice` to
   *   override the default voice with any valid Azure voice short-name.
   * @returns A promise resolving to the MP3 audio buffer and metadata.
   * @throws {Error} When the Azure API returns a non-2xx status code.
   *   Common causes: invalid subscription key (401), region mismatch (404),
   *   invalid SSML (400), or quota exceeded (429).
   *
   * @example
   * ```ts
   * const result = await provider.synthesize('Guten Tag!', {
   *   voice: 'de-DE-ConradNeural',
   * });
   * fs.writeFileSync('output.mp3', result.audioBuffer);
   * ```
   */
  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {}
  ): Promise<SpeechSynthesisResult> {
    const voice = options.voice ?? this.defaultVoice;
    const { key, region } = this.config;

    // Azure TTS endpoint — note it uses tts.speech.microsoft.com (not stt.)
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = buildSsml(text, voice);

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        // Azure's standard subscription key authentication header
        'Ocp-Apim-Subscription-Key': key,
        // SSML content type — Azure rejects plain text
        'Content-Type': 'application/ssml+xml',
        // Output format header — determines the audio encoding, sample rate,
        // and container format of the response body
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      },
      body: ssml,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Azure Speech TTS failed (${response.status}): ${message}`);
    }

    // Read the complete audio response into a Buffer
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    return {
      audioBuffer,
      mimeType: 'audio/mpeg', // Matches the X-Microsoft-OutputFormat MP3 selection
      cost: 0, // Cost tracking is handled at a higher layer
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
   * Fetches from `GET /cognitiveservices/voices/list` and maps each entry
   * to the normalized {@link SpeechVoice} shape. The list includes all
   * neural and standard voices available in the configured region.
   *
   * @returns A promise resolving to an array of normalized voice entries.
   * @throws {Error} When the Azure API returns a non-2xx status code
   *   (e.g. invalid key, network error).
   *
   * @example
   * ```ts
   * const voices = await provider.listAvailableVoices();
   * const englishVoices = voices.filter(v => v.lang.startsWith('en-'));
   * console.log(`Found ${englishVoices.length} English voices`);
   * ```
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

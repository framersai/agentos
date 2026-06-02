import type {
  SpeechSynthesisOptions,
  SpeechSynthesisResult,
  SpeechVoice,
  TextToSpeechProvider,
} from '../types.js';
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
import { isQuotaError } from '../../../core/providers/quotaErrors.js';

/**
 * Configuration for the {@link DeepgramTextToSpeechProvider}.
 *
 * @see https://developers.deepgram.com/docs/text-to-speech
 */
export interface DeepgramTextToSpeechProviderConfig {
  /** Deepgram API key. Sent as `Authorization: Token <apiKey>`. */
  apiKey: string;
  /**
   * Base URL for the Deepgram API.
   * @default 'https://api.deepgram.com/v1'
   */
  baseUrl?: string;
  /**
   * Default Aura voice model.
   * @default 'aura-2-thalia-en'
   */
  voice?: string;
  /** Custom fetch implementation for dependency injection in tests. */
  fetchImpl?: typeof fetch;
}

/** Aura hard limit: 2000 characters per `/v1/speak` request. */
const MAX_CHARS = 2000;

/**
 * Static catalog of the Aura-2 English voices (ids confirmed against the
 * Deepgram TTS models docs). Aura also ships Spanish / Dutch / French /
 * German / Italian / Japanese voices; the English set covers the wilds
 * narrator + companion profiles.
 */
const AURA_VOICES: readonly SpeechVoice[] = [
  { id: 'aura-2-thalia-en', name: 'Thalia', gender: 'female', provider: 'deepgram-aura', lang: 'en-US', isDefault: true },
  { id: 'aura-2-andromeda-en', name: 'Andromeda', gender: 'female', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-helena-en', name: 'Helena', gender: 'female', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-iris-en', name: 'Iris', gender: 'female', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-vesta-en', name: 'Vesta', gender: 'female', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-apollo-en', name: 'Apollo', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-arcas-en', name: 'Arcas', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-aries-en', name: 'Aries', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-atlas-en', name: 'Atlas', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-odysseus-en', name: 'Odysseus', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-orpheus-en', name: 'Orpheus', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
  { id: 'aura-2-zeus-en', name: 'Zeus', gender: 'male', provider: 'deepgram-aura', lang: 'en-US' },
];

/** Map a synthesis output format to the Deepgram `encoding` + response MIME. */
function encodingFor(format: string | undefined): { encoding: string; mime: string } {
  switch (format) {
    case 'opus':
      return { encoding: 'opus', mime: 'audio/opus' };
    case 'wav':
    case 'pcm':
      return { encoding: 'linear16', mime: 'audio/L16' };
    case 'flac':
      return { encoding: 'flac', mime: 'audio/flac' };
    default:
      return { encoding: 'mp3', mime: 'audio/mpeg' };
  }
}

/**
 * Split `text` into chunks no longer than `max` characters, preferring a
 * sentence boundary then whitespace then a hard cut. Mirrors `chunkForAura`
 * in the voice-pipeline batch provider; kept local so io/speech stays
 * independent of io/voice-pipeline.
 */
function chunkText(text: string, max = MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Text-to-speech provider backed by the Deepgram Aura `/v1/speak` REST API.
 *
 * ## API Contract
 *
 * - **Endpoint:** `POST {baseUrl}/speak?model={voice}&encoding={enc}`
 * - **Authentication:** `Authorization: Token <apiKey>`
 * - **Request body:** `{ text }`
 * - **Response:** Raw audio bytes (`audio/mpeg` for mp3)
 *
 * Aura caps a request at 2000 characters, so longer text is chunked at
 * sentence boundaries and the audio buffers are concatenated.
 *
 * @example
 * ```ts
 * const provider = new DeepgramTextToSpeechProvider({
 *   apiKey: process.env.DEEPGRAM_API_KEY!,
 *   voice: 'aura-2-arcas-en',
 * });
 * const result = await provider.synthesize('Hello there!');
 * ```
 */
export class DeepgramTextToSpeechProvider implements TextToSpeechProvider {
  public readonly id = 'deepgram-aura';
  public readonly displayName = 'Deepgram Aura';
  public readonly supportsStreaming = true;

  private readonly fetchImpl: typeof fetch;
  private readonly keyPool: ApiKeyPool;

  constructor(private readonly config: DeepgramTextToSpeechProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.keyPool = new ApiKeyPool(config.apiKey);
  }

  getProviderName(): string {
    return this.displayName;
  }

  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {}
  ): Promise<SpeechSynthesisResult> {
    const voice = options.voice ?? this.config.voice ?? 'aura-2-thalia-en';
    const { encoding, mime } = encodingFor(options.outputFormat);
    const baseUrl = this.config.baseUrl ?? 'https://api.deepgram.com/v1';
    const url = `${baseUrl}/speak?model=${encodeURIComponent(voice)}&encoding=${encoding}`;

    const buffers: Buffer[] = [];
    for (const chunk of chunkText(text)) {
      buffers.push(await this.synthesizeOne(url, chunk));
    }

    return {
      audioBuffer: Buffer.concat(buffers),
      mimeType: mime,
      cost: 0, // Cost tracking is handled at a higher layer.
      voiceUsed: voice,
      providerName: this.displayName,
      usage: {
        characters: text.length,
        modelUsed: voice,
      },
    };
  }

  private async synthesizeOne(url: string, text: string): Promise<Buffer> {
    const doFetch = (key: string) =>
      this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

    const key = this.keyPool.next();
    let response = await doFetch(key);

    if (!response.ok && this.keyPool.size > 1) {
      const errBody = await response.text().catch(() => '');
      if (isQuotaError(response.status, errBody)) {
        this.keyPool.markExhausted(key);
        response = await doFetch(this.keyPool.next());
      } else {
        throw new Error(`Deepgram Aura synthesis failed (${response.status}): ${errBody}`);
      }
    }

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Deepgram Aura synthesis failed (${response.status}): ${message}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /** Returns the static Aura-2 voice catalog (a shallow copy). */
  async listAvailableVoices(): Promise<SpeechVoice[]> {
    return [...AURA_VOICES];
  }
}

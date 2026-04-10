/**
 * @module voice-pipeline/providers/ElevenLabsBatchTTS
 *
 * Batch text-to-speech via ElevenLabs' REST API. Implements {@link IBatchTTS}
 * for one-shot narration synthesis with voice settings control.
 */

import type { IBatchTTS, BatchTTSConfig, BatchTTSResult } from '../types.js';
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
import { isQuotaError } from '../../core/providers/quotaErrors.js';

/** Configuration for the ElevenLabs batch TTS provider. */
export interface ElevenLabsBatchTTSConfig {
  /** ElevenLabs API key. */
  apiKey: string;
  /** Default voice ID. Falls back to 'EXAVITQu4vr4xnSDxMaL' (Rachel). */
  voiceId?: string;
  /** Model identifier. Defaults to 'eleven_multilingual_v2'. */
  model?: string;
  /** Base URL for the ElevenLabs API. Defaults to 'https://api.elevenlabs.io/v1'. */
  baseUrl?: string;
}

/** Approximate bytes per second for 128kbps MP3 audio. */
const BYTES_PER_SEC_MP3 = 16_000;

/**
 * Batch (one-shot) TTS provider using ElevenLabs' REST text-to-speech endpoint.
 *
 * Accepts complete text and returns finished MP3 audio with voice settings
 * control via `providerOptions` (stability, similarityBoost, style, useSpeakerBoost).
 */
export class ElevenLabsBatchTTS implements IBatchTTS {
  readonly providerId = 'elevenlabs-batch';

  /** API key pool for round-robin rotation and quota failover. */
  private readonly keyPool: ApiKeyPool;

  /** Default voice ID when none is provided in the synthesis config. */
  private readonly defaultVoiceId: string;

  /** Model identifier sent with each request. */
  private readonly model: string;

  /** Base URL for all API requests. */
  private readonly baseUrl: string;

  constructor(config: ElevenLabsBatchTTSConfig) {
    this.keyPool = new ApiKeyPool(config.apiKey);
    this.defaultVoiceId = config.voiceId ?? 'EXAVITQu4vr4xnSDxMaL';
    this.model = config.model ?? 'eleven_multilingual_v2';
    this.baseUrl = config.baseUrl ?? 'https://api.elevenlabs.io/v1';
  }

  /**
   * Synthesize complete text into MP3 audio via ElevenLabs REST API.
   *
   * @param text - The text to synthesize.
   * @param config - Optional synthesis configuration (voice, model, providerOptions).
   * @returns Resolved {@link BatchTTSResult} containing the MP3 audio buffer.
   * @throws Error if the API returns a non-OK status.
   */
  async synthesize(text: string, config?: BatchTTSConfig): Promise<BatchTTSResult> {
    const voiceId = config?.voice ?? this.defaultVoiceId;
    const opts = config?.providerOptions ?? {};

    const doFetch = (key: string) =>
      fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: config?.model ?? this.model,
          voice_settings: {
            stability: (opts.stability as number) ?? 0.5,
            similarity_boost: (opts.similarityBoost as number) ?? 0.75,
            style: (opts.style as number) ?? 0.0,
            use_speaker_boost: (opts.useSpeakerBoost as boolean) ?? true,
          },
        }),
      });

    const key = this.keyPool.next();
    let res = await doFetch(key);

    if (!res.ok && this.keyPool.size > 1) {
      const body = await res.text().catch(() => '');
      if (isQuotaError(res.status, body)) {
        this.keyPool.markExhausted(key);
        res = await doFetch(this.keyPool.next());
      } else {
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${body.slice(0, 200)}`);
      }
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${detail.slice(0, 200)}`);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    const durationMs = Math.round((audio.byteLength / BYTES_PER_SEC_MP3) * 1000);

    return { audio, format: 'mp3', durationMs, provider: this.providerId };
  }
}

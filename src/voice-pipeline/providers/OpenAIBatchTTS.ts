/**
 * @module voice-pipeline/providers/OpenAIBatchTTS
 *
 * Batch text-to-speech via OpenAI's REST API. Implements {@link IBatchTTS}
 * for one-shot narration synthesis. Supports tts-1 (cheap) and tts-1-hd (quality).
 */

import type { IBatchTTS, BatchTTSConfig, BatchTTSResult } from '../types.js';
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
import { isQuotaError } from '../../core/providers/quotaErrors.js';

/** Configuration for the OpenAI batch TTS provider. */
export interface OpenAIBatchTTSConfig {
  /** OpenAI API key. */
  apiKey: string;
  /** Model to use. Defaults to 'tts-1'. */
  model?: 'tts-1' | 'tts-1-hd';
  /** Base URL for the OpenAI API. Defaults to 'https://api.openai.com/v1'. */
  baseUrl?: string;
}

/** Approximate bytes per second for MP3 at default OpenAI TTS bitrate. */
const BYTES_PER_SEC_MP3 = 16_000;

/**
 * One-shot TTS provider backed by the OpenAI `/audio/speech` endpoint.
 * Accepts complete text and returns a finished audio buffer.
 */
export class OpenAIBatchTTS implements IBatchTTS {
  readonly providerId: string;
  private readonly keyPool: ApiKeyPool;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: OpenAIBatchTTSConfig) {
    this.keyPool = new ApiKeyPool(config.apiKey);
    this.model = config.model ?? 'tts-1';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.providerId = `openai-${this.model}`;
  }

  /**
   * Synthesize complete text into audio via the OpenAI speech API.
   *
   * @param text - The text to synthesize.
   * @param config - Optional voice, format, and speed overrides.
   * @returns The synthesized audio buffer with metadata.
   */
  async synthesize(text: string, config?: BatchTTSConfig): Promise<BatchTTSResult> {
    const voice = config?.voice ?? 'nova';
    const format = config?.format ?? 'mp3';

    const body: Record<string, unknown> = {
      model: this.model,
      input: text,
      voice,
      response_format: format,
    };
    if (config?.speed != null) body.speed = config.speed;

    const doFetch = (key: string) =>
      fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

    const key = this.keyPool.next();
    let res = await doFetch(key);

    if (!res.ok && this.keyPool.size > 1) {
      const errBody = await res.text().catch(() => '');
      if (isQuotaError(res.status, errBody)) {
        this.keyPool.markExhausted(key);
        res = await doFetch(this.keyPool.next());
      } else {
        throw new Error(`OpenAI TTS failed: ${res.status} ${errBody.slice(0, 200)}`);
      }
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI TTS failed: ${res.status} ${detail.slice(0, 200)}`);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    const durationMs = Math.round((audio.byteLength / BYTES_PER_SEC_MP3) * 1000);

    return { audio, format, durationMs, provider: this.providerId };
  }
}

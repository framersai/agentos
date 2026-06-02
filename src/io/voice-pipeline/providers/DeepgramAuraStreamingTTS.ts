/**
 * @module voice-pipeline/providers/DeepgramAuraStreamingTTS
 *
 * Streaming text-to-speech adapter for Deepgram Aura over WebSocket,
 * implementing {@link IStreamingTTS} / {@link StreamingTTSSession} for
 * {@link VoicePipelineOrchestrator}.
 *
 * ## Deepgram Aura WebSocket protocol
 *
 * - **Endpoint:** `wss://api.deepgram.com/v1/speak?model={voice}&encoding={enc}`
 * - **Authentication:** `Authorization: Token {apiKey}` header (same as REST).
 * - **Inbound (client → Deepgram):** JSON control frames —
 *   `{ "type": "Speak", "text": "..." }`, `{ "type": "Flush" }`, `{ "type": "Clear" }`.
 * - **Outbound (Deepgram → client):** BINARY audio frames, plus text JSON
 *   control frames (`{ "type": "Flushed" | "Cleared" | "Metadata" | "Warning" }`).
 *
 * Audio arrives as raw binary (unlike ElevenLabs, which base64-encodes audio
 * inside JSON), so the message handler branches on the `ws` `isBinary` flag.
 *
 * @see https://developers.deepgram.com/docs/tts-websocket
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type {
  IStreamingTTS,
  StreamingTTSSession,
  StreamingTTSConfig,
  EncodedAudioChunk,
} from '../types.js';
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';
import {
  defaultCapabilities,
  type HealthyProvider,
  type HealthCheckResult,
  type ProviderCapabilities,
} from '../HealthyProvider.js';
import { VoicePipelineError } from '../VoicePipelineError.js';

const DEFAULT_VOICE = 'aura-2-thalia-en';
const DEFAULT_SAMPLE_RATE = 24_000;
/** Approx MP3 bytes/sec at Aura's default bitrate — used only for a duration estimate. */
const BYTES_PER_SEC_MP3 = 16_000;

async function defaultDeepgramTtsProbe(apiKey: string) {
  const start = Date.now();
  const res = await fetch('https://api.deepgram.com/v1/auth/token', {
    headers: { Authorization: `Token ${apiKey}` },
    signal: AbortSignal.timeout(1000),
  });
  return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
}

/** Configuration for the {@link DeepgramAuraStreamingTTS} provider. */
export interface DeepgramAuraStreamingTTSConfig {
  /** Deepgram API key. */
  apiKey: string;
  /** Base WS URL. @default 'wss://api.deepgram.com/v1/speak' */
  baseUrl?: string;
  /** Default Aura voice model. @default 'aura-2-thalia-en' */
  voice?: string;
  /** Chain priority. Lower values are tried first. @default 5 */
  priority?: number;
  /** Optional capability overrides. */
  capabilities?: Partial<ProviderCapabilities>;
  /** Injectable health probe for tests. */
  healthProbe?: (apiKey: string) => Promise<{ ok: boolean; status: number; latencyMs: number }>;
}

/** Map the pipeline audio-format union to a Deepgram `encoding` value. */
function toDeepgramEncoding(format: 'pcm' | 'mp3' | 'opus'): { encoding: string; format: 'pcm' | 'mp3' | 'opus' } {
  if (format === 'opus') return { encoding: 'opus', format: 'opus' };
  if (format === 'pcm') return { encoding: 'linear16', format: 'pcm' };
  return { encoding: 'mp3', format: 'mp3' };
}

/**
 * A live streaming TTS session connected to Deepgram Aura via WebSocket.
 * Emits `audio`, `flush_complete`, `error`, and `close`.
 */
class DeepgramAuraStreamingTTSSession extends EventEmitter implements StreamingTTSSession {
  private ws: WebSocket | null = null;
  private closed = false;
  private pendingFlush = false;
  private accumulatedText = '';
  private readonly voice: string;
  private readonly encoding: string;
  private readonly format: 'pcm' | 'mp3' | 'opus';
  private readonly sampleRate: number;

  constructor(
    private readonly config: DeepgramAuraStreamingTTSConfig,
    sessionConfig: StreamingTTSConfig
  ) {
    super();
    this.voice = sessionConfig.voice ?? config.voice ?? DEFAULT_VOICE;
    const mapped = toDeepgramEncoding(sessionConfig.format ?? 'mp3');
    this.encoding = mapped.encoding;
    this.format = mapped.format;
    this.sampleRate = sessionConfig.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  /** Open the WebSocket. Deepgram needs no beginning-of-stream handshake. */
  async connect(): Promise<void> {
    const wsBase = this.config.baseUrl ?? 'wss://api.deepgram.com/v1/speak';
    const params = new URLSearchParams({ model: this.voice, encoding: this.encoding });
    // linear16 (raw PCM) requires an explicit sample_rate; container formats infer it.
    if (this.encoding === 'linear16') params.set('sample_rate', String(this.sampleRate));
    const url = `${wsBase}?${params.toString()}`;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
      });

      this.ws.on('open', () => resolve());
      this.ws.on('error', (err: Error) => {
        this.emit('error', err);
        reject(err);
      });
      this.ws.on('message', (data: Buffer, isBinary: boolean) => this._handleMessage(data, isBinary));
      this.ws.on('close', () => {
        this.closed = true;
        this.emit('close');
      });
    });
  }

  pushTokens(tokens: string): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.accumulatedText += tokens;
    this.ws.send(JSON.stringify({ type: 'Speak', text: tokens }));
  }

  async flush(): Promise<void> {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pendingFlush = true;
    this.ws.send(JSON.stringify({ type: 'Flush' }));

    return new Promise<void>((resolve) => {
      const onFlush = () => {
        this.removeListener('_internal_flush', onFlush);
        clearTimeout(timeout);
        resolve();
      };
      // Safety timeout: resolve after 5s even if no Flushed frame arrives.
      const timeout = setTimeout(() => {
        this.removeListener('_internal_flush', onFlush);
        this.pendingFlush = false;
        this.emit('flush_complete');
        resolve();
      }, 5_000);
      this.on('_internal_flush', onFlush);
    });
  }

  cancel(): void {
    this.pendingFlush = false;
    this.accumulatedText = '';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Clear discards server-buffered audio without tearing down the socket.
      this.ws.send(JSON.stringify({ type: 'Clear' }));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000, 'session closed');
      this.ws = null;
    }
    this.emit('close');
  }

  private _handleMessage(data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      // Raw PCM (linear16) is uncompressed at sampleRate * 2 bytes/sec (16-bit);
      // mp3/opus are compressed, estimated at BYTES_PER_SEC_MP3.
      const bytesPerSec = this.format === 'pcm' ? this.sampleRate * 2 : BYTES_PER_SEC_MP3;
      const durationMs = Math.round((audioBuffer.byteLength / bytesPerSec) * 1000);
      const chunk: EncodedAudioChunk = {
        audio: audioBuffer,
        format: this.format,
        sampleRate: this.sampleRate,
        durationMs,
        text: this.accumulatedText,
      };
      this.emit('audio', chunk);
      return;
    }

    // Text control frame.
    let msg: { type?: string };
    try {
      msg = JSON.parse(data.toString('utf-8'));
    } catch {
      return;
    }
    if (msg.type === 'Flushed') {
      this.accumulatedText = '';
      if (this.pendingFlush) {
        this.pendingFlush = false;
        this.emit('_internal_flush');
        this.emit('flush_complete');
      }
    }
    // Metadata / Cleared / Warning frames are ignored.
  }
}

/**
 * Streaming TTS provider that creates Deepgram Aura WebSocket sessions.
 * Implements {@link IStreamingTTS} for use with {@link VoicePipelineOrchestrator}.
 *
 * @example
 * ```typescript
 * const tts = new DeepgramAuraStreamingTTS({ apiKey: process.env.DEEPGRAM_API_KEY! });
 * const session = await tts.startSession({ voice: 'aura-2-arcas-en' });
 * session.on('audio', (chunk) => transport.sendAudio(chunk));
 * session.pushTokens('Hello there!');
 * await session.flush();
 * ```
 */
export class DeepgramAuraStreamingTTS implements IStreamingTTS, HealthyProvider {
  readonly providerId = 'deepgram-aura';
  readonly priority: number;
  readonly capabilities: ProviderCapabilities;
  private readonly keyPool: ApiKeyPool;
  private readonly healthProbe: NonNullable<DeepgramAuraStreamingTTSConfig['healthProbe']>;

  constructor(private readonly config: DeepgramAuraStreamingTTSConfig) {
    this.keyPool = new ApiKeyPool(config.apiKey);
    this.priority = config.priority ?? 5;
    this.capabilities = defaultCapabilities({
      languages: ['*'],
      streaming: true,
      costTier: 'cheap',
      latencyClass: 'realtime',
      ...(config.capabilities ?? {}),
    });
    this.healthProbe = config.healthProbe ?? defaultDeepgramTtsProbe;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.keyPool.hasKeys) {
      return { ok: false, error: { class: 'auth', message: 'no api key available' } };
    }
    const key = this.keyPool.next();
    try {
      const res = await this.healthProbe(key);
      if (res.ok) return { ok: true, latencyMs: res.latencyMs };
      const classified = VoicePipelineError.classifyError(new Error(`HTTP ${res.status}`), {
        kind: 'tts',
        provider: this.providerId,
      });
      return {
        ok: false,
        latencyMs: res.latencyMs,
        error: { class: classified.errorClass, message: `HTTP ${res.status}` },
      };
    } catch (err) {
      const classified = VoicePipelineError.classifyError(err, {
        kind: 'tts',
        provider: this.providerId,
      });
      return { ok: false, error: { class: classified.errorClass, message: classified.message } };
    }
  }

  async startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession> {
    const resolvedConfig = { ...this.config, apiKey: this.keyPool.next() };
    const session = new DeepgramAuraStreamingTTSSession(resolvedConfig, config ?? {});
    await session.connect();
    return session;
  }
}

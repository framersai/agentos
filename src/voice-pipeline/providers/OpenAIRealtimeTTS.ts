/**
 * @module voice-pipeline/providers/OpenAIRealtimeTTS
 *
 * Streaming TTS via OpenAI's Realtime API (gpt-4o-mini-tts).
 * Implements {@link IStreamingTTS} with the same interface as ElevenLabsStreamingTTS.
 *
 * Protocol: WebSocket to wss://api.openai.com/v1/realtime with session-based events.
 * Text is sent via conversation.item.create + response.create events.
 * Audio arrives as response.audio.delta base64-encoded chunks.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type {
  IStreamingTTS,
  StreamingTTSSession,
  StreamingTTSConfig,
  EncodedAudioChunk,
} from '../types.js';
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';

export interface OpenAIRealtimeTTSConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

class OpenAIRealtimeTTSSession extends EventEmitter implements StreamingTTSSession {
  private ws: WebSocket | null = null;
  private closed = false;
  private pendingFlush = false;
  /** Accumulates text pushed via pushTokens so we can attach it to audio chunks. */
  private pendingText = '';

  constructor(
    private readonly config: OpenAIRealtimeTTSConfig,
    private readonly sessionConfig: StreamingTTSConfig
  ) {
    super();
  }

  async connect(): Promise<void> {
    const model = this.config.model ?? 'gpt-4o-mini-tts';
    const baseUrl = this.config.baseUrl ?? 'wss://api.openai.com/v1/realtime';
    const url = `${baseUrl}?model=${model}`;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        this.ws!.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            voice: this.sessionConfig.voice ?? 'alloy',
          },
        }));
        resolve();
      });

      this.ws.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.ws.on('message', (data: Buffer | string) => {
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf-8'));
        this._handleMessage(msg);
      });

      this.ws.on('close', () => {
        this.closed = true;
        this.emit('close');
      });
    });
  }

  pushTokens(tokens: string): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.pendingText += tokens;

    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: tokens }],
      },
    }));
  }

  async flush(): Promise<void> {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.pendingFlush = true;
    this.ws.send(JSON.stringify({ type: 'response.create' }));

    return new Promise<void>((resolve) => {
      const onDone = () => {
        this.removeListener('_internal_flush', onDone);
        resolve();
      };
      this.on('_internal_flush', onDone);
      setTimeout(() => {
        this.removeListener('_internal_flush', onDone);
        resolve();
      }, 30_000);
    });
  }

  cancel(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'response.cancel' }));
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private _handleMessage(msg: Record<string, unknown>): void {
    if (msg.type === 'response.audio.delta') {
      const audioB64 = (msg as any).delta as string;
      if (audioB64) {
        const audioBuffer = Buffer.from(audioB64, 'base64');
        const chunk: EncodedAudioChunk = {
          audio: audioBuffer,
          format: 'pcm',
          sampleRate: 24000,
          durationMs: Math.round((audioBuffer.byteLength / (24000 * 2)) * 1000),
          text: this.pendingText,
        };
        this.emit('audio', chunk);
      }
    } else if (msg.type === 'response.audio.done' || msg.type === 'response.done') {
      if (this.pendingFlush) {
        this.pendingFlush = false;
        this.pendingText = '';
        this.emit('_internal_flush');
        this.emit('flush_complete');
      }
    } else if (msg.type === 'error') {
      this.emit('error', new Error(String((msg as any).error?.message ?? 'Unknown error')));
    }
  }
}

export class OpenAIRealtimeTTS implements IStreamingTTS {
  readonly providerId = 'openai-realtime';
  private readonly config: OpenAIRealtimeTTSConfig;
  private readonly keyPool: ApiKeyPool;

  constructor(config: OpenAIRealtimeTTSConfig) {
    this.config = config;
    this.keyPool = new ApiKeyPool(config.apiKey);
  }

  async startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession> {
    const resolvedConfig = { ...this.config, apiKey: this.keyPool.next() };
    const session = new OpenAIRealtimeTTSSession(resolvedConfig, config ?? {});
    await session.connect();
    return session;
  }
}

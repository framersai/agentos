/**
 * @fileoverview TelephonyStreamTransport — bridges a telephony WebSocket media
 * stream to the AgentOS streaming voice pipeline.
 *
 * Incoming mu-law 8 kHz audio from the phone network is decoded to Int16 PCM,
 * resampled to the pipeline's preferred sample rate, normalised to Float32, and
 * emitted as {@link AudioFrame} events. Outbound {@link EncodedAudioChunk}
 * payloads are resampled from the pipeline's sample rate back to 8 kHz, encoded
 * to mu-law, and forwarded through the provider-specific {@link MediaStreamParser}.
 *
 * @module @framers/agentos/voice/TelephonyStreamTransport
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { MediaStreamParser } from './MediaStreamParser.js';
import { convertPcmToMulaw8k, convertMulawToPcm16 } from './telephony-audio.js';
import type {
  AudioFrame,
  EncodedAudioChunk,
  IStreamTransport,
  ServerTextMessage,
} from '../voice-pipeline/types.js';

// ============================================================================
// TelephonyStreamTransport
// ============================================================================

/**
 * Optional construction-time configuration for {@link TelephonyStreamTransport}.
 */
export interface TelephonyStreamTransportConfig {
  /**
   * Sample rate the pipeline expects for inbound {@link AudioFrame} events.
   * Incoming 8 kHz telephony audio is upsampled to this rate.
   * @defaultValue 16000
   */
  outputSampleRate?: number;
}

/**
 * Adapts a telephony provider WebSocket media stream to the
 * {@link IStreamTransport} interface consumed by the AgentOS voice pipeline.
 *
 * ## Inbound path (phone → pipeline)
 * 1. Provider WebSocket frames arrive as raw `Buffer` or JSON `string`.
 * 2. {@link MediaStreamParser.parseIncoming} normalises them to
 *    {@link MediaStreamIncoming} events.
 * 3. `'audio'` events: mu-law 8 kHz → Int16 PCM → resample → Float32 → `'audio'` emit.
 * 4. `'dtmf'` / `'mark'` events are re-emitted as-is for higher-layer handling.
 * 5. `'start'` transitions the transport to `'open'` and sends the optional
 *    connection acknowledgment from the parser.
 * 6. `'stop'` or WebSocket close transitions to `'closed'` and emits `'close'`.
 *
 * ## Outbound path (pipeline → phone)
 * 1. {@link sendAudio} receives an {@link EncodedAudioChunk} (PCM Int16 format assumed).
 * 2. Chunk is resampled from `chunk.sampleRate` → 8 kHz via linear interpolation.
 * 3. Resampled PCM is mu-law encoded via {@link convertPcmToMulaw8k}.
 * 4. {@link MediaStreamParser.formatOutgoing} wraps the bytes for the provider.
 * 5. The formatted payload is sent over the WebSocket.
 *
 * Emits:
 * - `'audio'` ({@link AudioFrame}) — inbound decoded audio for STT / VAD.
 * - `'dtmf'` (`{ digit: string; durationMs?: number }`) — caller key-press.
 * - `'mark'` (`{ name: string }`) — named stream marker.
 * - `'close'` () — transport has been fully closed.
 * - `'error'` (Error) — unrecoverable WebSocket or parsing error.
 */
export class TelephonyStreamTransport extends EventEmitter implements IStreamTransport {
  // ---------------------------------------------------------------------------
  // IStreamTransport — identity & state
  // ---------------------------------------------------------------------------

  /** Stable UUID for this transport connection. */
  readonly id: string = randomUUID();

  private _state: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';

  /** Current connection lifecycle state. */
  get state(): 'connecting' | 'open' | 'closing' | 'closed' {
    return this._state;
  }

  // ---------------------------------------------------------------------------
  // Private fields
  // ---------------------------------------------------------------------------

  /** Provider-assigned stream identifier; populated on the 'start' event. */
  private streamSid: string | null = null;

  /** Target sample rate for emitted AudioFrames (pipeline input requirement). */
  private readonly outputSampleRate: number;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param ws - WebSocket-like object (must emit `'message'`, `'close'`, `'error'`
   *   and expose `send(data)` and `close(code?, reason?)` methods).
   * @param parser - Provider-specific message parser/formatter.
   * @param config - Optional configuration overrides.
   */
  constructor(
    private readonly ws: any, // WebSocket-like; typed `any` to avoid hard dep on ws package
    private readonly parser: MediaStreamParser,
    config?: TelephonyStreamTransportConfig,
  ) {
    super();
    this.outputSampleRate = config?.outputSampleRate ?? 16000;

    this.ws.on('message', (data: Buffer | string) => {
      const parsed = this.parser.parseIncoming(data);
      if (!parsed) return;

      switch (parsed.type) {
        case 'start': {
          this.streamSid = parsed.streamSid;
          this._state = 'open';
          // Send connection acknowledgment if the provider requires one.
          const connMsg = this.parser.formatConnected?.(parsed.streamSid);
          if (connMsg) this.ws.send(connMsg);
          break;
        }

        case 'audio': {
          // mu-law 8 kHz → Int16 PCM buffer (2 bytes per sample).
          const pcm16Buf = convertMulawToPcm16(parsed.payload);

          // Convert Buffer to Int16Array (shared memory, no copy).
          const int16 = new Int16Array(
            pcm16Buf.buffer,
            pcm16Buf.byteOffset,
            pcm16Buf.byteLength / 2,
          );

          // Resample 8 kHz → outputSampleRate.
          const resampled = this.resample(int16, 8000, this.outputSampleRate);

          // Normalise Int16 → Float32 [-1, 1].
          const float32 = new Float32Array(resampled.length);
          for (let i = 0; i < resampled.length; i++) {
            float32[i] = resampled[i] / 32768;
          }

          const frame: AudioFrame = {
            samples: float32,
            sampleRate: this.outputSampleRate,
            timestamp: Date.now(),
          };
          this.emit('audio', frame);
          break;
        }

        case 'dtmf':
          this.emit('dtmf', { digit: parsed.digit, durationMs: parsed.durationMs });
          break;

        case 'stop':
          this._state = 'closed';
          this.emit('close');
          break;

        case 'mark':
          this.emit('mark', { name: parsed.name });
          break;
      }
    });

    this.ws.on('close', () => {
      if (this._state !== 'closed') {
        this._state = 'closed';
        this.emit('close');
      }
    });

    this.ws.on('error', (err: Error) => this.emit('error', err));
  }

  // ---------------------------------------------------------------------------
  // IStreamTransport — outbound methods
  // ---------------------------------------------------------------------------

  /**
   * Send synthesised audio to the caller.
   *
   * Assumes `chunk.format === 'pcm'` and that `chunk.audio` contains raw
   * signed 16-bit little-endian PCM samples at `chunk.sampleRate`. The audio
   * is resampled to 8 kHz, mu-law encoded, and forwarded via the parser.
   *
   * @param chunk - Encoded audio chunk from the TTS pipeline.
   */
  async sendAudio(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.streamSid || this._state !== 'open') return;

    // Interpret raw bytes as Int16 samples.
    const int16 = new Int16Array(
      chunk.audio.buffer,
      chunk.audio.byteOffset,
      chunk.audio.byteLength / 2,
    );

    // Resample to 8 kHz, write into a Buffer for convertPcmToMulaw8k.
    const resampled8k = this.resample(int16, chunk.sampleRate, 8000);
    const pcm8kBuf = Buffer.from(resampled8k.buffer, resampled8k.byteOffset, resampled8k.byteLength);

    // Encode to mu-law. convertPcmToMulaw8k already handles resampling, but
    // we pre-resample here to avoid a second pass; pass sampleRate=8000 so
    // the function's internal resampler is a no-op.
    const mulaw = convertPcmToMulaw8k(pcm8kBuf, 8000);

    const formatted = this.parser.formatOutgoing(mulaw, this.streamSid);
    this.ws.send(formatted);
  }

  /**
   * Send a JSON control message over the WebSocket.
   *
   * @param message - Server-to-client pipeline protocol message.
   */
  async sendControl(message: ServerTextMessage): Promise<void> {
    if (this._state !== 'open') return;
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Initiate graceful closure of the transport.
   *
   * @param code - Optional WebSocket close code (default 1000).
   * @param reason - Optional human-readable close reason.
   */
  close(code?: number, reason?: string): void {
    this._state = 'closing';
    this.ws.close(code, reason);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Linear interpolation resampler for 16-bit signed PCM.
   *
   * Not studio-quality but sufficient for narrow-band voice telephony. The
   * output length is computed as `round(input.length * toRate / fromRate)` to
   * avoid cumulative rounding drift across many small frames.
   *
   * @param input - Source samples as a signed 16-bit integer array.
   * @param fromRate - Sample rate of the input, in Hz.
   * @param toRate - Desired sample rate of the output, in Hz.
   * @returns A new Int16Array at `toRate`.
   */
  private resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
    if (fromRate === toRate) return input;

    const ratio = fromRate / toRate;
    const outputLen = Math.round(input.length / ratio);
    const output = new Int16Array(outputLen);

    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i * ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const a = input[idx] ?? 0;
      const b = input[Math.min(idx + 1, input.length - 1)] ?? 0;
      output[i] = Math.round(a + frac * (b - a));
    }

    return output;
  }
}

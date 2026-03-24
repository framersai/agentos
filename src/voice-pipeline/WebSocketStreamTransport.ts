/**
 * @module voice-pipeline/WebSocketStreamTransport
 *
 * A concrete {@link IStreamTransport} implementation that wraps a WebSocket
 * connection (or any WebSocket-compatible object). Binary messages are decoded
 * as Float32Array audio frames; text messages are parsed as
 * {@link ClientTextMessage} control envelopes.
 *
 * The transport is intentionally transport-agnostic: it accepts any object that
 * exposes the `ws` package's `WebSocket` interface (readyState, send, close, and
 * the standard event emitter surface). This makes it trivially testable with a
 * plain `EventEmitter` mock.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  IStreamTransport,
  AudioFrame,
  EncodedAudioChunk,
  TransportControlMessage,
  ClientTextMessage,
  ServerTextMessage,
} from './types.js';

// ---------------------------------------------------------------------------
// Minimal interface that the transport requires from a WebSocket object.
// Keeps the transport decoupled from any specific ws version or browser API.
// ---------------------------------------------------------------------------

/**
 * Subset of the WebSocket API required by {@link WebSocketStreamTransport}.
 * Both the `ws` npm package and the browser's native WebSocket satisfy this.
 */
export interface WebSocketLike extends NodeJS.EventEmitter {
  /** WebSocket ready-state constant for the OPEN state (= 1). */
  readonly OPEN?: number;
  /** WebSocket ready-state constant for the CLOSED state (= 3). */
  readonly CLOSED?: number;
  /** Current ready state of the socket. */
  readonly readyState: number;
  /**
   * Send data over the socket.
   *
   * @param data — Binary `Buffer` or text `string` payload.
   * @param cb — Optional completion callback used by the `ws` library.
   */
  send(data: Buffer | string, cb?: (err?: Error) => void): void;
  /**
   * Initiate a graceful close handshake.
   *
   * @param code — Optional numeric close code (default 1000).
   * @param reason — Optional human-readable reason string.
   */
  close(code?: number, reason?: string): void;
}

// ---------------------------------------------------------------------------
// Transport configuration
// ---------------------------------------------------------------------------

/**
 * Constructor options for {@link WebSocketStreamTransport}.
 */
export interface WebSocketStreamTransportConfig {
  /**
   * Sample rate (in Hz) used to populate {@link AudioFrame.sampleRate} on
   * inbound binary messages. Must match the rate the remote client is sending.
   * @example 16000
   */
  sampleRate: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Bidirectional voice pipeline transport backed by a WebSocket connection.
 *
 * ### Inbound wire format
 * - **Binary frame** → decoded as a `Float32Array` view, wrapped in an
 *   {@link AudioFrame}, and re-emitted as `'audio_frame'`.
 * - **Text frame** → `JSON.parse()`d and re-emitted as `'control'` carrying
 *   the raw {@link ClientTextMessage} object.
 *
 * ### Outbound API
 * - {@link sendAudio} — serialises an {@link EncodedAudioChunk} or
 *   {@link AudioFrame} to a binary `Buffer` and calls `ws.send()`.
 * - {@link sendControl} — JSON-stringifies a {@link TransportControlMessage}
 *   or {@link ServerTextMessage} and calls `ws.send()`.
 *
 * ### Lifecycle events (re-emitted on `this`)
 * | WS event | Transport emission |
 * |----------|--------------------|
 * | `open`   | `'connected'`      |
 * | `close`  | `'disconnected'`   |
 * | `error`  | `'error'`          |
 *
 * @fires audio_frame — `(frame: AudioFrame)` for every inbound binary message.
 * @fires control — `(msg: ClientTextMessage)` for every inbound text message.
 * @fires connected — Socket transitioned to OPEN state.
 * @fires disconnected — Socket has been fully closed.
 * @fires error — Socket-level error occurred.
 */
export class WebSocketStreamTransport extends EventEmitter implements IStreamTransport {
  // -------------------------------------------------------------------------
  // IStreamTransport identity fields
  // -------------------------------------------------------------------------

  /** Stable UUID assigned at construction time. */
  readonly id: string;

  /** Current connection state. Updated in response to WebSocket events. */
  private _state: 'connecting' | 'open' | 'closing' | 'closed';

  // -------------------------------------------------------------------------
  // Private fields
  // -------------------------------------------------------------------------

  /** The underlying WebSocket connection. */
  private readonly _ws: WebSocketLike;

  /** Audio sample rate propagated into every decoded {@link AudioFrame}. */
  private readonly _sampleRate: number;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a new transport wrapping an existing WebSocket connection.
   *
   * The constructor inspects `ws.readyState` to determine the initial
   * {@link state}: if the socket is already OPEN (readyState === 1) the state
   * is set to `'open'`; otherwise it is set to `'connecting'` and will
   * transition to `'open'` when the `'open'` event fires.
   *
   * @param ws — WebSocket connection (or compatible mock).
   * @param config — Transport-level configuration.
   */
  constructor(ws: WebSocketLike, config: WebSocketStreamTransportConfig) {
    super();
    this._ws = ws;
    this._sampleRate = config.sampleRate;
    this.id = randomUUID();

    // Determine initial state from the socket's current ready-state value.
    // The `ws` package uses numeric constants; OPEN = 1, CLOSED = 3.
    const OPEN_STATE = ws.OPEN ?? 1;
    this._state = ws.readyState === OPEN_STATE ? 'open' : 'connecting';

    this._attachWsListeners();
  }

  // -------------------------------------------------------------------------
  // IStreamTransport — public surface
  // -------------------------------------------------------------------------

  /**
   * Current connection state of the underlying WebSocket.
   * Read-only from the outside; updated internally by WS event handlers.
   */
  get state(): 'connecting' | 'open' | 'closing' | 'closed' {
    return this._state;
  }

  /**
   * Send a synthesised audio chunk to the remote client for playback.
   *
   * If `chunk` carries an {@link EncodedAudioChunk} (has an `audio` Buffer
   * property), that buffer is sent directly. If it carries an {@link AudioFrame}
   * (has a `samples` Float32Array), the samples are copied into a new `Buffer`
   * and sent.
   *
   * @param chunk — Encoded audio chunk or raw PCM frame to deliver.
   * @returns Resolves once the data has been handed to the OS socket buffer.
   */
  sendAudio(chunk: EncodedAudioChunk | AudioFrame): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let binary: Buffer;

      if ('audio' in chunk) {
        // EncodedAudioChunk — already a Buffer
        binary = (chunk as EncodedAudioChunk).audio;
      } else {
        // AudioFrame — convert Float32Array samples to a byte Buffer
        const frame = chunk as AudioFrame;
        binary = Buffer.from(
          frame.samples.buffer,
          frame.samples.byteOffset,
          frame.samples.byteLength,
        );
      }

      this._ws.send(binary, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Send a JSON control message to the remote client.
   *
   * The message is JSON-stringified before transmission. Both
   * {@link TransportControlMessage} and {@link ServerTextMessage} are accepted
   * since they share the same serialisation path.
   *
   * @param msg — Server-side protocol message.
   * @returns Resolves once the message has been handed to the OS socket buffer.
   */
  sendControl(msg: TransportControlMessage | ServerTextMessage): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._ws.send(JSON.stringify(msg), (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Initiate a graceful close of the transport.
   *
   * Sets internal state to `'closing'` immediately, then delegates to the
   * underlying WebSocket's `close()` method. The `'disconnected'` event will
   * fire once the socket's `'close'` event is received.
   *
   * @param code — Optional numeric WebSocket close code (default 1000).
   * @param reason — Optional human-readable close reason.
   */
  close(code?: number, reason?: string): void {
    this._state = 'closing';
    this._ws.close(code, reason);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Attach listeners to the underlying WebSocket for the events that matter to
   * the voice pipeline. All listener state is contained here; no cleanup method
   * is currently needed since the transport's lifetime is tied to the socket's.
   */
  private _attachWsListeners(): void {
    // `message` — inbound data from the remote peer
    this._ws.on('message', (data: Buffer | ArrayBuffer | string) => {
      if (typeof data === 'string') {
        // Text frame — parse as ClientTextMessage and propagate as 'control'
        try {
          const msg = JSON.parse(data) as ClientTextMessage;
          this.emit('control', msg);
        } catch (err) {
          // Malformed JSON — emit as an error but do not crash the transport
          this.emit('error', new Error(`WebSocketStreamTransport: failed to parse text message: ${String(err)}`));
        }
      } else {
        // Binary frame — interpret bytes as a Float32Array PCM sample buffer
        let buffer: Buffer;
        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else {
          // ArrayBuffer (browser-style)
          buffer = Buffer.from(data);
        }

        // Create a Float32Array view over the underlying ArrayBuffer.
        // We use byteOffset/length to handle sliced Buffers correctly.
        const samples = new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );

        const frame: AudioFrame = {
          samples,
          sampleRate: this._sampleRate,
          timestamp: Date.now(),
        };

        this.emit('audio_frame', frame);
      }
    });

    // `open` — socket handshake complete
    this._ws.on('open', () => {
      this._state = 'open';
      this.emit('connected');
    });

    // `close` — socket has been fully closed (either side)
    this._ws.on('close', () => {
      this._state = 'closed';
      this.emit('disconnected');
    });

    // `error` — transport-level socket error
    this._ws.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }
}

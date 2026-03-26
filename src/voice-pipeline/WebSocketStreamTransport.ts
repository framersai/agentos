/**
 * @module voice-pipeline/WebSocketStreamTransport
 *
 * A concrete {@link IStreamTransport} implementation that wraps a WebSocket
 * connection (or any WebSocket-compatible object). Binary messages are decoded
 * as Float32Array audio frames; text messages are parsed as
 * {@link ClientTextMessage} control envelopes.
 *
 * ## Wire protocol
 *
 * ### Binary frames (inbound)
 * Every binary WebSocket message is interpreted as a raw Float32Array of PCM
 * samples. The sender (browser/client) must transmit audio as a `Float32Array`
 * view serialised to its underlying `ArrayBuffer`. The transport reconstructs
 * the `Float32Array` from the received `Buffer`, using `byteOffset` and
 * `byteLength` to handle sliced buffers correctly.
 *
 * ### Text frames (inbound)
 * Every text WebSocket message must be valid JSON conforming to
 * {@link ClientTextMessage}. Malformed JSON emits an `'error'` event but does
 * not crash the transport, allowing the session to continue.
 *
 * ### Binary frames (outbound)
 * {@link sendAudio} sends the raw `Buffer` from an {@link EncodedAudioChunk}
 * (or converts a `Float32Array` to a `Buffer` for raw {@link AudioFrame}s).
 *
 * ### Text frames (outbound)
 * {@link sendControl} JSON-stringifies a {@link ServerTextMessage} and sends
 * it as a text frame.
 *
 * ## Reconnection behaviour
 * This transport does NOT implement automatic reconnection. If the underlying
 * WebSocket closes, the transport transitions to `'closed'` and emits
 * `'disconnected'`. The consumer (typically the orchestrator) is responsible
 * for creating a new transport and session if reconnection is desired.
 *
 * ## Transport-agnostic design
 * The transport accepts any object satisfying {@link WebSocketLike}, which is
 * a minimal subset of the `ws` package's `WebSocket` interface. This makes it
 * trivially testable with a plain `EventEmitter` mock and compatible with
 * browser-style WebSocket polyfills.
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
// Minimal WebSocket interface
// ---------------------------------------------------------------------------

/**
 * Subset of the WebSocket API required by {@link WebSocketStreamTransport}.
 * Both the `ws` npm package and the browser's native WebSocket satisfy this.
 *
 * By depending on this minimal interface rather than the full `ws.WebSocket`
 * type, the transport avoids a hard dependency on any specific WebSocket
 * library and remains easily mockable in tests.
 *
 * @see {@link WebSocketStreamTransport} which consumes this interface.
 */
export interface WebSocketLike extends NodeJS.EventEmitter {
  /**
   * WebSocket ready-state constant for the OPEN state.
   * In the `ws` package this is `1`; in browsers it is also `1`.
   * Optional because some mock implementations may not define it.
   */
  readonly OPEN?: number;

  /**
   * WebSocket ready-state constant for the CLOSED state.
   * In the `ws` package this is `3`.
   * Optional because some mock implementations may not define it.
   */
  readonly CLOSED?: number;

  /**
   * Current ready state of the socket.
   * - `0` = CONNECTING
   * - `1` = OPEN
   * - `2` = CLOSING
   * - `3` = CLOSED
   */
  readonly readyState: number;

  /**
   * Send data over the socket.
   *
   * @param data - Binary `Buffer` or text `string` payload.
   * @param cb - Optional completion callback used by the `ws` library.
   *   The callback receives an optional `Error` if the send fails.
   */
  send(data: Buffer | string, cb?: (err?: Error) => void): void;

  /**
   * Initiate a graceful close handshake.
   *
   * @param code - Optional numeric close code (default 1000 = normal closure).
   * @param reason - Optional human-readable reason string.
   */
  close(code?: number, reason?: string): void;
}

// ---------------------------------------------------------------------------
// Transport configuration
// ---------------------------------------------------------------------------

/**
 * Constructor options for {@link WebSocketStreamTransport}.
 *
 * @example
 * ```typescript
 * const config: WebSocketStreamTransportConfig = { sampleRate: 16000 };
 * const transport = new WebSocketStreamTransport(ws, config);
 * ```
 */
export interface WebSocketStreamTransportConfig {
  /**
   * Sample rate (in Hz) used to populate {@link AudioFrame.sampleRate} on
   * inbound binary messages. Must match the rate the remote client is sending.
   *
   * Common values: 16000 (telephony/STT), 24000 (TTS output), 48000 (high-fidelity).
   *
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
 * ## Inbound wire format
 *
 * | Frame type | Processing                                                |
 * |------------|-----------------------------------------------------------|
 * | Binary     | Decoded as `Float32Array` PCM samples, wrapped in an {@link AudioFrame}, emitted as `'audio_frame'`. |
 * | Text       | `JSON.parse()`d as {@link ClientTextMessage}, emitted as `'control'`. |
 *
 * ## Outbound API
 *
 * | Method          | Behaviour                                              |
 * |-----------------|--------------------------------------------------------|
 * | {@link sendAudio}   | Serialises audio to a binary `Buffer` and calls `ws.send()`. |
 * | {@link sendControl} | JSON-stringifies the message and calls `ws.send()`.    |
 *
 * ## Lifecycle events (re-emitted on `this`)
 *
 * | WS event | Transport emission |
 * |----------|--------------------|
 * | `open`   | `'connected'`      |
 * | `close`  | `'disconnected'`   |
 * | `error`  | `'error'`          |
 *
 * @fires audio_frame - `(frame: AudioFrame)` for every inbound binary message.
 * @fires control - `(msg: ClientTextMessage)` for every inbound text message.
 * @fires connected - Socket transitioned to OPEN state.
 * @fires disconnected - Socket has been fully closed.
 * @fires error - Socket-level error occurred.
 *
 * @see {@link IStreamTransport} for the interface contract.
 * @see {@link VoicePipelineOrchestrator} which consumes this transport.
 *
 * @example
 * ```typescript
 * import WebSocket from 'ws';
 * const ws = new WebSocket('ws://localhost:8080/voice');
 * const transport = new WebSocketStreamTransport(ws, { sampleRate: 16000 });
 *
 * transport.on('audio_frame', (frame) => sttSession.pushAudio(frame));
 * transport.on('control', (msg) => handleClientMessage(msg));
 * ```
 */
export class WebSocketStreamTransport extends EventEmitter implements IStreamTransport {
  // -------------------------------------------------------------------------
  // IStreamTransport identity fields
  // -------------------------------------------------------------------------

  /**
   * Stable UUID assigned at construction time.
   * Used as a correlation key in logs and metrics.
   */
  readonly id: string;

  /**
   * Current connection state. Updated internally by WebSocket event handlers.
   * Read externally via the {@link state} getter.
   */
  private _state: 'connecting' | 'open' | 'closing' | 'closed';

  // -------------------------------------------------------------------------
  // Private fields
  // -------------------------------------------------------------------------

  /** The underlying WebSocket connection. */
  private readonly _ws: WebSocketLike;

  /**
   * Audio sample rate propagated into every decoded {@link AudioFrame}.
   * Configured once at construction and never changed.
   */
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
   * @param ws - WebSocket connection (or compatible mock).
   * @param config - Transport-level configuration (must include sampleRate).
   */
  constructor(ws: WebSocketLike, config: WebSocketStreamTransportConfig) {
    super();
    this._ws = ws;
    this._sampleRate = config.sampleRate;
    this.id = randomUUID();

    // Determine initial state from the socket's current ready-state value.
    // The `ws` package uses numeric constants: OPEN = 1, CLOSED = 3.
    // We default to 1 if the OPEN constant is not defined (e.g. in mocks).
    const OPEN_STATE = ws.OPEN ?? 1;
    this._state = ws.readyState === OPEN_STATE ? 'open' : 'connecting';

    this._attachWsListeners();
  }

  // -------------------------------------------------------------------------
  // IStreamTransport -- public surface
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
   * If the payload is an {@link EncodedAudioChunk} (has an `audio` Buffer
   * property), that buffer is sent directly as a binary frame. If it is an
   * {@link AudioFrame} (has a `samples` Float32Array), the samples are copied
   * into a new `Buffer` and sent.
   *
   * @param chunk - Encoded audio chunk or raw PCM frame to deliver.
   * @returns Resolves once the data has been handed to the OS socket buffer.
   *
   * @throws {Error} If the underlying `ws.send()` fails (e.g. socket closed).
   */
  sendAudio(chunk: EncodedAudioChunk | AudioFrame): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let binary: Buffer;

      if ('audio' in chunk) {
        // EncodedAudioChunk path: the audio property is already a Buffer
        binary = (chunk as EncodedAudioChunk).audio;
      } else {
        // AudioFrame path: convert Float32Array samples to a raw byte Buffer.
        // We must use byteOffset and byteLength because the Float32Array may
        // be a view into a larger SharedArrayBuffer or sliced Buffer.
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
   * @param msg - Server-side protocol message.
   * @returns Resolves once the message has been handed to the OS socket buffer.
   *
   * @throws {Error} If the underlying `ws.send()` fails (e.g. socket closed).
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
   * @param code - Optional numeric WebSocket close code (default 1000 = normal closure).
   * @param reason - Optional human-readable close reason.
   */
  close(code?: number, reason?: string): void {
    this._state = 'closing';
    this._ws.close(code, reason);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Attach listeners to the underlying WebSocket for all events relevant to
   * the voice pipeline.
   *
   * All listener state is contained here. No cleanup method is currently
   * needed because the transport's lifetime is tied to the socket's --
   * when the socket closes, the transport transitions to `'closed'` and
   * no further events are expected.
   */
  private _attachWsListeners(): void {
    // `message` -- inbound data from the remote peer
    this._ws.on('message', (data: Buffer | ArrayBuffer | string) => {
      if (typeof data === 'string') {
        // Text frame: parse as ClientTextMessage JSON and propagate as 'control'.
        // Malformed JSON emits an error but does NOT crash the transport,
        // allowing the session to recover from a single bad message.
        try {
          const msg = JSON.parse(data) as ClientTextMessage;
          this.emit('control', msg);
        } catch (err) {
          this.emit(
            'error',
            new Error(
              `WebSocketStreamTransport: failed to parse inbound text message as JSON: ${String(err)}`,
            ),
          );
        }
      } else {
        // Binary frame: interpret bytes as a Float32Array PCM sample buffer.
        // The `ws` package delivers binary as a Node.js Buffer; browser-style
        // WebSocket polyfills may deliver an ArrayBuffer instead.
        let buffer: Buffer;
        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else {
          // ArrayBuffer (browser-style) -- wrap in a Node.js Buffer
          buffer = Buffer.from(data);
        }

        // Create a Float32Array view over the underlying ArrayBuffer.
        // We use byteOffset and byteLength to handle sliced Buffers correctly,
        // since Buffer.from() may return a view into Node's internal pool
        // rather than a fresh allocation.
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

    // `open` -- socket handshake complete (fires for late-open connections)
    this._ws.on('open', () => {
      this._state = 'open';
      this.emit('connected');
    });

    // `close` -- socket has been fully closed (either side initiated)
    this._ws.on('close', () => {
      this._state = 'closed';
      this.emit('disconnected');
    });

    // `error` -- transport-level socket error. Re-emitted verbatim so the
    // orchestrator can log it and decide whether to tear down the session.
    this._ws.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }
}

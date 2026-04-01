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
 * `sendAudio()` sends the raw `Buffer` from an {@link EncodedAudioChunk}
 * (or converts a `Float32Array` to a `Buffer` for raw {@link AudioFrame}s).
 *
 * ### Text frames (outbound)
 * `sendControl()` JSON-stringifies a {@link ServerTextMessage} and sends
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
 * | Binary     | Decoded as `Float32Array` PCM samples, wrapped in an {@link AudioFrame}, emitted as `'audio'`. |
 * | Text       | `JSON.parse()`d as {@link ClientTextMessage}, emitted as `'message'`. |
 *
 * ## Outbound API
 *
 * | Method          | Behaviour                                              |
 * |-----------------|--------------------------------------------------------|
 * | `sendAudio()`   | Serialises audio to a binary `Buffer` and calls `ws.send()`. |
 * | `sendControl()` | JSON-stringifies the message and calls `ws.send()`.    |
 *
 * ## Lifecycle events (re-emitted on `this`)
 *
 * | WS event | Transport emission |
 * |----------|--------------------|
 * | `open`   | `'open'`           |
 * | `close`  | `'close'`          |
 * | `error`  | `'error'`          |
 *
 * @fires audio - `(frame: AudioFrame)` for every inbound binary message.
 * @fires message - `(msg: ClientTextMessage)` for every inbound text message.
 * @fires open - Socket transitioned to OPEN state.
 * @fires close - Socket has been fully closed.
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
export class WebSocketStreamTransport extends EventEmitter {
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    /**
     * Create a new transport wrapping an existing WebSocket connection.
     *
     * The constructor inspects `ws.readyState` to determine the initial
     * `state`: if the socket is already OPEN (readyState === 1) the state
     * is set to `'open'`; otherwise it is set to `'connecting'` and will
     * transition to `'open'` when the `'open'` event fires.
     *
     * @param ws - WebSocket connection (or compatible mock).
     * @param config - Transport-level configuration (must include sampleRate).
     */
    constructor(ws, config) {
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
    get state() {
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
    sendAudio(chunk) {
        return new Promise((resolve, reject) => {
            let binary;
            if ('audio' in chunk) {
                // EncodedAudioChunk path: the audio property is already a Buffer
                binary = chunk.audio;
            }
            else {
                // AudioFrame path: convert Float32Array samples to a raw byte Buffer.
                // We must use byteOffset and byteLength because the Float32Array may
                // be a view into a larger SharedArrayBuffer or sliced Buffer.
                const frame = chunk;
                binary = Buffer.from(frame.samples.buffer, frame.samples.byteOffset, frame.samples.byteLength);
            }
            this._ws.send(binary, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
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
    sendControl(msg) {
        return new Promise((resolve, reject) => {
            this._ws.send(JSON.stringify(msg), (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
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
    close(code, reason) {
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
    _attachWsListeners() {
        // `message` -- inbound data from the remote peer
        this._ws.on('message', (data) => {
            if (typeof data === 'string') {
                // Text frame: parse as ClientTextMessage JSON and propagate as 'control'.
                // Malformed JSON emits an error but does NOT crash the transport,
                // allowing the session to recover from a single bad message.
                try {
                    const msg = JSON.parse(data);
                    this.emit('message', msg);
                }
                catch (err) {
                    this.emit('error', new Error(`WebSocketStreamTransport: failed to parse inbound text message as JSON: ${String(err)}`));
                }
            }
            else {
                // Binary frame: interpret bytes as a Float32Array PCM sample buffer.
                // The `ws` package delivers binary as a Node.js Buffer; browser-style
                // WebSocket polyfills may deliver an ArrayBuffer instead.
                let buffer;
                if (Buffer.isBuffer(data)) {
                    buffer = data;
                }
                else {
                    // ArrayBuffer (browser-style) -- wrap in a Node.js Buffer
                    buffer = Buffer.from(data);
                }
                // Create a Float32Array view over the underlying ArrayBuffer.
                // We use byteOffset and byteLength to handle sliced Buffers correctly,
                // since Buffer.from() may return a view into Node's internal pool
                // rather than a fresh allocation.
                const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
                const frame = {
                    samples,
                    sampleRate: this._sampleRate,
                    timestamp: Date.now(),
                };
                this.emit('audio', frame);
            }
        });
        // `open` -- socket handshake complete (fires for late-open connections)
        this._ws.on('open', () => {
            this._state = 'open';
            this.emit('open');
        });
        // `close` -- socket has been fully closed (either side initiated)
        this._ws.on('close', () => {
            this._state = 'closed';
            this.emit('close');
        });
        // `error` -- transport-level socket error. Re-emitted verbatim so the
        // orchestrator can log it and decide whether to tear down the session.
        this._ws.on('error', (err) => {
            this.emit('error', err);
        });
    }
}
//# sourceMappingURL=WebSocketStreamTransport.js.map
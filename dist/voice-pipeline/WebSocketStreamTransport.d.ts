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
import type { IStreamTransport, AudioFrame, EncodedAudioChunk, TransportControlMessage, ServerTextMessage } from './types.js';
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
     * Sample rate (in Hz) used to populate `AudioFrame.sampleRate` on
     * inbound binary messages. Must match the rate the remote client is sending.
     *
     * Common values: 16000 (telephony/STT), 24000 (TTS output), 48000 (high-fidelity).
     *
     * @example 16000
     */
    sampleRate: number;
}
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
export declare class WebSocketStreamTransport extends EventEmitter implements IStreamTransport {
    /**
     * Stable UUID assigned at construction time.
     * Used as a correlation key in logs and metrics.
     */
    readonly id: string;
    /**
     * Current connection state. Updated internally by WebSocket event handlers.
     * Read externally via the `state` getter.
     */
    private _state;
    /** The underlying WebSocket connection. */
    private readonly _ws;
    /**
     * Audio sample rate propagated into every decoded `AudioFrame`.
     * Configured once at construction and never changed.
     */
    private readonly _sampleRate;
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
    constructor(ws: WebSocketLike, config: WebSocketStreamTransportConfig);
    /**
     * Current connection state of the underlying WebSocket.
     * Read-only from the outside; updated internally by WS event handlers.
     */
    get state(): 'connecting' | 'open' | 'closing' | 'closed';
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
    sendAudio(chunk: EncodedAudioChunk | AudioFrame): Promise<void>;
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
    sendControl(msg: TransportControlMessage | ServerTextMessage): Promise<void>;
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
    close(code?: number, reason?: string): void;
    /**
     * Attach listeners to the underlying WebSocket for all events relevant to
     * the voice pipeline.
     *
     * All listener state is contained here. No cleanup method is currently
     * needed because the transport's lifetime is tied to the socket's --
     * when the socket closes, the transport transitions to `'closed'` and
     * no further events are expected.
     */
    private _attachWsListeners;
}
//# sourceMappingURL=WebSocketStreamTransport.d.ts.map
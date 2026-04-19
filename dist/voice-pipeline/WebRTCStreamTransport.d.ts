/**
 * @module voice-pipeline/WebRTCStreamTransport
 *
 * A concrete {@link IStreamTransport} implementation that wraps a WebRTC
 * `RTCPeerConnection` and its DataChannels for bidirectional audio/text
 * streaming. Provides lower latency than WebSocket by using unreliable/
 * unordered DataChannels (UDP-like semantics) for audio frames and a
 * reliable/ordered channel for control messages.
 *
 * ## Channel architecture
 *
 * Two DataChannels are created on the connection:
 *
 * | Channel   | Label       | Ordered | Reliable | Purpose                          |
 * |-----------|-------------|---------|----------|----------------------------------|
 * | Audio     | `'audio'`   | No      | No       | Low-latency PCM frame transport  |
 * | Control   | `'control'` | Yes     | Yes      | JSON control messages (lossless) |
 *
 * The audio channel uses `maxRetransmits: 0` (fire-and-forget) because
 * real-time voice tolerates occasional packet loss better than added
 * latency from retransmissions. The control channel uses default TCP-like
 * reliability since protocol messages (mute/unmute/stop) must arrive.
 *
 * ## Wire protocol
 *
 * ### Audio channel (binary)
 * Each message is a raw `ArrayBuffer` containing Float32Array PCM samples.
 * The transport reconstructs the Float32Array and wraps it in an
 * {@link AudioFrame} with the configured sample rate.
 *
 * ### Control channel (text)
 * Each message is a JSON string conforming to {@link ClientTextMessage}
 * (inbound) or {@link ServerTextMessage} (outbound). Malformed JSON
 * emits an `'error'` event without crashing the transport.
 *
 * ## Native dependency
 * Node.js does not ship a built-in WebRTC stack. This transport requires
 * the `wrtc` npm package (or a compatible polyfill) as an optional peer
 * dependency. A helpful error is thrown at construction time if the
 * package is not installed.
 *
 * @see {@link IStreamTransport} for the interface contract.
 * @see {@link WebSocketStreamTransport} for the WebSocket-based sibling.
 * @see {@link VoicePipelineOrchestrator} which consumes this transport.
 */
import { EventEmitter } from 'node:events';
import type { IStreamTransport, AudioFrame, EncodedAudioChunk, TransportControlMessage, ServerTextMessage } from './types.js';
/**
 * Minimal subset of the W3C RTCDataChannel interface required by this
 * transport. Defined locally to avoid a hard compile-time dependency on
 * `wrtc` type definitions — the actual `wrtc` module is loaded at runtime
 * via dynamic import.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
 */
export interface RTCDataChannelLike {
    /** Human-readable label assigned when the channel was created. */
    readonly label: string;
    /**
     * Channel readyState following the W3C spec:
     * `'connecting'` | `'open'` | `'closing'` | `'closed'`.
     */
    readonly readyState: string;
    /**
     * Controls whether data is sent as `'arraybuffer'` or `'blob'`.
     * Must be set to `'arraybuffer'` for binary audio frames.
     */
    binaryType: string;
    /** Send a string or binary payload over the channel. */
    send(data: string | ArrayBuffer | ArrayBufferView): void;
    /** Close the DataChannel. */
    close(): void;
    onopen: ((event: Event) => void) | null;
    onclose: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
}
/**
 * Minimal subset of the W3C RTCPeerConnection interface consumed by
 * this transport. Only the DataChannel creation, ICE handling, and
 * connection-state observation surface is needed.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection
 */
export interface RTCPeerConnectionLike {
    /**
     * Aggregate connection state:
     * `'new'` | `'connecting'` | `'connected'` | `'disconnected'` | `'failed'` | `'closed'`.
     */
    readonly connectionState: string;
    /**
     * Create a new DataChannel on this connection.
     *
     * @param label - Human-readable channel label.
     * @param options - DataChannel configuration (ordered, maxRetransmits, etc.).
     * @returns The newly created DataChannel.
     */
    createDataChannel(label: string, options?: Record<string, unknown>): RTCDataChannelLike;
    /**
     * Add an ICE candidate received from the remote peer via the signaling
     * channel.
     *
     * @param candidate - The ICE candidate object or `null` to signal
     *   end-of-candidates.
     */
    addIceCandidate(candidate: unknown): Promise<void>;
    /** Close the peer connection and all associated DataChannels. */
    close(): void;
    onicecandidate: ((event: {
        candidate: unknown;
    }) => void) | null;
    onconnectionstatechange: (() => void) | null;
    ondatachannel: ((event: {
        channel: RTCDataChannelLike;
    }) => void) | null;
}
/**
 * Constructor options for {@link WebRTCStreamTransport}.
 *
 * @example
 * ```typescript
 * const config: WebRTCStreamTransportConfig = {
 *   sampleRate: 16000,
 *   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
 * };
 * ```
 */
export interface WebRTCStreamTransportConfig {
    /**
     * Sample rate (in Hz) used to populate `AudioFrame.sampleRate` on
     * inbound audio messages. Must match the rate the remote peer is sending.
     *
     * Common values: 16000 (telephony/STT), 24000 (TTS output), 48000 (high-fidelity).
     *
     * @example 16000
     */
    sampleRate: number;
    /**
     * ICE server configuration for NAT traversal. Forwarded to the
     * underlying RTCPeerConnection when one is created internally.
     *
     * If the consumer provides a pre-existing RTCPeerConnection (via
     * the constructor), this field is ignored — ICE servers are already
     * baked into the connection at creation time.
     *
     * @example [{ urls: 'stun:stun.l.google.com:19302' }]
     */
    iceServers?: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
    }>;
}
/**
 * Bidirectional voice pipeline transport backed by WebRTC DataChannels.
 *
 * Uses two DataChannels for optimal voice streaming:
 * - An **unreliable, unordered** `audio` channel for PCM frames (minimal
 *   latency, tolerates packet loss).
 * - A **reliable, ordered** `control` channel for JSON control messages
 *   (mute/unmute/stop/config).
 *
 * ## Lifecycle
 *
 * 1. Construct with an existing {@link RTCPeerConnectionLike}.
 * 2. Call `initialize` to create DataChannels and wire up handlers.
 * 3. The transport is `'open'` once both DataChannels reach `'open'` state.
 * 4. Call `close` to tear down channels and the peer connection.
 *
 * ## Events emitted
 *
 * | Event            | Payload                      | Description                           |
 * |------------------|------------------------------|---------------------------------------|
 * | `'audio_frame'`  | {@link AudioFrame}           | Inbound audio from the remote peer.   |
 * | `'control'`      | {@link ClientTextMessage}    | Inbound JSON control message.         |
 * | `'connected'`    | *(none)*                     | Both DataChannels are open.           |
 * | `'disconnected'` | *(none)*                     | Connection has been closed.           |
 * | `'error'`        | `Error`                      | Transport-level error.                |
 * | `'ice_candidate'`| ICE candidate object         | Local ICE candidate for signaling.    |
 *
 * @fires audio_frame - `(frame: AudioFrame)` for every inbound audio message.
 * @fires control - `(msg: ClientTextMessage)` for every inbound control message.
 * @fires connected - Both DataChannels have reached 'open' state.
 * @fires disconnected - Peer connection has been closed.
 * @fires error - Transport-level error occurred.
 * @fires ice_candidate - Local ICE candidate available for the signaling layer.
 *
 * @see {@link IStreamTransport} for the interface contract.
 * @see {@link WebSocketStreamTransport} for the WebSocket-based sibling.
 *
 * @example
 * ```typescript
 * import { WebRTCStreamTransport } from '@framers/agentos/voice-pipeline';
 *
 * // Receive RTCPeerConnection from your signaling server
 * const transport = new WebRTCStreamTransport(peerConnection, { sampleRate: 16000 });
 * await transport.initialize();
 *
 * transport.on('audio_frame', (frame) => sttSession.pushAudio(frame));
 * transport.on('control', (msg) => handleClientMessage(msg));
 * transport.on('ice_candidate', (candidate) => signalingChannel.send(candidate));
 * ```
 */
export declare class WebRTCStreamTransport extends EventEmitter implements IStreamTransport {
    /**
     * Stable UUID assigned at construction time.
     * Used as a correlation key in logs and metrics.
     */
    readonly id: string;
    /**
     * Current connection state. Updated internally by DataChannel event
     * handlers. Read externally via the `state` getter.
     */
    private _state;
    /** The underlying WebRTC peer connection. */
    private readonly _pc;
    /**
     * Audio sample rate propagated into every decoded {@link AudioFrame}.
     * Configured once at construction and never changed.
     */
    private readonly _sampleRate;
    /** Transport configuration (ICE servers, etc.). */
    private readonly _config;
    /**
     * Unreliable/unordered DataChannel for audio frame transport.
     * Created during `initialize`. `null` until then.
     */
    private _audioChannel;
    /**
     * Reliable/ordered DataChannel for JSON control messages.
     * Created during `initialize`. `null` until then.
     */
    private _controlChannel;
    /**
     * Create a new WebRTC transport wrapping an existing peer connection.
     *
     * The transport starts in `'connecting'` state and transitions to
     * `'open'` once both DataChannels are established and open.
     *
     * @param peerConnection - An existing RTCPeerConnection (from the `wrtc`
     *   package or a browser-compatible polyfill). The connection should be
     *   in `'new'` or `'connecting'` state — the transport will create
     *   DataChannels on it.
     * @param config - Transport-level configuration (must include sampleRate).
     *
     * @throws {Error} If `peerConnection` is null/undefined.
     *
     * @example
     * ```typescript
     * const pc = new RTCPeerConnection({ iceServers: [...] });
     * const transport = new WebRTCStreamTransport(pc, { sampleRate: 16000 });
     * ```
     */
    constructor(peerConnection: RTCPeerConnectionLike, config: WebRTCStreamTransportConfig);
    /**
     * Current connection state of the WebRTC transport.
     *
     * The transport is `'open'` only when both DataChannels (audio + control)
     * have reached their `'open'` readyState. Any earlier state maps to
     * `'connecting'`, and any teardown maps to `'closing'` or `'closed'`.
     */
    get state(): 'connecting' | 'open' | 'closing' | 'closed';
    /**
     * Create DataChannels and wire up all event handlers.
     *
     * This must be called after construction and before any send operations.
     * It creates the `audio` (unreliable) and `control` (reliable)
     * DataChannels on the peer connection and sets up message handlers.
     *
     * The transport transitions to `'open'` once both channels report
     * readyState `'open'`.
     *
     * @returns Resolves when DataChannels are created (not necessarily open yet).
     *
     * @example
     * ```typescript
     * const transport = new WebRTCStreamTransport(pc, { sampleRate: 16000 });
     * await transport.initialize();
     * // transport.state may still be 'connecting' until ICE completes
     * ```
     */
    initialize(): Promise<void>;
    /**
     * Send a synthesised audio chunk to the remote peer for playback.
     *
     * If the payload is an {@link EncodedAudioChunk} (has an `audio` Buffer
     * property), that buffer's underlying ArrayBuffer is sent. If it is an
     * {@link AudioFrame} (has a `samples` Float32Array), the samples'
     * underlying ArrayBuffer is sent.
     *
     * @param chunk - Encoded audio chunk or raw PCM frame to deliver.
     * @returns Resolves once the data has been handed to the DataChannel.
     *
     * @throws {Error} If the audio channel is not open or not initialized.
     *
     * @example
     * ```typescript
     * await transport.sendAudio({
     *   audio: Buffer.from(opusBytes),
     *   format: 'opus',
     *   sampleRate: 24000,
     *   durationMs: 20,
     *   text: 'Hello!',
     * });
     * ```
     */
    sendAudio(chunk: EncodedAudioChunk | AudioFrame): Promise<void>;
    /**
     * Send a JSON control message to the remote peer.
     *
     * The message is JSON-stringified before transmission on the reliable
     * control channel. Both {@link TransportControlMessage} and
     * {@link ServerTextMessage} are accepted since they share the same
     * serialisation path.
     *
     * @param msg - Server-side protocol message.
     * @returns Resolves once the message has been handed to the DataChannel.
     *
     * @throws {Error} If the control channel is not open or not initialized.
     *
     * @example
     * ```typescript
     * await transport.sendControl({ type: 'mute' });
     * ```
     */
    sendControl(msg: TransportControlMessage | ServerTextMessage): Promise<void>;
    /**
     * Initiate a graceful close of the transport.
     *
     * Closes both DataChannels and the underlying peer connection.
     * The `'disconnected'` event fires once the connection has fully closed.
     *
     * @param _code - Ignored for WebRTC (included for IStreamTransport compat).
     * @param _reason - Ignored for WebRTC (included for IStreamTransport compat).
     */
    close(_code?: number, _reason?: string): void;
    /**
     * Add a remote ICE candidate received through the signaling channel.
     *
     * WebRTC requires ICE candidate exchange for NAT traversal. The signaling
     * server should forward remote candidates to this method.
     *
     * @param candidate - The ICE candidate object from the remote peer, or
     *   `null` to signal end-of-candidates.
     * @returns Resolves when the candidate has been added to the connection.
     *
     * @throws {Error} If the candidate is invalid or the connection is closed.
     *
     * @example
     * ```typescript
     * signalingChannel.on('ice_candidate', async (candidate) => {
     *   await transport.addIceCandidate(candidate);
     * });
     * ```
     */
    addIceCandidate(candidate: unknown): Promise<void>;
    /**
     * Attach message and lifecycle handlers to the audio DataChannel.
     *
     * Inbound binary messages are decoded as Float32Array PCM samples and
     * emitted as `'audio_frame'` events. This channel uses arraybuffer
     * binary type for efficient binary transfer.
     *
     * @param channel - The audio DataChannel to attach handlers to.
     */
    private _attachAudioChannelHandlers;
    /**
     * Attach message and lifecycle handlers to the control DataChannel.
     *
     * Inbound text messages are JSON-parsed as {@link ClientTextMessage}
     * and emitted as `'control'` events. Malformed JSON triggers an
     * `'error'` event without crashing the transport.
     *
     * @param channel - The control DataChannel to attach handlers to.
     */
    private _attachControlChannelHandlers;
    /**
     * Attach handlers to the peer connection for ICE candidate exchange
     * and connection state monitoring.
     *
     * ICE candidates are re-emitted as `'ice_candidate'` events so the
     * consumer can relay them to the remote peer via a signaling channel.
     * Connection state changes are mapped to transport state transitions.
     */
    private _attachPeerConnectionHandlers;
    /**
     * Check if both DataChannels are in the `'open'` readyState.
     *
     * Called from each channel's `onopen` handler. Only transitions the
     * transport to `'open'` state once BOTH channels are ready, since
     * sending on a non-open channel would throw.
     */
    private _checkBothChannelsOpen;
}
/**
 * Create a WebRTC transport with a fresh RTCPeerConnection from the `wrtc`
 * package. This is a convenience factory for server-side usage where a
 * pre-existing connection is not available.
 *
 * The `wrtc` package is loaded via dynamic import to keep it as an
 * optional peer dependency. If the package is not installed, a descriptive
 * error is thrown.
 *
 * @param config - Transport configuration including sample rate and ICE servers.
 * @returns A new {@link WebRTCStreamTransport} wrapping a fresh peer connection.
 *
 * @throws {Error} If the `wrtc` package is not installed or importable.
 *
 * @example
 * ```typescript
 * const transport = await createWebRTCTransport({
 *   sampleRate: 16000,
 *   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
 * });
 * await transport.initialize();
 * ```
 */
export declare function createWebRTCTransport(config: WebRTCStreamTransportConfig): Promise<WebRTCStreamTransport>;
//# sourceMappingURL=WebRTCStreamTransport.d.ts.map
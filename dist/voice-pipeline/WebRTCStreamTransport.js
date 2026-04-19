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
import { randomUUID } from 'node:crypto';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
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
export class WebRTCStreamTransport extends EventEmitter {
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
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
    constructor(peerConnection, config) {
        super();
        /**
         * Unreliable/unordered DataChannel for audio frame transport.
         * Created during `initialize`. `null` until then.
         */
        this._audioChannel = null;
        /**
         * Reliable/ordered DataChannel for JSON control messages.
         * Created during `initialize`. `null` until then.
         */
        this._controlChannel = null;
        if (!peerConnection) {
            throw new Error('WebRTCStreamTransport: peerConnection is required. ' +
                'Pass an RTCPeerConnection instance from the `wrtc` package or a compatible polyfill.');
        }
        this._pc = peerConnection;
        this._sampleRate = config.sampleRate;
        this._config = config;
        this.id = randomUUID();
        // Always start as connecting — we need both DataChannels to be open
        // before the transport is usable.
        this._state = 'connecting';
    }
    // -------------------------------------------------------------------------
    // IStreamTransport -- public surface
    // -------------------------------------------------------------------------
    /**
     * Current connection state of the WebRTC transport.
     *
     * The transport is `'open'` only when both DataChannels (audio + control)
     * have reached their `'open'` readyState. Any earlier state maps to
     * `'connecting'`, and any teardown maps to `'closing'` or `'closed'`.
     */
    get state() {
        return this._state;
    }
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
    async initialize() {
        // Create the unreliable audio channel — unordered + no retransmits
        // gives UDP-like semantics ideal for real-time audio where latency
        // matters more than guaranteed delivery.
        this._audioChannel = this._pc.createDataChannel('audio', {
            ordered: false,
            maxRetransmits: 0,
        });
        this._audioChannel.binaryType = 'arraybuffer';
        // Create the reliable control channel — ordered + reliable (defaults)
        // ensures JSON protocol messages arrive in sequence and without loss.
        this._controlChannel = this._pc.createDataChannel('control', {
            ordered: true,
        });
        this._attachAudioChannelHandlers(this._audioChannel);
        this._attachControlChannelHandlers(this._controlChannel);
        this._attachPeerConnectionHandlers();
    }
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
    sendAudio(chunk) {
        return new Promise((resolve, reject) => {
            if (!this._audioChannel) {
                reject(new Error('WebRTCStreamTransport: audio channel not initialized. Call initialize() first.'));
                return;
            }
            if (this._audioChannel.readyState !== 'open') {
                reject(new Error(`WebRTCStreamTransport: audio channel is "${this._audioChannel.readyState}", not "open".`));
                return;
            }
            try {
                let arrayBuffer;
                if ('audio' in chunk) {
                    // EncodedAudioChunk path: extract the ArrayBuffer from the Buffer.
                    // Buffer.buffer may be a shared pool allocation, so we slice to get
                    // only the relevant portion.
                    const buf = chunk.audio;
                    arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                }
                else {
                    // AudioFrame path: send the Float32Array's backing ArrayBuffer.
                    // Same slicing concern as above — the Float32Array may be a view
                    // into a larger buffer.
                    const frame = chunk;
                    arrayBuffer = frame.samples.buffer.slice(frame.samples.byteOffset, frame.samples.byteOffset + frame.samples.byteLength);
                }
                this._audioChannel.send(arrayBuffer);
                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    }
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
    sendControl(msg) {
        return new Promise((resolve, reject) => {
            if (!this._controlChannel) {
                reject(new Error('WebRTCStreamTransport: control channel not initialized. Call initialize() first.'));
                return;
            }
            if (this._controlChannel.readyState !== 'open') {
                reject(new Error(`WebRTCStreamTransport: control channel is "${this._controlChannel.readyState}", not "open".`));
                return;
            }
            try {
                this._controlChannel.send(JSON.stringify(msg));
                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    }
    /**
     * Initiate a graceful close of the transport.
     *
     * Closes both DataChannels and the underlying peer connection.
     * The `'disconnected'` event fires once the connection has fully closed.
     *
     * @param _code - Ignored for WebRTC (included for IStreamTransport compat).
     * @param _reason - Ignored for WebRTC (included for IStreamTransport compat).
     */
    close(_code, _reason) {
        this._state = 'closing';
        // Close DataChannels first — this triggers their onclose handlers
        // which will check whether the transport should transition to 'closed'.
        if (this._audioChannel && this._audioChannel.readyState !== 'closed') {
            this._audioChannel.close();
        }
        if (this._controlChannel && this._controlChannel.readyState !== 'closed') {
            this._controlChannel.close();
        }
        // Close the peer connection, which releases all network resources.
        if (this._pc.connectionState !== 'closed') {
            this._pc.close();
        }
        this._state = 'closed';
        this.emit('disconnected');
    }
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
    async addIceCandidate(candidate) {
        await this._pc.addIceCandidate(candidate);
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Attach message and lifecycle handlers to the audio DataChannel.
     *
     * Inbound binary messages are decoded as Float32Array PCM samples and
     * emitted as `'audio_frame'` events. This channel uses arraybuffer
     * binary type for efficient binary transfer.
     *
     * @param channel - The audio DataChannel to attach handlers to.
     */
    _attachAudioChannelHandlers(channel) {
        channel.onmessage = (event) => {
            try {
                // DataChannel messages arrive as ArrayBuffer when binaryType is set.
                // Guard against unexpected string messages on the audio channel.
                const raw = event.data;
                if (!(raw instanceof ArrayBuffer)) {
                    this.emit('error', new Error('WebRTCStreamTransport: received non-binary message on audio channel'));
                    return;
                }
                // Create a Float32Array view over the received ArrayBuffer.
                // Each float is 4 bytes, so byteLength / 4 gives the sample count.
                const samples = new Float32Array(raw);
                const frame = {
                    samples,
                    sampleRate: this._sampleRate,
                    timestamp: Date.now(),
                };
                this.emit('audio_frame', frame);
            }
            catch (err) {
                this.emit('error', new Error(`WebRTCStreamTransport: error processing audio message: ${String(err)}`));
            }
        };
        channel.onopen = () => {
            // Check if both channels are now open to transition the transport
            this._checkBothChannelsOpen();
        };
        channel.onclose = () => {
            // If the audio channel closes unexpectedly, surface the disconnection
            if (this._state === 'open') {
                this._state = 'closed';
                this.emit('disconnected');
            }
        };
        channel.onerror = (event) => {
            this.emit('error', new Error(`WebRTCStreamTransport: audio channel error: ${String(event)}`));
        };
    }
    /**
     * Attach message and lifecycle handlers to the control DataChannel.
     *
     * Inbound text messages are JSON-parsed as {@link ClientTextMessage}
     * and emitted as `'control'` events. Malformed JSON triggers an
     * `'error'` event without crashing the transport.
     *
     * @param channel - The control DataChannel to attach handlers to.
     */
    _attachControlChannelHandlers(channel) {
        channel.onmessage = (event) => {
            try {
                const text = typeof event.data === 'string' ? event.data : String(event.data);
                const msg = JSON.parse(text);
                this.emit('control', msg);
            }
            catch (err) {
                // Malformed JSON should not crash the transport — emit an error
                // and let the session continue processing valid messages.
                this.emit('error', new Error(`WebRTCStreamTransport: failed to parse control message as JSON: ${String(err)}`));
            }
        };
        channel.onopen = () => {
            // Check if both channels are now open to transition the transport
            this._checkBothChannelsOpen();
        };
        channel.onclose = () => {
            // If the control channel closes unexpectedly, surface the disconnection
            if (this._state === 'open') {
                this._state = 'closed';
                this.emit('disconnected');
            }
        };
        channel.onerror = (event) => {
            this.emit('error', new Error(`WebRTCStreamTransport: control channel error: ${String(event)}`));
        };
    }
    /**
     * Attach handlers to the peer connection for ICE candidate exchange
     * and connection state monitoring.
     *
     * ICE candidates are re-emitted as `'ice_candidate'` events so the
     * consumer can relay them to the remote peer via a signaling channel.
     * Connection state changes are mapped to transport state transitions.
     */
    _attachPeerConnectionHandlers() {
        // Forward local ICE candidates to the consumer for signaling.
        // Without this, NAT traversal cannot complete because the remote
        // peer won't know how to reach us.
        this._pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.emit('ice_candidate', event.candidate);
            }
        };
        // Map peer connection state changes to transport lifecycle events.
        // The connectionState property aggregates ICE + DTLS state into a
        // single human-readable enum.
        this._pc.onconnectionstatechange = () => {
            const pcState = this._pc.connectionState;
            switch (pcState) {
                case 'connected':
                    // Peer connection is fully established. DataChannel open events
                    // may fire before or after this — _checkBothChannelsOpen handles
                    // the actual 'open' transition.
                    break;
                case 'disconnected':
                    // Transient network disruption — ICE may recover automatically.
                    // We don't transition to 'closed' yet, but surface the event.
                    if (this._state === 'open') {
                        this.emit('error', new Error('WebRTCStreamTransport: peer connection disconnected (may recover)'));
                    }
                    break;
                case 'failed':
                    // ICE/DTLS negotiation failed permanently. Tear down the transport.
                    this._state = 'closed';
                    this.emit('error', new Error('WebRTCStreamTransport: peer connection failed'));
                    this.emit('disconnected');
                    break;
                case 'closed':
                    // Connection was closed (by us or the remote peer).
                    if (this._state !== 'closed') {
                        this._state = 'closed';
                        this.emit('disconnected');
                    }
                    break;
                default:
                    // 'new' | 'connecting' — no action needed
                    break;
            }
        };
        // Handle DataChannels created by the remote peer (e.g. if the remote
        // side creates channels instead of us). This supports both offerer
        // and answerer roles.
        this._pc.ondatachannel = (event) => {
            const channel = event.channel;
            if (channel.label === 'audio') {
                channel.binaryType = 'arraybuffer';
                this._audioChannel = channel;
                this._attachAudioChannelHandlers(channel);
            }
            else if (channel.label === 'control') {
                this._controlChannel = channel;
                this._attachControlChannelHandlers(channel);
            }
        };
    }
    /**
     * Check if both DataChannels are in the `'open'` readyState.
     *
     * Called from each channel's `onopen` handler. Only transitions the
     * transport to `'open'` state once BOTH channels are ready, since
     * sending on a non-open channel would throw.
     */
    _checkBothChannelsOpen() {
        const audioOpen = this._audioChannel?.readyState === 'open';
        const controlOpen = this._controlChannel?.readyState === 'open';
        if (audioOpen && controlOpen && this._state === 'connecting') {
            this._state = 'open';
            this.emit('connected');
        }
    }
}
// ---------------------------------------------------------------------------
// Factory helper for creating a transport with a new RTCPeerConnection
// ---------------------------------------------------------------------------
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
export async function createWebRTCTransport(config) {
    // Dynamic import so that `wrtc` is only loaded when actually needed.
    // This keeps the package as an optional peer dependency — users who
    // only use WebSocket transport never need to install the heavy native
    // addon.
    let RTCPeerConnection;
    try {
        // @ts-ignore — optional peer dependency; only needed for server-side WebRTC
        const wrtcModule = await import('wrtc');
        RTCPeerConnection =
            wrtcModule.RTCPeerConnection ?? wrtcModule.default?.RTCPeerConnection;
    }
    catch {
        throw new Error('WebRTCStreamTransport requires the `wrtc` package for server-side WebRTC. ' +
            'Install it with: npm install wrtc\n\n' +
            'Note: `wrtc` is a native addon and may require build tools (Python, C++ compiler). ' +
            'See https://github.com/nicktomlin/wrtc for platform-specific instructions.');
    }
    if (!RTCPeerConnection) {
        throw new Error('WebRTCStreamTransport: `wrtc` package was imported but RTCPeerConnection was not found. ' +
            'Ensure you have a compatible version of the `wrtc` package installed.');
    }
    const pc = new RTCPeerConnection({
        iceServers: config.iceServers ?? [
            // Default to Google's public STUN server for basic NAT traversal.
            // Production deployments should provide their own TURN servers for
            // symmetric NAT scenarios.
            { urls: 'stun:stun.l.google.com:19302' },
        ],
    });
    return new WebRTCStreamTransport(pc, config);
}
//# sourceMappingURL=WebRTCStreamTransport.js.map
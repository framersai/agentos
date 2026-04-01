/**
 * @fileoverview TelephonyStreamTransport -- bridges a telephony WebSocket media
 * stream to the AgentOS streaming voice pipeline.
 *
 * ## Audio conversion chain
 *
 * ### Inbound path (phone -> pipeline)
 *
 * ```
 * Provider WS frame
 *   │ (JSON string or raw binary)
 *   ▼
 * MediaStreamParser.parseIncoming()
 *   │ (normalised MediaStreamIncoming)
 *   ▼
 * mu-law 8 kHz bytes
 *   │ convertMulawToPcm16()  -- ITU G.711 mu-law expansion table
 *   ▼
 * Int16 PCM 8 kHz (2 bytes/sample)
 *   │ resample(8000 -> outputSampleRate)  -- linear interpolation
 *   ▼
 * Int16 PCM at outputSampleRate (default 16 kHz)
 *   │ sample / 32768  -- normalise to IEEE 754 float range
 *   ▼
 * Float32 [-1, 1] at outputSampleRate
 *   │ emit('audio', `AudioFrame`)
 *   ▼
 * Voice pipeline (VAD / STT)
 * ```
 *
 * ### Outbound path (pipeline -> phone)
 *
 * ```
 * `EncodedAudioChunk` (PCM Int16 at chunk.sampleRate)
 *   │ resample(chunk.sampleRate -> 8 kHz)  -- linear interpolation
 *   ▼
 * Int16 PCM 8 kHz
 *   │ convertPcmToMulaw8k()  -- ITU G.711 mu-law compression
 *   ▼
 * mu-law 8 kHz bytes
 *   │ MediaStreamParser.formatOutgoing()
 *   ▼
 * Provider WS frame  -- sent to caller
 * ```
 *
 * ## Why 8 kHz <-> 16 kHz resampling?
 *
 * The PSTN (Public Switched Telephone Network) uses 8 kHz sampling (G.711).
 * Most modern STT engines (OpenAI Whisper, Deepgram, etc.) expect 16 kHz
 * or higher. The transport bridges this gap with simple linear interpolation,
 * which is adequate for narrow-band voice telephony.
 *
 * ## State machine
 *
 * ```
 * connecting ──[start msg]──> open ──[stop msg / ws.close()]──> closed
 *      │                        │
 *      └──[ws.close()]──> closed  └──[close()]──> closing ──[ws 'close']──> closed
 * ```
 *
 * @module @framers/agentos/voice/TelephonyStreamTransport
 */
import { EventEmitter } from 'node:events';
import type { MediaStreamParser } from './MediaStreamParser.js';
import type { EncodedAudioChunk, IStreamTransport, ServerTextMessage } from '../../voice-pipeline/types.js';
/**
 * Optional construction-time configuration for {@link TelephonyStreamTransport}.
 */
export interface TelephonyStreamTransportConfig {
    /**
     * Sample rate the pipeline expects for inbound `AudioFrame` events.
     * Incoming 8 kHz telephony audio is upsampled to this rate.
     * @defaultValue 16000
     */
    outputSampleRate?: number;
}
/**
 * Adapts a telephony provider WebSocket media stream to the
 * `IStreamTransport` interface consumed by the AgentOS voice pipeline.
 *
 * ## Inbound path (phone -> pipeline)
 * 1. Provider WebSocket frames arrive as raw `Buffer` or JSON `string`.
 * 2. {@link MediaStreamParser.parseIncoming} normalises them to
 *    {@link MediaStreamIncoming} events.
 * 3. `'audio'` events: mu-law 8 kHz -> Int16 PCM -> resample -> Float32 -> `'audio'` emit.
 * 4. `'dtmf'` / `'mark'` events are re-emitted as-is for higher-layer handling.
 * 5. `'start'` transitions the transport to `'open'` and sends the optional
 *    connection acknowledgment from the parser.
 * 6. `'stop'` or WebSocket close transitions to `'closed'` and emits `'close'`.
 *
 * ## Outbound path (pipeline -> phone)
 * 1. `sendAudio()` receives an `EncodedAudioChunk` (PCM Int16 format assumed).
 * 2. Chunk is resampled from `chunk.sampleRate` -> 8 kHz via linear interpolation.
 * 3. Resampled PCM is mu-law encoded via {@link convertPcmToMulaw8k}.
 * 4. {@link MediaStreamParser.formatOutgoing} wraps the bytes for the provider.
 * 5. The formatted payload is sent over the WebSocket.
 *
 * ## Events emitted
 * - `'audio'` (`AudioFrame`) -- inbound decoded audio for STT / VAD.
 * - `'dtmf'` (`{ digit: string; durationMs?: number }`) -- caller key-press.
 * - `'mark'` (`{ name: string }`) -- named stream marker.
 * - `'close'` () -- transport has been fully closed.
 * - `'error'` (Error) -- unrecoverable WebSocket or parsing error.
 *
 * @example
 * ```typescript
 * const parser = new TwilioMediaStreamParser();
 * const transport = new TelephonyStreamTransport(ws, parser, { outputSampleRate: 16000 });
 *
 * transport.on('audio', (frame: AudioFrame) => {
 *   // Feed to STT engine
 *   sttEngine.pushAudio(frame.samples, frame.sampleRate);
 * });
 *
 * transport.on('dtmf', ({ digit }) => {
 *   console.log(`Caller pressed: ${digit}`);
 * });
 * ```
 */
export declare class TelephonyStreamTransport extends EventEmitter implements IStreamTransport {
    private readonly ws;
    private readonly parser;
    /** Stable UUID for this transport connection. */
    readonly id: string;
    /** Internal state -- not directly assignable from outside. */
    private _state;
    /**
     * Current connection lifecycle state.
     *
     * - `connecting` -- WebSocket is open but the provider's `start` event has not arrived yet.
     * - `open`       -- Stream is active; audio can be sent and received.
     * - `closing`    -- {@link close} was called; waiting for WS to finish closing.
     * - `closed`     -- Stream is fully terminated; no further I/O.
     */
    get state(): 'connecting' | 'open' | 'closing' | 'closed';
    /** Provider-assigned stream identifier; populated on the 'start' event. */
    private streamSid;
    /** Target sample rate for emitted AudioFrames (pipeline input requirement). */
    private readonly outputSampleRate;
    /**
     * Create a new telephony stream transport.
     *
     * Wires up WebSocket event handlers immediately. The transport starts in
     * `'connecting'` state and transitions to `'open'` when the provider sends
     * its `start` event through the media stream.
     *
     * @param ws - WebSocket-like object (must emit `'message'`, `'close'`, `'error'`
     *   and expose `send(data)` and `close(code?, reason?)` methods).
     * @param parser - Provider-specific message parser/formatter.
     * @param config - Optional configuration overrides.
     */
    constructor(ws: any, // WebSocket-like; typed `any` to avoid hard dep on ws package
    parser: MediaStreamParser, config?: TelephonyStreamTransportConfig);
    /**
     * Send synthesised audio to the caller.
     *
     * Assumes `chunk.format === 'pcm'` and that `chunk.audio` contains raw
     * signed 16-bit little-endian PCM samples at `chunk.sampleRate`. The audio
     * is resampled to 8 kHz, mu-law encoded, and forwarded via the parser.
     *
     * No-op if the transport is not in the `'open'` state (e.g., before the
     * provider's `start` event or after the stream has closed).
     *
     * @param chunk - Encoded audio chunk from the TTS pipeline.
     */
    sendAudio(chunk: EncodedAudioChunk): Promise<void>;
    /**
     * Send a JSON control message over the WebSocket.
     *
     * No-op if the transport is not in the `'open'` state.
     *
     * @param message - Server-to-client pipeline protocol message.
     */
    sendControl(message: ServerTextMessage): Promise<void>;
    /**
     * Initiate graceful closure of the transport.
     *
     * Sets state to `'closing'` and delegates to the underlying WebSocket's
     * `close()` method. The actual transition to `'closed'` happens when the
     * WebSocket's `'close'` event fires.
     *
     * @param code - Optional WebSocket close code (default 1000).
     * @param reason - Optional human-readable close reason.
     */
    close(code?: number, reason?: string): void;
    /**
     * Linear interpolation resampler for 16-bit signed PCM.
     *
     * Not studio-quality but sufficient for narrow-band voice telephony where
     * the source material is already limited to ~3.4 kHz bandwidth by the PSTN.
     * A higher-quality sinc interpolator would add latency and complexity with
     * negligible perceptual improvement at telephone bandwidths.
     *
     * The output length is computed as `round(input.length * toRate / fromRate)`
     * to avoid cumulative rounding drift across many small frames.
     *
     * @param input - Source samples as a signed 16-bit integer array.
     * @param fromRate - Sample rate of the input, in Hz.
     * @param toRate - Desired sample rate of the output, in Hz.
     * @returns A new Int16Array at `toRate`.
     */
    private resample;
}
//# sourceMappingURL=TelephonyStreamTransport.d.ts.map
/**
 * @fileoverview Plivo Audio Stream WebSocket parser.
 *
 * ## Plivo Audio Stream protocol
 *
 * Plivo's bidirectional Audio Stream (triggered by the `<Stream>` XML element)
 * sends JSON-encoded messages over WebSocket for stream lifecycle and audio data.
 *
 * ### Inbound message shapes
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ event: "start"                                                     │
 * │ stream_id: "s-xxx"                                                 │
 * │ call_uuid: "u-xxx"                                                 │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ event: "media"                                                     │
 * │ stream_id: "s-xxx"                                                 │
 * │ media: { payload: "<base64 mu-law audio>" }                        │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ event: "stop"                                                      │
 * │ stream_id: "s-xxx"                                                 │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ### Outbound `playAudio` format
 *
 * To send audio back to the caller, the server sends a JSON `playAudio` event:
 * ```json
 * { "event": "playAudio", "media": { "payload": "<base64 mu-law audio>" } }
 * ```
 *
 * Note: unlike Twilio, Plivo's outbound format does NOT include a `streamSid`
 * or `stream_id` field -- the audio is implicitly routed to the caller on the
 * same WebSocket connection.
 *
 * ### Differences from Twilio and Telnyx
 *
 * - **No DTMF over media stream**: Plivo delivers DTMF via `<GetDigits>`
 *   XML callback webhooks (as a `Digits` POST parameter), not over the
 *   WebSocket stream.
 * - **No outbound track filtering**: Plivo does not echo outbound audio back
 *   on the stream, so no `track` field filtering is needed.
 * - **No connection acknowledgment**: Plivo does not require a `connected`
 *   handshake message after the WebSocket opens.
 * - **Uses `call_uuid`**: Plivo's call identifier field is `call_uuid`
 *   (vs. Twilio's `callSid` and Telnyx's `call_control_id`).
 *
 * @see {@link https://www.plivo.com/docs/voice/xml/stream}
 * @module @framers/agentos/voice/parsers/PlivoMediaStreamParser
 */
import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';
/**
 * Parses the Plivo Audio Stream WebSocket protocol.
 *
 * Plivo sends JSON-encoded messages for stream lifecycle events (`start`,
 * `stop`) and audio chunks (`media`). The audio payload is base64-encoded
 * mu-law PCM, delivered in a `payload` field inside the `media` object.
 *
 * Outgoing audio is wrapped in a `playAudio` JSON envelope, which is the
 * format Plivo expects when the server streams audio back to the caller.
 * No explicit connection acknowledgment is required after the handshake.
 *
 * @see {@link https://www.plivo.com/docs/voice/xml/stream}
 */
export declare class PlivoMediaStreamParser implements MediaStreamParser {
    /**
     * Parse a raw WebSocket frame from Plivo's audio stream.
     *
     * Supported Plivo event types:
     * - `start` -- stream established; `stream_id` maps to `streamSid`,
     *   `call_uuid` maps to `callSid`.
     * - `media` -- audio chunk; `media.payload` contains base64-encoded mu-law
     *   PCM bytes.
     * - `stop`  -- stream ended (call terminated or stream explicitly closed).
     *
     * Any other event type is silently dropped by returning `null`. Malformed
     * JSON or messages missing required fields (`event`, `stream_id`) also
     * return `null`.
     *
     * @param data - Raw WebSocket frame payload (JSON string or Buffer from Plivo).
     * @returns Normalised {@link MediaStreamIncoming} event, or `null` for
     *   unknown event types or malformed messages.
     */
    parseIncoming(data: Buffer | string): MediaStreamIncoming | null;
    /**
     * Encode mu-law audio for transmission back to Plivo.
     *
     * Plivo requires audio to be base64-encoded and wrapped in a `playAudio`
     * JSON envelope. Unlike Twilio, the `streamSid` / `stream_id` is NOT
     * included in the outbound message -- Plivo implicitly routes the audio
     * to the caller on the same WebSocket connection.
     *
     * @param audio - Raw mu-law PCM bytes to send to the caller.
     * @param _streamSid - Unused by Plivo's `playAudio` format (accepted for
     *   interface parity with other parsers).
     * @returns JSON string: `{ event: 'playAudio', media: { payload: '<base64>' } }`
     */
    formatOutgoing(audio: Buffer, _streamSid: string): string;
}
//# sourceMappingURL=PlivoMediaStreamParser.d.ts.map
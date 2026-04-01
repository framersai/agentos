/**
 * @fileoverview Twilio `<Connect><Stream>` WebSocket media stream parser.
 *
 * ## Twilio media stream protocol
 *
 * When a Twilio call executes the TwiML `<Connect><Stream url="wss://..." />`,
 * Twilio opens a WebSocket to the specified URL and sends **all messages as
 * JSON-encoded strings** (never raw binary). Each message has an `event` field
 * and a `streamSid` field that together identify the event type and stream.
 *
 * ### Inbound JSON message shapes
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ event: "start"                                                     │
 * │ streamSid: "MZxxx"                                                 │
 * │ start: { callSid, accountSid, mediaFormat: { encoding, ... } }     │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ event: "media"                                                     │
 * │ streamSid: "MZxxx"                                                 │
 * │ media: { track: "inbound"|"outbound", payload: "<base64>" }        │
 * │ sequenceNumber: 42                                                 │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ event: "dtmf"                                                      │
 * │ streamSid: "MZxxx"                                                 │
 * │ dtmf: { digit: "5", duration: 500 }                                │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ event: "mark"                                                      │
 * │ streamSid: "MZxxx"                                                 │
 * │ mark: { name: "utterance-done" }                                   │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ event: "stop"                                                      │
 * │ streamSid: "MZxxx"                                                 │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ### Outbound audio format
 *
 * Audio sent back to Twilio must be wrapped in a JSON `media` envelope:
 * ```json
 * { "event": "media", "streamSid": "MZxxx", "media": { "payload": "<base64>" } }
 * ```
 *
 * ### Connection acknowledgment
 *
 * Immediately after the WebSocket handshake, the server must send:
 * ```json
 * { "event": "connected", "protocol": "Call", "version": "1.0.0" }
 * ```
 * This tells Twilio the listener is ready to receive media.
 *
 * @see {@link https://www.twilio.com/docs/voice/twiml/stream}
 * @module @framers/agentos/voice/parsers/TwilioMediaStreamParser
 */
import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';
/**
 * Parses the Twilio `<Connect><Stream>` WebSocket media stream protocol.
 *
 * Twilio sends all messages as JSON-encoded strings. Outbound audio is
 * wrapped in the same JSON envelope so Twilio can associate it with the
 * correct stream. An explicit `connected` acknowledgment is sent once
 * immediately after the WebSocket handshake to signal that the listener is
 * ready to receive media.
 *
 * @see {@link https://www.twilio.com/docs/voice/twiml/stream}
 */
export declare class TwilioMediaStreamParser implements MediaStreamParser {
    /**
     * Parse a raw WebSocket frame from Twilio's media stream.
     *
     * Supported Twilio event types:
     * - `start`  -- stream established, includes callSid and media format metadata.
     * - `media`  -- audio chunk (inbound track only; outbound echoes are discarded
     *   to prevent feedback loops).
     * - `dtmf`   -- DTMF keypress detected on the audio stream.
     * - `stop`   -- stream ended (call hangup or stream disconnect).
     * - `mark`   -- named synchronisation marker confirming playback reached a point.
     *
     * Messages with missing `event` or `streamSid` fields, malformed JSON,
     * or unrecognised event types are silently dropped (return `null`).
     *
     * @param data - Raw WebSocket frame payload (always a JSON string from Twilio).
     * @returns Normalised {@link MediaStreamIncoming} event, or `null` for
     *   outbound audio tracks, unknown event types, or malformed messages.
     */
    parseIncoming(data: Buffer | string): MediaStreamIncoming | null;
    /**
     * Encode mu-law audio for transmission back to the Twilio stream.
     *
     * Twilio requires base64-encoded audio wrapped in a JSON `media` envelope
     * so it can route the audio to the correct stream by `streamSid`.
     *
     * @param audio - Raw mu-law PCM bytes to send to the caller.
     * @param streamSid - The stream identifier to include in the envelope.
     * @returns JSON string conforming to the Twilio media-out envelope format:
     *   `{ event: 'media', streamSid: '...', media: { payload: '<base64>' } }`
     */
    formatOutgoing(audio: Buffer, streamSid: string): string;
    /**
     * Generate the initial `connected` acknowledgment expected by Twilio
     * immediately after the WebSocket connection is established.
     *
     * Without this message, Twilio waits indefinitely for a response and
     * eventually times out the stream connection.
     *
     * @param _streamSid - Unused -- Twilio does not require the stream ID in the
     *   `connected` message, but the parameter is accepted for interface parity.
     * @returns JSON string: `{ event: 'connected', protocol: 'Call', version: '1.0.0' }`
     */
    formatConnected(_streamSid: string): string;
}
//# sourceMappingURL=TwilioMediaStreamParser.d.ts.map
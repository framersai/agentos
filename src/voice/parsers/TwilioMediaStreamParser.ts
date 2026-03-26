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
export class TwilioMediaStreamParser implements MediaStreamParser {
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
  parseIncoming(data: Buffer | string): MediaStreamIncoming | null {
    const raw = typeof data === 'string' ? data : data.toString('utf8');

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }

    const event = msg['event'] as string | undefined;
    const streamSid = msg['streamSid'] as string | undefined;

    // Both fields are required on every Twilio media stream message.
    if (!event || !streamSid) {
      return null;
    }

    switch (event) {
      case 'start': {
        const startPayload = msg['start'] as Record<string, unknown> | undefined;
        // callSid identifies the Twilio call leg this stream belongs to.
        const callSid = (startPayload?.['callSid'] as string | undefined) ?? '';
        const result: MediaStreamIncoming = {
          type: 'start',
          streamSid,
          callSid,
          metadata: startPayload as Record<string, unknown> | undefined,
        };
        return result;
      }

      case 'media': {
        const media = msg['media'] as Record<string, unknown> | undefined;
        if (!media) return null;

        // Twilio sends both inbound and outbound audio on the same stream.
        // Outbound echoes must be discarded to prevent feedback loops where
        // the agent hears its own TTS output.
        const track = media['track'] as string | undefined;
        if (track === 'outbound') return null;

        const payloadB64 = media['payload'] as string | undefined;
        if (!payloadB64) return null;

        const sequenceNumber = typeof msg['sequenceNumber'] === 'number'
          ? (msg['sequenceNumber'] as number)
          : undefined;

        const result: MediaStreamIncoming = {
          type: 'audio',
          payload: Buffer.from(payloadB64, 'base64'),
          streamSid,
          ...(sequenceNumber !== undefined ? { sequenceNumber } : {}),
        };
        return result;
      }

      case 'dtmf': {
        const dtmf = msg['dtmf'] as Record<string, unknown> | undefined;
        if (!dtmf) return null;

        const digit = dtmf['digit'] as string | undefined;
        if (!digit) return null;

        // Twilio reports DTMF key-hold duration in milliseconds.
        const duration = typeof dtmf['duration'] === 'number'
          ? (dtmf['duration'] as number)
          : undefined;

        const result: MediaStreamIncoming = {
          type: 'dtmf',
          digit,
          streamSid,
          ...(duration !== undefined ? { durationMs: duration } : {}),
        };
        return result;
      }

      case 'stop': {
        const result: MediaStreamIncoming = { type: 'stop', streamSid };
        return result;
      }

      case 'mark': {
        const mark = msg['mark'] as Record<string, unknown> | undefined;
        if (!mark) return null;

        const name = mark['name'] as string | undefined;
        if (!name) return null;

        const result: MediaStreamIncoming = { type: 'mark', name, streamSid };
        return result;
      }

      default:
        // Twilio may add new event types in the future; silently ignore them
        // rather than throwing so existing deployments remain forward-compatible.
        return null;
    }
  }

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
  formatOutgoing(audio: Buffer, streamSid: string): string {
    return JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: audio.toString('base64') },
    });
  }

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
  formatConnected(_streamSid: string): string {
    return JSON.stringify({
      event: 'connected',
      protocol: 'Call',
      version: '1.0.0',
    });
  }
}

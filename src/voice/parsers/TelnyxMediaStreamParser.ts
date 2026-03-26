/**
 * @fileoverview Telnyx media stream WebSocket parser.
 *
 * ## Telnyx's asymmetric protocol
 *
 * Telnyx uses a fundamentally different approach than Twilio for inbound vs.
 * outbound audio on the media stream WebSocket:
 *
 * - **Inbound** (phone -> server): JSON-encoded messages with `event`, `stream_id`,
 *   and `media.chunk` (base64 mu-law audio) fields.
 * - **Outbound** (server -> phone): **Raw binary** WebSocket frames containing
 *   mu-law PCM bytes directly, with no JSON envelope whatsoever.
 *
 * This asymmetry means {@link formatOutgoing} returns the `Buffer` unchanged,
 * while {@link parseIncoming} parses JSON and base64-decodes the audio payload.
 *
 * ## Field name mapping
 *
 * Telnyx uses snake_case field names that differ from Twilio's conventions.
 * This parser normalises them to the shared {@link MediaStreamIncoming} shape:
 *
 * | Telnyx field         | Normalised field  |
 * |----------------------|-------------------|
 * | `stream_id`          | `streamSid`       |
 * | `call_control_id`    | `callSid`         |
 * | `media.chunk`        | `payload` (Buffer)|
 * | `media.track`        | (used for filtering, not emitted) |
 *
 * ## DTMF limitation
 *
 * Telnyx does NOT deliver DTMF events over the media stream WebSocket.
 * DTMF key-presses arrive as `call.dtmf.received` HTTP webhook events and
 * must be handled by {@link TelnyxVoiceProvider.parseWebhookEvent} instead.
 *
 * @see {@link https://developers.telnyx.com/docs/voice/media-streaming}
 * @module @framers/agentos/voice/parsers/TelnyxMediaStreamParser
 */

import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';

/**
 * Parses the Telnyx media stream WebSocket protocol.
 *
 * Telnyx sends JSON-encoded messages for stream lifecycle events (`start`,
 * `stop`) and audio chunks (`media`). Unlike Twilio, Telnyx does NOT deliver
 * DTMF events over the media stream WebSocket -- those arrive as HTTP webhooks
 * to a separate endpoint and must be handled outside this parser.
 *
 * Outgoing audio is sent as a **raw binary Buffer** (mu-law PCM bytes without
 * any JSON envelope) because Telnyx accepts unframed binary WebSocket frames
 * directly. No explicit connection acknowledgment is needed after the
 * handshake.
 *
 * @see {@link https://developers.telnyx.com/docs/voice/media-streaming}
 */
export class TelnyxMediaStreamParser implements MediaStreamParser {
  /**
   * Parse a raw WebSocket frame from Telnyx's media stream.
   *
   * Supported Telnyx event types:
   * - `start` -- stream established; `stream_id` maps to `streamSid`,
   *   `call_control_id` maps to `callSid`.
   * - `media` -- audio chunk; `media.chunk` field contains base64-encoded mu-law
   *   bytes; only `inbound` track frames are returned (outbound echoes are
   *   discarded to prevent feedback loops).
   * - `stop`  -- stream ended (call terminated or stream explicitly closed).
   *
   * Any other event type (e.g., future Telnyx additions, DTMF attempts) is
   * silently dropped by returning `null`.
   *
   * @param data - Raw WebSocket frame payload (JSON string or Buffer from Telnyx).
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
    // Telnyx uses `stream_id` where Twilio uses `streamSid`.
    const streamSid = msg['stream_id'] as string | undefined;

    if (!event || !streamSid) {
      return null;
    }

    switch (event) {
      case 'start': {
        // Telnyx uses `call_control_id` as the call-leg identifier,
        // equivalent to Twilio's `callSid`.
        const callSid = (msg['call_control_id'] as string | undefined) ?? '';
        const result: MediaStreamIncoming = {
          type: 'start',
          streamSid,
          callSid,
        };
        return result;
      }

      case 'media': {
        const media = msg['media'] as Record<string, unknown> | undefined;
        if (!media) return null;

        // Ignore outbound audio echoes from Telnyx to prevent feedback.
        const track = media['track'] as string | undefined;
        if (track === 'outbound') return null;

        // Telnyx names its audio payload field `chunk` (not `payload` like Twilio).
        const chunk = media['chunk'] as string | undefined;
        if (!chunk) return null;

        const result: MediaStreamIncoming = {
          type: 'audio',
          payload: Buffer.from(chunk, 'base64'),
          streamSid,
        };
        return result;
      }

      case 'stop': {
        const result: MediaStreamIncoming = { type: 'stop', streamSid };
        return result;
      }

      default:
        return null;
    }
  }

  /**
   * Encode mu-law audio for transmission back to Telnyx.
   *
   * Telnyx accepts raw binary WebSocket frames -- no JSON wrapping is needed.
   * This is the key asymmetry in Telnyx's protocol: inbound is JSON, outbound
   * is raw binary.
   *
   * @param audio - Raw mu-law PCM bytes to send to the caller.
   * @param _streamSid - Unused by Telnyx binary framing (accepted for interface
   *   parity with other parsers).
   * @returns The audio Buffer unchanged, ready to send as a binary WS frame.
   */
  formatOutgoing(audio: Buffer, _streamSid: string): Buffer {
    return audio;
  }

  /**
   * No explicit connection acknowledgment is required by Telnyx.
   *
   * Unlike Twilio, Telnyx does not need a `connected` handshake message
   * before it starts sending media events.
   *
   * @param _streamSid - Unused (accepted for interface parity).
   * @returns Always `null`.
   */
  formatConnected(_streamSid: string): null {
    return null;
  }
}

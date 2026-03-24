import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';

/**
 * Parses the Telnyx media stream WebSocket protocol.
 *
 * Telnyx sends JSON-encoded messages for stream lifecycle events (`start`,
 * `stop`) and audio chunks (`media`).  Unlike Twilio, Telnyx does NOT deliver
 * DTMF events over the media stream WebSocket — those arrive as HTTP webhooks
 * to a separate endpoint and must be handled outside this parser.
 *
 * Outgoing audio is sent as a **raw binary Buffer** (mu-law PCM bytes without
 * any JSON envelope) because Telnyx accepts unframed binary WebSocket frames
 * directly.  No explicit connection acknowledgment is needed after the
 * handshake.
 *
 * @see {@link https://developers.telnyx.com/docs/voice/media-streaming}
 */
export class TelnyxMediaStreamParser implements MediaStreamParser {
  /**
   * Parse a raw WebSocket frame from Telnyx's media stream.
   *
   * Supported Telnyx event types:
   * - `start` — stream established; `stream_id` maps to `streamSid`,
   *   `call_control_id` maps to `callSid`.
   * - `media` — audio chunk; `chunk` field contains base64-encoded mu-law
   *   bytes; only `inbound` track frames are returned.
   * - `stop`  — stream ended.
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
    const streamSid = msg['stream_id'] as string | undefined;

    if (!event || !streamSid) {
      return null;
    }

    switch (event) {
      case 'start': {
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

        // Ignore outbound audio echoes from Telnyx.
        const track = media['track'] as string | undefined;
        if (track === 'outbound') return null;

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
   * Telnyx accepts raw binary WebSocket frames; no JSON wrapping is applied.
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
   * @returns Always `null`.
   */
  formatConnected(_streamSid: string): null {
    return null;
  }
}

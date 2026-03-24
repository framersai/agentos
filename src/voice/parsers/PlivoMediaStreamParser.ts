import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';

/**
 * Parses the Plivo Audio Stream WebSocket protocol.
 *
 * Plivo sends JSON-encoded messages for stream lifecycle events (`start`,
 * `stop`) and audio chunks (`media`).  The audio payload is base64-encoded
 * mu-law PCM, delivered in a `payload` field inside the `media` object.
 *
 * Outgoing audio is wrapped in a `playAudio` JSON envelope, which is the
 * format Plivo expects when the server streams audio back to the caller.
 * No explicit connection acknowledgment is required after the handshake.
 *
 * @see {@link https://www.plivo.com/docs/voice/xml/stream}
 */
export class PlivoMediaStreamParser implements MediaStreamParser {
  /**
   * Parse a raw WebSocket frame from Plivo's audio stream.
   *
   * Supported Plivo event types:
   * - `start` — stream established; `stream_id` maps to `streamSid`,
   *   `call_uuid` maps to `callSid`.
   * - `media` — audio chunk; `media.payload` contains base64-encoded mu-law.
   * - `stop`  — stream ended.
   *
   * @param data - Raw WebSocket frame payload (JSON string or Buffer from Plivo).
   * @returns Normalised {@link MediaStreamIncoming} event, or `null` for
   *   unknown event types or malformed messages.
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
        const callSid = (msg['call_uuid'] as string | undefined) ?? '';
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

        const payloadB64 = media['payload'] as string | undefined;
        if (!payloadB64) return null;

        const result: MediaStreamIncoming = {
          type: 'audio',
          payload: Buffer.from(payloadB64, 'base64'),
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
   * Encode mu-law audio for transmission back to Plivo.
   *
   * Plivo requires audio to be base64-encoded and wrapped in a `playAudio`
   * JSON envelope.
   *
   * @param audio - Raw mu-law PCM bytes to send to the caller.
   * @param _streamSid - Unused by Plivo's `playAudio` format (accepted for
   *   interface parity with other parsers).
   * @returns JSON string conforming to the Plivo `playAudio` envelope.
   */
  formatOutgoing(audio: Buffer, _streamSid: string): string {
    return JSON.stringify({
      event: 'playAudio',
      media: { payload: audio.toString('base64') },
    });
  }
}

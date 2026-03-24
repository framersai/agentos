import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';

/**
 * Parses the Twilio `<Connect><Stream>` WebSocket media stream protocol.
 *
 * Twilio sends all messages as JSON-encoded strings.  Outbound audio is
 * wrapped in the same JSON envelope so Twilio can associate it with the
 * correct stream.  An explicit `connected` acknowledgment is sent once
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
   * - `start`  — stream established, includes callSid
   * - `media`  — audio chunk (inbound track only; outbound chunks are ignored)
   * - `dtmf`   — DTMF keypress detected
   * - `stop`   — stream ended
   * - `mark`   — named synchronisation marker
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

    if (!event || !streamSid) {
      return null;
    }

    switch (event) {
      case 'start': {
        const startPayload = msg['start'] as Record<string, unknown> | undefined;
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

        // Only process inbound audio — outbound echoes must be discarded.
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
        return null;
    }
  }

  /**
   * Encode mu-law audio for transmission back to the Twilio stream.
   *
   * Twilio requires base64-encoded audio wrapped in a JSON `media` envelope
   * so it can route the audio to the correct stream.
   *
   * @param audio - Raw mu-law PCM bytes to send to the caller.
   * @param streamSid - The stream identifier to include in the envelope.
   * @returns JSON string conforming to the Twilio media-out envelope format.
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
   * @param _streamSid - Unused — Twilio does not require the stream ID in the
   *   `connected` message, but the parameter is accepted for interface parity.
   * @returns JSON string with the `connected` envelope.
   */
  formatConnected(_streamSid: string): string {
    return JSON.stringify({
      event: 'connected',
      protocol: 'Call',
      version: '1.0.0',
    });
  }
}

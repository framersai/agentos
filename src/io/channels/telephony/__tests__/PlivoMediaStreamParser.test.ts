/**
 * @fileoverview Unit tests for {@link PlivoMediaStreamParser}.
 *
 * Covers all supported Plivo event types (`start`, `media`, `stop`), the
 * `playAudio` outgoing JSON envelope, the absence of `formatConnected`,
 * and edge cases: unknown events, malformed JSON, missing required fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlivoMediaStreamParser } from '../parsers/PlivoMediaStreamParser.js';

describe('PlivoMediaStreamParser', () => {
  let parser: PlivoMediaStreamParser;

  beforeEach(() => {
    parser = new PlivoMediaStreamParser();
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- start
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- start event', () => {
    it('should map stream_id to streamSid and call_uuid to callSid', () => {
      const msg = JSON.stringify({
        event: 'start',
        stream_id: 's1',
        call_uuid: 'u1',
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('start');
      if (result && result.type === 'start') {
        expect(result.streamSid).toBe('s1');
        expect(result.callSid).toBe('u1');
      }
    });

    it('should accept a Buffer input and still parse the start event correctly', () => {
      // WebSocket libraries may deliver frames as Buffers instead of strings.
      const msg = Buffer.from(
        JSON.stringify({ event: 'start', stream_id: 's2', call_uuid: 'u2' }),
      );

      expect(parser.parseIncoming(msg)?.type).toBe('start');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- media
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- media event', () => {
    it('should decode the base64 payload field into a Buffer for audio chunks', () => {
      const rawBytes = Buffer.from([0x7f, 0x80, 0x7e]);
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 's1',
        media: { payload: rawBytes.toString('base64') },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('audio');
      if (result && result.type === 'audio') {
        expect(result.streamSid).toBe('s1');
        expect(result.payload).toEqual(rawBytes);
      }
    });

    it('should return null when the media object is absent from the message', () => {
      const msg = JSON.stringify({ event: 'media', stream_id: 's1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('should return null when the payload field is missing from the media object', () => {
      const msg = JSON.stringify({ event: 'media', stream_id: 's1', media: {} });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- stop
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- stop event', () => {
    it('should return a stop event with streamSid when the stream ends', () => {
      const msg = JSON.stringify({ event: 'stop', stream_id: 's1' });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('stop');
      if (result && result.type === 'stop') {
        expect(result.streamSid).toBe('s1');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- unknown / malformed
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- unknown events and malformed input', () => {
    it('should return null for unknown event types to ensure forward compatibility', () => {
      const msg = JSON.stringify({ event: 'ping', stream_id: 's1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('should return null for malformed JSON without throwing', () => {
      expect(parser.parseIncoming('{not valid json')).toBeNull();
    });

    it('should return null when stream_id is missing from the message', () => {
      const msg = JSON.stringify({ event: 'stop' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('should return null when event field is missing from the message', () => {
      const msg = JSON.stringify({ stream_id: 's1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // formatOutgoing -- playAudio envelope
  // ---------------------------------------------------------------------------

  describe('formatOutgoing', () => {
    it('should wrap audio in the Plivo playAudio JSON envelope with base64 payload', () => {
      const audio = Buffer.from([0x7f, 0x80, 0x7e]);
      const result = parser.formatOutgoing(audio, 's1');

      const parsed = JSON.parse(result as string);
      expect(parsed.event).toBe('playAudio');
      expect(parsed.media.payload).toBe(audio.toString('base64'));
    });

    it('should not include streamSid in the playAudio envelope (Plivo routes implicitly)', () => {
      // Unlike Twilio, Plivo does not need a stream identifier in outbound
      // messages because the audio is implicitly routed on the same WebSocket.
      const audio = Buffer.from([0x00]);
      const result = parser.formatOutgoing(audio, 's1');

      const parsed = JSON.parse(result as string);
      expect(parsed.streamSid).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // formatConnected -- not implemented
  // ---------------------------------------------------------------------------

  describe('formatConnected', () => {
    it('should not be defined because Plivo needs no connection acknowledgment', () => {
      expect((parser as { formatConnected?: unknown }).formatConnected).toBeUndefined();
    });
  });
});

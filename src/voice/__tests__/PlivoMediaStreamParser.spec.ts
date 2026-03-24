import { describe, it, expect, beforeEach } from 'vitest';
import { PlivoMediaStreamParser } from '../parsers/PlivoMediaStreamParser.js';

/**
 * Unit tests for {@link PlivoMediaStreamParser}.
 *
 * Covers all supported event types (start, media, stop), the playAudio
 * outgoing envelope, and edge cases: unknown events, malformed JSON, missing
 * required fields.
 */
describe('PlivoMediaStreamParser', () => {
  let parser: PlivoMediaStreamParser;

  beforeEach(() => {
    parser = new PlivoMediaStreamParser();
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — start
  // ---------------------------------------------------------------------------

  describe('parseIncoming — start event', () => {
    it('maps stream_id → streamSid and call_uuid → callSid', () => {
      const msg = JSON.stringify({
        event: 'start',
        stream_id: 's1',
        call_uuid: 'u1',
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('start');
      if (result!.type === 'start') {
        expect(result.streamSid).toBe('s1');
        expect(result.callSid).toBe('u1');
      }
    });

    it('accepts a Buffer input', () => {
      const msg = Buffer.from(
        JSON.stringify({ event: 'start', stream_id: 's2', call_uuid: 'u2' }),
      );

      expect(parser.parseIncoming(msg)?.type).toBe('start');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — media
  // ---------------------------------------------------------------------------

  describe('parseIncoming — media event', () => {
    it('decodes the base64 payload field into a Buffer', () => {
      const rawBytes = Buffer.from([0x7f, 0x80, 0x7e]);
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 's1',
        media: { payload: rawBytes.toString('base64') },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('audio');
      if (result!.type === 'audio') {
        expect(result.streamSid).toBe('s1');
        expect(result.payload).toEqual(rawBytes);
      }
    });

    it('returns null when media object is absent', () => {
      const msg = JSON.stringify({ event: 'media', stream_id: 's1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('returns null when payload field is missing from media object', () => {
      const msg = JSON.stringify({ event: 'media', stream_id: 's1', media: {} });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — stop
  // ---------------------------------------------------------------------------

  describe('parseIncoming — stop event', () => {
    it('returns a stop event with streamSid', () => {
      const msg = JSON.stringify({ event: 'stop', stream_id: 's1' });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('stop');
      if (result!.type === 'stop') {
        expect(result.streamSid).toBe('s1');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — unknown / malformed
  // ---------------------------------------------------------------------------

  describe('parseIncoming — unknown events and malformed input', () => {
    it('returns null for unknown event types', () => {
      const msg = JSON.stringify({ event: 'ping', stream_id: 's1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parser.parseIncoming('{not valid json')).toBeNull();
    });

    it('returns null when stream_id is missing', () => {
      const msg = JSON.stringify({ event: 'stop' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('returns null when event field is missing', () => {
      const msg = JSON.stringify({ stream_id: 's1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // formatOutgoing — playAudio envelope
  // ---------------------------------------------------------------------------

  describe('formatOutgoing', () => {
    it('wraps audio in the Plivo playAudio envelope', () => {
      const audio = Buffer.from([0x7f, 0x80, 0x7e]);
      const result = parser.formatOutgoing(audio, 's1');

      const parsed = JSON.parse(result as string);
      expect(parsed.event).toBe('playAudio');
      expect(parsed.media.payload).toBe(audio.toString('base64'));
    });

    it('does not include streamSid in the playAudio envelope', () => {
      const audio = Buffer.from([0x00]);
      const result = parser.formatOutgoing(audio, 's1');

      const parsed = JSON.parse(result as string);
      expect(parsed.streamSid).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // formatConnected — optional, not implemented
  // ---------------------------------------------------------------------------

  describe('formatConnected', () => {
    it('is not defined (Plivo needs no connection acknowledgment)', () => {
      expect((parser as { formatConnected?: unknown }).formatConnected).toBeUndefined();
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { TelnyxMediaStreamParser } from '../parsers/TelnyxMediaStreamParser.js';

/**
 * Unit tests for {@link TelnyxMediaStreamParser}.
 *
 * Covers all supported event types, outbound track filtering, unknown events,
 * malformed JSON, raw-binary outgoing format, and the no-op formatConnected.
 */
describe('TelnyxMediaStreamParser', () => {
  let parser: TelnyxMediaStreamParser;

  beforeEach(() => {
    parser = new TelnyxMediaStreamParser();
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — start
  // ---------------------------------------------------------------------------

  describe('parseIncoming — start event', () => {
    it('maps stream_id → streamSid and call_control_id → callSid', () => {
      const msg = JSON.stringify({
        event: 'start',
        stream_id: 'str1',
        call_control_id: 'cc1',
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('start');
      if (result && result.type === 'start') {
        expect(result.streamSid).toBe('str1');
        expect(result.callSid).toBe('cc1');
      }
    });

    it('accepts a Buffer input', () => {
      const msg = Buffer.from(
        JSON.stringify({ event: 'start', stream_id: 'str2', call_control_id: 'cc2' }),
      );

      expect(parser.parseIncoming(msg)?.type).toBe('start');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — media (inbound)
  // ---------------------------------------------------------------------------

  describe('parseIncoming — media event (inbound)', () => {
    it('decodes the base64 chunk field into a Buffer', () => {
      const rawBytes = Buffer.from([0x7f, 0x80, 0x7e]);
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 'str1',
        media: { track: 'inbound', chunk: rawBytes.toString('base64') },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('audio');
      if (result && result.type === 'audio') {
        expect(result.streamSid).toBe('str1');
        expect(result.payload).toEqual(rawBytes);
      }
    });

    it('parses media without an explicit track field (defaults to inbound)', () => {
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 'str1',
        media: { chunk: Buffer.from([0x00]).toString('base64') },
      });

      expect(parser.parseIncoming(msg)?.type).toBe('audio');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — media (outbound, must be ignored)
  // ---------------------------------------------------------------------------

  describe('parseIncoming — outbound media track', () => {
    it('returns null for outbound track messages', () => {
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 'str1',
        media: { track: 'outbound', chunk: 'AAAA' },
      });

      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — stop
  // ---------------------------------------------------------------------------

  describe('parseIncoming — stop event', () => {
    it('returns a stop event with streamSid', () => {
      const msg = JSON.stringify({ event: 'stop', stream_id: 'str1' });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('stop');
      if (result && result.type === 'stop') {
        expect(result.streamSid).toBe('str1');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — no DTMF support
  // ---------------------------------------------------------------------------

  describe('parseIncoming — DTMF (not supported over media stream)', () => {
    it('returns null for any dtmf event (Telnyx sends DTMF via webhook only)', () => {
      const msg = JSON.stringify({
        event: 'dtmf',
        stream_id: 'str1',
        dtmf: { digit: '5' },
      });

      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — unknown / malformed
  // ---------------------------------------------------------------------------

  describe('parseIncoming — unknown events and malformed input', () => {
    it('returns null for unknown event types', () => {
      const msg = JSON.stringify({ event: 'heartbeat', stream_id: 'str1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parser.parseIncoming('not-json')).toBeNull();
    });

    it('returns null when stream_id is missing', () => {
      const msg = JSON.stringify({ event: 'stop' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('returns null when media object is absent', () => {
      const msg = JSON.stringify({ event: 'media', stream_id: 'str1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // formatOutgoing — raw binary
  // ---------------------------------------------------------------------------

  describe('formatOutgoing', () => {
    it('returns the audio Buffer unchanged (no JSON wrapper)', () => {
      const audio = Buffer.from([0x7f, 0x80, 0x7e]);
      const result = parser.formatOutgoing(audio, 'str1');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result as Buffer).toEqual(audio);
    });
  });

  // ---------------------------------------------------------------------------
  // formatConnected
  // ---------------------------------------------------------------------------

  describe('formatConnected', () => {
    it('returns null (Telnyx needs no explicit connection acknowledgment)', () => {
      expect(parser.formatConnected('str1')).toBeNull();
    });
  });
});

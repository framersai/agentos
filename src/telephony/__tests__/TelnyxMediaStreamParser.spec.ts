/**
 * @fileoverview Unit tests for {@link TelnyxMediaStreamParser}.
 *
 * Covers all supported event types (`start`, `media`, `stop`), outbound track
 * filtering, the asymmetric protocol (JSON in, raw binary out), the no-op
 * `formatConnected`, and edge cases: DTMF over media stream (not supported),
 * unknown events, malformed JSON, and missing required fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TelnyxMediaStreamParser } from '../parsers/TelnyxMediaStreamParser.js';

describe('TelnyxMediaStreamParser', () => {
  let parser: TelnyxMediaStreamParser;

  beforeEach(() => {
    parser = new TelnyxMediaStreamParser();
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- start
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- start event', () => {
    it('should map stream_id to streamSid and call_control_id to callSid', () => {
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

    it('should accept a Buffer input and parse the start event correctly', () => {
      const msg = Buffer.from(
        JSON.stringify({ event: 'start', stream_id: 'str2', call_control_id: 'cc2' }),
      );

      expect(parser.parseIncoming(msg)?.type).toBe('start');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- media (inbound)
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- media event (inbound)', () => {
    it('should decode the base64 chunk field into a Buffer for inbound audio', () => {
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

    it('should parse media without an explicit track field (defaults to inbound)', () => {
      // When track is omitted, the audio is assumed to be inbound.
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 'str1',
        media: { chunk: Buffer.from([0x00]).toString('base64') },
      });

      expect(parser.parseIncoming(msg)?.type).toBe('audio');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- media (outbound, must be filtered)
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- outbound media track', () => {
    it('should return null for outbound track messages to prevent echo feedback', () => {
      const msg = JSON.stringify({
        event: 'media',
        stream_id: 'str1',
        media: { track: 'outbound', chunk: 'AAAA' },
      });

      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- stop
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- stop event', () => {
    it('should return a stop event with streamSid when the stream ends', () => {
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
  // parseIncoming -- DTMF (not supported over media stream)
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- DTMF (not supported over media stream)', () => {
    it('should return null for any dtmf event because Telnyx sends DTMF only via HTTP webhooks', () => {
      // This is a key difference from Twilio: Telnyx delivers DTMF as
      // `call.dtmf.received` webhooks, never over the media stream WebSocket.
      const msg = JSON.stringify({
        event: 'dtmf',
        stream_id: 'str1',
        dtmf: { digit: '5' },
      });

      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- unknown / malformed
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- unknown events and malformed input', () => {
    it('should return null for unknown event types to ensure forward compatibility', () => {
      const msg = JSON.stringify({ event: 'heartbeat', stream_id: 'str1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('should return null for malformed JSON without throwing', () => {
      expect(parser.parseIncoming('not-json')).toBeNull();
    });

    it('should return null when stream_id is missing from the message', () => {
      const msg = JSON.stringify({ event: 'stop' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('should return null when media object is absent from a media event', () => {
      const msg = JSON.stringify({ event: 'media', stream_id: 'str1' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // formatOutgoing -- raw binary (asymmetric protocol)
  // ---------------------------------------------------------------------------

  describe('formatOutgoing', () => {
    it('should return the audio Buffer unchanged because Telnyx accepts raw binary frames', () => {
      // This is the key asymmetry: JSON in, raw binary out.
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
    it('should return null because Telnyx needs no explicit connection acknowledgment', () => {
      expect(parser.formatConnected('str1')).toBeNull();
    });
  });
});

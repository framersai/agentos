/**
 * @fileoverview Unit tests for {@link TwilioMediaStreamParser}.
 *
 * Covers all five supported Twilio event types (`start`, `media`, `dtmf`,
 * `stop`, `mark`), the outbound JSON media envelope, the `connected`
 * acknowledgment message, and edge cases: outbound track filtering, unknown
 * events, malformed JSON, and missing required fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TwilioMediaStreamParser } from '../parsers/TwilioMediaStreamParser.js';

describe('TwilioMediaStreamParser', () => {
  let parser: TwilioMediaStreamParser;

  beforeEach(() => {
    parser = new TwilioMediaStreamParser();
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- start
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- start event', () => {
    it('should return a start event with streamSid and callSid when Twilio sends a start message', () => {
      const msg = JSON.stringify({
        event: 'start',
        streamSid: 'MZ001',
        start: { callSid: 'CA001', accountSid: 'AC001' },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('start');
      if (result!.type === 'start') {
        expect(result!.streamSid).toBe('MZ001');
        expect(result!.callSid).toBe('CA001');
      }
    });

    it('should accept a Buffer input and still parse the start event correctly', () => {
      // WebSocket libraries may deliver frames as Buffers instead of strings.
      const msg = Buffer.from(
        JSON.stringify({ event: 'start', streamSid: 'MZ002', start: { callSid: 'CA002' } }),
      );

      const result = parser.parseIncoming(msg);
      expect(result?.type).toBe('start');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- media (inbound)
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- media event (inbound)', () => {
    it('should decode the base64 audio payload into a Buffer when track is inbound', () => {
      const rawBytes = Buffer.from([0x7f, 0x80, 0x7e]);
      const msg = JSON.stringify({
        event: 'media',
        streamSid: 'MZ001',
        media: { track: 'inbound', payload: rawBytes.toString('base64') },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('audio');
      if (result!.type === 'audio') {
        expect(result!.streamSid).toBe('MZ001');
        expect(result!.payload).toEqual(rawBytes);
      }
    });

    it('should parse inbound media even when track field is absent (defaults to inbound)', () => {
      // Twilio may omit the track field for single-track streams.
      const msg = JSON.stringify({
        event: 'media',
        streamSid: 'MZ003',
        media: { payload: Buffer.from([0x00]).toString('base64') },
      });

      const result = parser.parseIncoming(msg);
      expect(result?.type).toBe('audio');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- media (outbound, must be filtered)
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- outbound media track', () => {
    it('should return null for outbound track messages to prevent echo feedback', () => {
      // Twilio echoes outbound audio back on the stream; we must discard it
      // to prevent the agent from hearing its own TTS output.
      const msg = JSON.stringify({
        event: 'media',
        streamSid: 'MZ001',
        media: { track: 'outbound', payload: 'AAAA' },
      });

      const result = parser.parseIncoming(msg);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- dtmf
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- dtmf event', () => {
    it('should return a dtmf event with digit and durationMs when both are present', () => {
      const msg = JSON.stringify({
        event: 'dtmf',
        streamSid: 'MZ001',
        dtmf: { digit: '5', duration: 500 },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('dtmf');
      if (result!.type === 'dtmf') {
        expect(result!.digit).toBe('5');
        expect(result!.streamSid).toBe('MZ001');
        expect(result!.durationMs).toBe(500);
      }
    });

    it('should return a dtmf event without durationMs when duration is absent from the payload', () => {
      // Not all DTMF events include duration (e.g., webhook-based DTMF).
      const msg = JSON.stringify({
        event: 'dtmf',
        streamSid: 'MZ001',
        dtmf: { digit: '#' },
      });

      const result = parser.parseIncoming(msg);

      expect(result?.type).toBe('dtmf');
      if (result?.type === 'dtmf') {
        expect(result!.durationMs).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- stop
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- stop event', () => {
    it('should return a stop event with streamSid when the stream ends', () => {
      const msg = JSON.stringify({ event: 'stop', streamSid: 'MZ001' });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('stop');
      if (result!.type === 'stop') {
        expect(result!.streamSid).toBe('MZ001');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- mark
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- mark event', () => {
    it('should return a mark event with name and streamSid for audio sync markers', () => {
      const msg = JSON.stringify({
        event: 'mark',
        streamSid: 'MZ001',
        mark: { name: 'done' },
      });

      const result = parser.parseIncoming(msg);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('mark');
      if (result!.type === 'mark') {
        expect(result!.name).toBe('done');
        expect(result!.streamSid).toBe('MZ001');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming -- unknown / malformed
  // ---------------------------------------------------------------------------

  describe('parseIncoming -- unknown events and malformed input', () => {
    it('should return null for unknown event types to ensure forward compatibility', () => {
      const msg = JSON.stringify({ event: 'heartbeat', streamSid: 'MZ001' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('should return null for malformed JSON without throwing', () => {
      expect(parser.parseIncoming('not-json')).toBeNull();
    });

    it('should return null when streamSid is missing from the message', () => {
      const msg = JSON.stringify({ event: 'stop' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // formatOutgoing
  // ---------------------------------------------------------------------------

  describe('formatOutgoing', () => {
    it('should wrap audio in the Twilio JSON media envelope with base64 payload and streamSid', () => {
      const audio = Buffer.from([0x7f, 0x80]);
      const result = parser.formatOutgoing(audio, 'MZ001');

      const parsed = JSON.parse(result as string);
      expect(parsed.event).toBe('media');
      expect(parsed.streamSid).toBe('MZ001');
      expect(parsed.media.payload).toBe(audio.toString('base64'));
    });
  });

  // ---------------------------------------------------------------------------
  // formatConnected
  // ---------------------------------------------------------------------------

  describe('formatConnected', () => {
    it('should return a JSON connected handshake message that Twilio requires on stream open', () => {
      const result = parser.formatConnected!('MZ001');

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result as string);
      expect(parsed.event).toBe('connected');
      expect(parsed.protocol).toBe('Call');
      expect(parsed.version).toBe('1.0.0');
    });
  });
});

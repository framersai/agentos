import { describe, it, expect, beforeEach } from 'vitest';
import { TwilioMediaStreamParser } from '../parsers/TwilioMediaStreamParser.js';

/**
 * Unit tests for {@link TwilioMediaStreamParser}.
 *
 * Each Twilio event type is exercised, plus edge cases: outbound track
 * filtering, unknown events, malformed JSON, and missing fields.
 */
describe('TwilioMediaStreamParser', () => {
  let parser: TwilioMediaStreamParser;

  beforeEach(() => {
    parser = new TwilioMediaStreamParser();
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — start
  // ---------------------------------------------------------------------------

  describe('parseIncoming — start event', () => {
    it('returns a start event with streamSid and callSid', () => {
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

    it('accepts a Buffer input', () => {
      const msg = Buffer.from(
        JSON.stringify({ event: 'start', streamSid: 'MZ002', start: { callSid: 'CA002' } }),
      );

      const result = parser.parseIncoming(msg);
      expect(result?.type).toBe('start');
    });
  });

  // ---------------------------------------------------------------------------
  // parseIncoming — media (inbound)
  // ---------------------------------------------------------------------------

  describe('parseIncoming — media event (inbound)', () => {
    it('decodes base64 audio payload into a Buffer', () => {
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

    it('parses inbound media without an explicit track field', () => {
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
  // parseIncoming — media (outbound, must be ignored)
  // ---------------------------------------------------------------------------

  describe('parseIncoming — outbound media track', () => {
    it('returns null for outbound track messages', () => {
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
  // parseIncoming — dtmf
  // ---------------------------------------------------------------------------

  describe('parseIncoming — dtmf event', () => {
    it('returns dtmf event with digit and durationMs', () => {
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

    it('returns dtmf event without durationMs when duration is absent', () => {
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
  // parseIncoming — stop
  // ---------------------------------------------------------------------------

  describe('parseIncoming — stop event', () => {
    it('returns a stop event with streamSid', () => {
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
  // parseIncoming — mark
  // ---------------------------------------------------------------------------

  describe('parseIncoming — mark event', () => {
    it('returns a mark event with name and streamSid', () => {
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
  // parseIncoming — unknown / malformed
  // ---------------------------------------------------------------------------

  describe('parseIncoming — unknown events and malformed input', () => {
    it('returns null for unknown event types', () => {
      const msg = JSON.stringify({ event: 'heartbeat', streamSid: 'MZ001' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parser.parseIncoming('not-json')).toBeNull();
    });

    it('returns null when streamSid is missing', () => {
      const msg = JSON.stringify({ event: 'stop' });
      expect(parser.parseIncoming(msg)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // formatOutgoing
  // ---------------------------------------------------------------------------

  describe('formatOutgoing', () => {
    it('wraps audio in the Twilio media envelope', () => {
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
    it('returns a JSON string with event=connected', () => {
      const result = parser.formatConnected!('MZ001');

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result as string);
      expect(parsed.event).toBe('connected');
      expect(parsed.protocol).toBe('Call');
      expect(parsed.version).toBe('1.0.0');
    });
  });
});

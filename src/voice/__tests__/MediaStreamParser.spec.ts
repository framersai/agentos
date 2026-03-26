/**
 * @fileoverview Type-level and minimal runtime checks for the
 * {@link MediaStreamParser} interface and {@link MediaStreamIncoming}
 * discriminated union.
 *
 * These tests verify structural correctness at compile time (via assignability
 * checks) and at runtime (via discriminant narrowing). No concrete parser
 * implementation is imported here -- this spec is purely about the contract.
 *
 * If any test fails to compile, the interface shape has regressed.
 */

import { describe, it, expect } from 'vitest';
import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';

describe('MediaStreamParser interface', () => {
  it('should accept a minimal conforming implementation with just parseIncoming and formatOutgoing', () => {
    // Build a minimal stub that satisfies the interface -- if this compiles
    // the interface is structurally sound.
    const stub: MediaStreamParser = {
      parseIncoming(_data: Buffer | string): MediaStreamIncoming | null {
        return null;
      },
      formatOutgoing(_audio: Buffer, _streamSid: string): Buffer | string {
        return Buffer.alloc(0);
      },
    };

    expect(stub).toBeDefined();
    expect(typeof stub.parseIncoming).toBe('function');
    expect(typeof stub.formatOutgoing).toBe('function');
  });

  it('should accept an implementation that also provides the optional formatConnected method', () => {
    // formatConnected is optional in the interface -- implementations that
    // need a handshake (like Twilio) provide it, others (Telnyx, Plivo) omit it.
    const stub: MediaStreamParser = {
      parseIncoming: () => null,
      formatOutgoing: (_a, _s) => '',
      formatConnected: (_s) => '{"event":"connected"}',
    };

    expect(typeof stub.formatConnected).toBe('function');
    expect(stub.formatConnected!('MZ123')).toBe('{"event":"connected"}');
  });

  it('should carry a Buffer payload on the audio variant of MediaStreamIncoming', () => {
    const event: MediaStreamIncoming = {
      type: 'audio',
      payload: Buffer.from([0x7f, 0x7f]),
      streamSid: 'MZ001',
      sequenceNumber: 1,
    };

    expect(event.type).toBe('audio');
    // Discriminant narrowing ensures payload is accessible only on the audio variant.
    if (event.type === 'audio') {
      expect(Buffer.isBuffer(event.payload)).toBe(true);
      expect(event.sequenceNumber).toBe(1);
    }
  });

  it('should carry digit and optional durationMs on the dtmf variant', () => {
    const event: MediaStreamIncoming = {
      type: 'dtmf',
      digit: '5',
      streamSid: 'MZ001',
      durationMs: 250,
    };

    expect(event.type).toBe('dtmf');
    if (event.type === 'dtmf') {
      expect(event.digit).toBe('5');
      expect(event.durationMs).toBe(250);
    }
  });

  it('should carry streamSid, callSid, and optional metadata on the start variant', () => {
    const event: MediaStreamIncoming = {
      type: 'start',
      streamSid: 'MZ001',
      callSid: 'CA001',
      metadata: { customField: 'value' },
    };

    expect(event.type).toBe('start');
    if (event.type === 'start') {
      expect(event.callSid).toBe('CA001');
      expect(event.metadata).toEqual({ customField: 'value' });
    }
  });

  it('should only require streamSid on the stop variant (minimal terminal event)', () => {
    const event: MediaStreamIncoming = {
      type: 'stop',
      streamSid: 'MZ001',
    };

    expect(event.type).toBe('stop');
    if (event.type === 'stop') {
      expect(event.streamSid).toBe('MZ001');
    }
  });

  it('should carry a name label on the mark variant for stream synchronisation', () => {
    const event: MediaStreamIncoming = {
      type: 'mark',
      name: 'playback-complete',
      streamSid: 'MZ001',
    };

    expect(event.type).toBe('mark');
    if (event.type === 'mark') {
      expect(event.name).toBe('playback-complete');
    }
  });
});

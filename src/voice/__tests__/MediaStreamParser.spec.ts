import { describe, it, expect } from 'vitest';
import type { MediaStreamParser, MediaStreamIncoming } from '../MediaStreamParser.js';

/**
 * Type-level and minimal runtime checks for the MediaStreamParser interface
 * and MediaStreamIncoming discriminated union.
 *
 * These tests verify structural correctness at compile time (via assignability
 * checks) and at runtime (via discriminant narrowing). No concrete parser
 * implementation is imported here — this spec is purely about the contract.
 */
describe('MediaStreamParser interface', () => {
  it('accepts a conforming implementation at the type level', () => {
    // Build a minimal stub that satisfies the interface — if this compiles the
    // interface is structurally sound.
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

  it('accepts an implementation that also provides formatConnected', () => {
    const stub: MediaStreamParser = {
      parseIncoming: () => null,
      formatOutgoing: (_a, _s) => '',
      formatConnected: (_s) => '{"event":"connected"}',
    };

    expect(typeof stub.formatConnected).toBe('function');
    expect(stub.formatConnected!('MZ123')).toBe('{"event":"connected"}');
  });

  it('MediaStreamIncoming audio variant carries a Buffer payload', () => {
    const event: MediaStreamIncoming = {
      type: 'audio',
      payload: Buffer.from([0x7f, 0x7f]),
      streamSid: 'MZ001',
      sequenceNumber: 1,
    };

    expect(event.type).toBe('audio');
    if (event.type === 'audio') {
      expect(Buffer.isBuffer(event.payload)).toBe(true);
      expect(event.sequenceNumber).toBe(1);
    }
  });

  it('MediaStreamIncoming dtmf variant carries digit and optional durationMs', () => {
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

  it('MediaStreamIncoming start variant carries streamSid and callSid', () => {
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

  it('MediaStreamIncoming stop variant only requires streamSid', () => {
    const event: MediaStreamIncoming = {
      type: 'stop',
      streamSid: 'MZ001',
    };

    expect(event.type).toBe('stop');
    if (event.type === 'stop') {
      expect(event.streamSid).toBe('MZ001');
    }
  });

  it('MediaStreamIncoming mark variant carries a name', () => {
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

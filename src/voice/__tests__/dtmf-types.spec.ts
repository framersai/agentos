import { describe, it, expect } from 'vitest';
import type { NormalizedDtmfReceived, NormalizedCallEvent } from '../types.js';

describe('DTMF types', () => {
  it('NormalizedDtmfReceived has correct shape', () => {
    const event: NormalizedDtmfReceived = {
      kind: 'call-dtmf',
      eventId: 'ev1',
      providerCallId: 'call1',
      timestamp: Date.now(),
      digit: '5',
      durationMs: 300,
    };
    expect(event.kind).toBe('call-dtmf');
    expect(event.digit).toBe('5');
  });

  it('NormalizedDtmfReceived is part of NormalizedCallEvent union', () => {
    const event: NormalizedCallEvent = {
      kind: 'call-dtmf',
      eventId: 'ev1',
      providerCallId: 'call1',
      timestamp: Date.now(),
      digit: '#',
    };
    expect(event.kind).toBe('call-dtmf');
  });
});

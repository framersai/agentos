/**
 * @fileoverview Type-level checks for {@link NormalizedDtmfReceived}.
 *
 * Verifies at compile time that:
 * 1. NormalizedDtmfReceived has the expected shape (kind, digit, durationMs).
 * 2. NormalizedDtmfReceived is a member of the NormalizedCallEvent union.
 *
 * If either test fails to compile, the DTMF type integration has regressed.
 */

import { describe, it, expect } from 'vitest';
import type { NormalizedDtmfReceived, NormalizedCallEvent } from '../types.js';

describe('DTMF types', () => {
  it('should have the correct shape with kind, digit, and optional durationMs', () => {
    const event: NormalizedDtmfReceived = {
      kind: 'call-dtmf',
      eventId: 'ev1',
      providerCallId: 'call1',
      timestamp: Date.now(),
      digit: '5',
      durationMs: 300,
    };

    // Runtime checks confirm the shape matches at both compile and run time.
    expect(event.kind).toBe('call-dtmf');
    expect(event.digit).toBe('5');
  });

  it('should be assignable to the NormalizedCallEvent union (type-level membership check)', () => {
    // This assignment verifies that NormalizedDtmfReceived is included in
    // the NormalizedCallEvent discriminated union -- a compile error here
    // would mean the DTMF variant was accidentally removed from the union.
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

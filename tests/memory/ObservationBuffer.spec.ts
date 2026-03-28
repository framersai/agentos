/**
 * @fileoverview Unit tests for the observation buffer.
 * Tests token counting, activation thresholds, and draining.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationBuffer } from '../../src/memory/pipeline/observation/ObservationBuffer';

describe('ObservationBuffer', () => {
  let buffer: ObservationBuffer;

  beforeEach(() => {
    buffer = new ObservationBuffer({ activationThresholdTokens: 100 }); // Low threshold for testing
  });

  it('starts empty', () => {
    expect(buffer.getTotalTokens()).toBe(0);
    expect(buffer.getMessageCount()).toBe(0);
    expect(buffer.getPendingTokens()).toBe(0);
  });

  it('accumulates tokens when messages are pushed', () => {
    buffer.push('user', 'Hello world'); // ~3 tokens
    expect(buffer.getTotalTokens()).toBeGreaterThan(0);
    expect(buffer.getMessageCount()).toBe(1);
  });

  it('returns false when below threshold', () => {
    const shouldActivate = buffer.push('user', 'Short message');
    expect(shouldActivate).toBe(false);
  });

  it('returns true when threshold is reached', () => {
    // Push enough text to exceed 100 tokens (~400 chars)
    const shouldActivate = buffer.push('user', 'A'.repeat(500));
    expect(shouldActivate).toBe(true);
  });

  it('shouldActivate reflects cumulative tokens', () => {
    buffer.push('user', 'A'.repeat(200));
    expect(buffer.shouldActivate()).toBe(false);

    buffer.push('assistant', 'B'.repeat(200));
    expect(buffer.shouldActivate()).toBe(true);
  });

  it('drain returns unprocessed messages', () => {
    buffer.push('user', 'Message 1');
    buffer.push('assistant', 'Message 2');

    const drained = buffer.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0].content).toBe('Message 1');
    expect(drained[1].content).toBe('Message 2');
  });

  it('drain resets pending token count', () => {
    buffer.push('user', 'A'.repeat(500));
    expect(buffer.shouldActivate()).toBe(true);

    buffer.drain();
    expect(buffer.getPendingTokens()).toBe(0);
    expect(buffer.shouldActivate()).toBe(false);
  });

  it('subsequent drains only return new messages', () => {
    buffer.push('user', 'First batch');
    buffer.drain();

    buffer.push('user', 'Second batch');
    const drained = buffer.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0].content).toBe('Second batch');
  });

  it('clear resets everything', () => {
    buffer.push('user', 'Some content');
    buffer.clear();
    expect(buffer.getTotalTokens()).toBe(0);
    expect(buffer.getMessageCount()).toBe(0);
    expect(buffer.getPendingTokens()).toBe(0);
    expect(buffer.shouldActivate()).toBe(false);
  });

  it('buffered messages have correct role and timestamp', () => {
    buffer.push('system', 'System init');
    const drained = buffer.drain();
    expect(drained[0].role).toBe('system');
    expect(drained[0].timestamp).toBeGreaterThan(0);
  });
});

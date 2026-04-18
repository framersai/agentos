/**
 * @fileoverview Tests for ForgeStatsAggregator.
 *
 * Pins:
 * - attempts/approved/rejected counters increment correctly
 * - approvedConfidenceSum accumulates only on approval
 * - rejectionReasons bucket matches the classifier
 * - uniqueNames, uniqueApproved, uniqueTerminalRejections math
 * - snapshot() returns a detached copy
 * - reset() clears every field
 */

import { describe, it, expect } from 'vitest';
import {
  ForgeStatsAggregator,
  emptyForgeStats,
} from '../ForgeStatsAggregator.js';

describe('emptyForgeStats', () => {
  it('produces a zeroed snapshot', () => {
    const s = emptyForgeStats();
    expect(s.attempts).toBe(0);
    expect(s.approved).toBe(0);
    expect(s.rejected).toBe(0);
    expect(s.approvedConfidenceSum).toBe(0);
    expect(s.uniqueNames).toBe(0);
    expect(s.uniqueApproved).toBe(0);
    expect(s.uniqueTerminalRejections).toBe(0);
    expect(s.rejectionReasons).toEqual({
      schema_extra_field: 0,
      shape_check: 0,
      parse_error: 0,
      judge_correctness: 0,
      other: 0,
    });
  });
});

describe('ForgeStatsAggregator', () => {
  it('increments attempts + approved on approval', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(true, 0.9, 'a');
    const s = agg.snapshot();
    expect(s.attempts).toBe(1);
    expect(s.approved).toBe(1);
    expect(s.rejected).toBe(0);
    expect(s.approvedConfidenceSum).toBe(0.9);
  });

  it('increments attempts + rejected on rejection (no confidence sum)', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(false, 0.42, 'a', 'Shape check failed: inputSchema has no declared properties');
    const s = agg.snapshot();
    expect(s.attempts).toBe(1);
    expect(s.approved).toBe(0);
    expect(s.rejected).toBe(1);
    expect(s.approvedConfidenceSum).toBe(0);
    expect(s.rejectionReasons.shape_check).toBe(1);
  });

  it('buckets schema_extra_field rejections via the classifier', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(
      false,
      0,
      'bad',
      'violates the declared output schema by returning additional properties not allowed by additionalProperties:false',
    );
    expect(agg.snapshot().rejectionReasons.schema_extra_field).toBe(1);
  });

  it('buckets unknown rejection reasons into `other`', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(false, 0, 'bad', 'Sandbox timeout exceeded after 10000ms');
    expect(agg.snapshot().rejectionReasons.other).toBe(1);
  });

  it('tracks unique tool names across the union of approved + rejected', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(true, 0.9, 'alpha');
    agg.recordAttempt(false, 0, 'beta', 'shape check failed');
    agg.recordAttempt(true, 0.8, 'alpha'); // re-approval of alpha; no new unique
    const s = agg.snapshot();
    expect(s.uniqueNames).toBe(2);
    expect(s.uniqueApproved).toBe(1);
    expect(s.uniqueTerminalRejections).toBe(1); // beta was only rejected
  });

  it('counts a re-forged-after-rejection tool as NOT terminal', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(false, 0, 'gamma', 'shape check failed');
    agg.recordAttempt(true, 0.9, 'gamma');
    const s = agg.snapshot();
    expect(s.uniqueApproved).toBe(1);
    expect(s.uniqueTerminalRejections).toBe(0);
    expect(s.uniqueNames).toBe(1);
  });

  it('tolerates missing tool names without tracking unique metrics', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(true, 0.9);
    agg.recordAttempt(false, 0, undefined, 'Failed to parse LLM response as JSON');
    const s = agg.snapshot();
    expect(s.uniqueNames).toBe(0);
    expect(s.uniqueApproved).toBe(0);
    expect(s.uniqueTerminalRejections).toBe(0);
    expect(s.attempts).toBe(2);
    expect(s.rejectionReasons.parse_error).toBe(1);
  });

  it('snapshot returns a detached copy (callers cannot mutate internal state)', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(true, 0.9, 'a');
    const s1 = agg.snapshot();
    s1.attempts = 999;
    s1.rejectionReasons.other = 999;
    const s2 = agg.snapshot();
    expect(s2.attempts).toBe(1);
    expect(s2.rejectionReasons.other).toBe(0);
  });

  it('reset clears every accumulated field', () => {
    const agg = new ForgeStatsAggregator();
    agg.recordAttempt(true, 0.9, 'a');
    agg.recordAttempt(false, 0, 'b', 'shape check failed');
    agg.reset();
    expect(agg.snapshot()).toEqual(emptyForgeStats());
  });

  it('accumulates across many calls without drift', () => {
    const agg = new ForgeStatsAggregator();
    for (let i = 0; i < 50; i++) {
      agg.recordAttempt(i % 2 === 0, 0.5, `tool_${i}`);
    }
    const s = agg.snapshot();
    expect(s.attempts).toBe(50);
    expect(s.approved).toBe(25);
    expect(s.rejected).toBe(25);
    expect(s.uniqueNames).toBe(50);
    expect(s.uniqueApproved).toBe(25);
    expect(s.uniqueTerminalRejections).toBe(25);
    expect(s.approvedConfidenceSum).toBeCloseTo(12.5, 5);
  });
});

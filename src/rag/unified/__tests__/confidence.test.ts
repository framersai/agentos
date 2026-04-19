import { describe, expect, it } from 'vitest';

import { evaluateRetrievalConfidence } from '../confidence.js';

describe('evaluateRetrievalConfidence', () => {
  it('marks empty retrieval as suppressed and eligible for escalation', () => {
    const summary = evaluateRetrievalConfidence([], {
      adaptive: true,
      minScore: 0.3,
    });

    expect(summary.reason).toBe('no_hits');
    expect(summary.suppressResults).toBe(true);
    expect(summary.shouldEscalate).toBe(true);
  });

  it('suppresses weak top hits below minScore', () => {
    const summary = evaluateRetrievalConfidence(
      [{ relevanceScore: 0.21 }, { relevanceScore: 0.19 }],
      { adaptive: false, minScore: 0.3 },
    );

    expect(summary.reason).toBe('weak_hits');
    expect(summary.suppressResults).toBe(true);
    expect(summary.usefulHitCount).toBe(0);
  });

  it('keeps strong retrievals and does not escalate', () => {
    const summary = evaluateRetrievalConfidence(
      [{ relevanceScore: 0.81 }, { relevanceScore: 0.64 }, { relevanceScore: 0.4 }],
      { adaptive: true, minScore: 0.3 },
    );

    expect(summary.reason).toBe('ok');
    expect(summary.suppressResults).toBe(false);
    expect(summary.shouldEscalate).toBe(false);
  });
});

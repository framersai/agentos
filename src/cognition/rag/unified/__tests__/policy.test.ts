import { describe, expect, it } from 'vitest';

import {
  buildRetrievalPlanFromPolicy,
  resolveMemoryRetrievalPolicy,
} from '../policy.js';

describe('MemoryRetrievalPolicy', () => {
  it('resolves a stable balanced default', () => {
    const policy = resolveMemoryRetrievalPolicy();

    expect(policy.profile).toBe('balanced');
    expect(policy.adaptive).toBe(true);
    expect(policy.topK).toBe(8);
    expect(policy.candidateMultiplier).toBe(3);
    expect(policy.reranker).toBe('adaptive');
    expect(policy.hyde).toBe('adaptive');
  });

  it('maps balanced to moderate plan without HyDE or deep research by default', () => {
    const plan = buildRetrievalPlanFromPolicy({ profile: 'balanced' });

    expect(plan.strategy).toBe('moderate');
    expect(plan.hyde).toEqual({ enabled: false, hypothesisCount: 0 });
    expect(plan.deepResearch).toBe(false);
    expect(plan.sources.memory).toBe(true);
  });

  it('maps max-recall to the complex plan while still disabling deep research', () => {
    const plan = buildRetrievalPlanFromPolicy({ profile: 'max-recall', hyde: 'always' });

    expect(plan.strategy).toBe('complex');
    expect(plan.hyde.enabled).toBe(true);
    expect(plan.deepResearch).toBe(false);
    expect(plan.reasoning).toContain('max-recall');
  });
});

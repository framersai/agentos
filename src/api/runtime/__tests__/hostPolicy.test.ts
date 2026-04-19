import { describe, expect, it } from 'vitest';

import { normalizeHostLLMPolicy } from '../hostPolicy.js';

describe('HostLLMPolicy', () => {
  it('normalizes optimization, capability, and fallback hints for host apps', () => {
    const policy = normalizeHostLLMPolicy({
      optimizationPreference: 'cost',
      requiredCapabilities: ['json_mode', 'tool_use'],
      allowedProviders: ['openai', 'anthropic'],
      fallbackProviders: [{ provider: 'openai', model: 'gpt-4.1-mini' }],
      cacheDiscipline: 'stable_prefix',
    });

    expect(policy.optimizationPreference).toBe('cost');
    expect(policy.requiredCapabilities).toEqual(['json_mode', 'tool_use']);
    expect(policy.allowedProviders).toEqual(['openai', 'anthropic']);
    expect(policy.fallbackProviders).toEqual([{ provider: 'openai', model: 'gpt-4.1-mini' }]);
    expect(policy.policyTier).toBe('standard');
    expect(policy.cacheDiscipline).toBe('stable_prefix');
  });
});

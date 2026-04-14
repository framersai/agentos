import { describe, expect, it } from 'vitest';

import {
  BASE_AGENT_CONFIG_CAPABILITY_CONTRACT,
  getCapabilitySupport,
} from '../capabilityContract.js';

describe('capabilityContract', () => {
  it('classifies lightweight agent emergent support as deferred', () => {
    expect(getCapabilitySupport('agent', 'emergent')).toBe('accepted_but_deferred');
  });

  it('classifies runtime emergent support as enforced', () => {
    expect(getCapabilitySupport('runtime', 'emergent')).toBe('enforced');
  });

  it('classifies generation helper tool support as enforced', () => {
    expect(getCapabilitySupport('generation', 'tools')).toBe('enforced');
  });

  it('covers representative shared config keys', () => {
    expect(BASE_AGENT_CONFIG_CAPABILITY_CONTRACT.guardrails.agent).toBeDefined();
    expect(BASE_AGENT_CONFIG_CAPABILITY_CONTRACT.permissions.runtime).toBeDefined();
    expect(BASE_AGENT_CONFIG_CAPABILITY_CONTRACT.discovery.agent).toBeDefined();
  });
});

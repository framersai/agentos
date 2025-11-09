import { describe, expect, it } from 'vitest';

import { AgencyRegistry } from '../../src/core/agency/AgencyRegistry';
import type { AgencyUpsertArgs } from '../../src/core/agency/AgencyTypes';

describe('AgencyRegistry', () => {
  const baseArgs: AgencyUpsertArgs = {
    workflowId: 'workflow-1',
    conversationId: 'conversation-1',
  };

  it('creates a new agency when none exists', () => {
    const registry = new AgencyRegistry();
    const session = registry.upsertAgency(baseArgs);
    expect(session.agencyId).toBeDefined();
    expect(session.workflowId).toBe(baseArgs.workflowId);
    expect(registry.getAgency(session.agencyId)).toEqual(session);
  });

  it('reuses existing agency when workflow already mapped', () => {
    const registry = new AgencyRegistry();
    const first = registry.upsertAgency(baseArgs);
    const second = registry.upsertAgency({ ...baseArgs, metadata: { foo: 'bar' } });
    expect(second.agencyId).toBe(first.agencyId);
    expect(second.metadata?.foo).toBe('bar');
  });

  it('registers seats and retrieves agency by workflow id', () => {
    const registry = new AgencyRegistry();
    const session = registry.upsertAgency(baseArgs);
    registry.registerSeat({
      agencyId: session.agencyId,
      roleId: 'researcher',
      gmiInstanceId: 'gmi-1',
      personaId: 'persona-1',
    });
    const resolved = registry.getAgencyByWorkflow(baseArgs.workflowId);
    expect(resolved?.seats['researcher']).toBeDefined();
    expect(resolved?.seats['researcher'].gmiInstanceId).toBe('gmi-1');
  });

  it('removes agencies and clears workflow mappings', () => {
    const registry = new AgencyRegistry();
    const session = registry.upsertAgency(baseArgs);
    expect(registry.removeAgency(session.agencyId)).toBe(true);
    expect(registry.getAgency(session.agencyId)).toBeUndefined();
    expect(registry.getAgencyByWorkflow(baseArgs.workflowId)).toBeUndefined();
  });
});

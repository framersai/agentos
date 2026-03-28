import { describe, expect, it, vi } from 'vitest';
import { AgentOSTurnPlanner } from '../TurnPlanner.js';
import type { CapabilityDiscoveryResult } from '../../../discovery/types.js';

describe('AgentOSTurnPlanner capability discovery exclusions', () => {
  it('passes excluded capability ids into discovery queries', async () => {
    const discoveryResult = makeDiscoveryResult();
    const discover = vi.fn().mockResolvedValue(discoveryResult);
    const renderForPrompt = vi.fn().mockReturnValue('filtered capability context');
    const discoveryEngine = {
      isInitialized: vi.fn().mockReturnValue(true),
      discover,
      renderForPrompt,
    } as any;

    const planner = new AgentOSTurnPlanner(
      {
        discovery: {
          enabled: true,
          includePromptContext: true,
        },
      },
      discoveryEngine,
    );

    const plan = await planner.planTurn({
      userId: 'user-1',
      sessionId: 'session-1',
      persona: { id: 'persona-1' } as any,
      userMessage: 'find research help',
      excludedCapabilityIds: ['research-skill'],
    });

    expect(discover).toHaveBeenCalledWith(
      'find research help',
      expect.objectContaining({
        excludedCapabilityIds: ['research-skill'],
      }),
    );
    expect(plan.capability.result).toBe(discoveryResult);
    expect(plan.capability.promptContext).toBe('filtered capability context');
  });
});

function makeDiscoveryResult(): CapabilityDiscoveryResult {
  return {
    tier0: 'Available capability categories:\n- Information: web-search (1)',
    tier1: [
      {
        capability: {
          id: 'tool:web-search',
          kind: 'tool',
          name: 'web-search',
          displayName: 'Web Search',
          description: 'Search the web.',
          category: 'information',
          tags: [],
          requiredSecrets: [],
          requiredTools: [],
          available: true,
          sourceRef: { type: 'tool', toolName: 'web-search' },
        },
        relevanceScore: 0.9,
        summaryText: '1. web-search (tool, 0.90): Search the web.',
      },
    ],
    tier2: [],
    tokenEstimate: {
      tier0Tokens: 10,
      tier1Tokens: 12,
      tier2Tokens: 0,
      totalTokens: 22,
    },
    diagnostics: {
      queryTimeMs: 3,
      embeddingTimeMs: 1,
      graphTraversalTimeMs: 1,
      candidatesScanned: 1,
      capabilitiesRetrieved: 1,
    },
  };
}

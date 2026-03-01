import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentOSTurnPlanner,
  type TurnPlannerConfig,
} from '../../src/core/orchestration/TurnPlanner.js';
import type {
  CapabilityDiscoveryResult,
  ICapabilityDiscoveryEngine,
} from '../../src/discovery/types.js';

function makeResult(): CapabilityDiscoveryResult {
  return {
    tier0: 'Available capability categories: tools, skills',
    tier1: [
      {
        capability: {
          id: 'tool:web-search',
          kind: 'tool',
          name: 'web-search',
          displayName: 'Web Search',
          description: 'Search web content',
          category: 'information',
          tags: ['search'],
          requiredSecrets: [],
          requiredTools: [],
          available: true,
          sourceRef: { type: 'tool', toolName: 'web-search' },
        },
        relevanceScore: 0.9,
        summaryText: 'web-search',
      },
    ],
    tier2: [],
    tokenEstimate: {
      tier0Tokens: 10,
      tier1Tokens: 20,
      tier2Tokens: 0,
      totalTokens: 30,
    },
    diagnostics: {
      queryTimeMs: 5,
      embeddingTimeMs: 3,
      graphTraversalTimeMs: 1,
      candidatesScanned: 12,
      capabilitiesRetrieved: 1,
    },
  };
}

function createDiscoveryEngine(
  overrides: Partial<ICapabilityDiscoveryEngine> = {},
): ICapabilityDiscoveryEngine {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue(makeResult()),
    getCapabilityDetail: vi.fn().mockReturnValue(undefined),
    refreshIndex: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    listCapabilityIds: vi.fn().mockReturnValue(['tool:web-search']),
    ...overrides,
  };
}

const persona = {
  id: 'tester',
  name: 'Tester',
  description: 'test persona',
  version: '1.0.0',
  baseSystemPrompt: 'You are a test persona.',
  allowedCapabilities: [],
} as any;

describe('AgentOSTurnPlanner', () => {
  let discoveryEngine: ICapabilityDiscoveryEngine;

  beforeEach(() => {
    discoveryEngine = createDiscoveryEngine();
  });

  it('uses fail_open defaults and discovery-selected tools', async () => {
    const planner = new AgentOSTurnPlanner({}, discoveryEngine);
    const plan = await planner.planTurn({
      userId: 'u1',
      sessionId: 's1',
      persona,
      userMessage: 'search latest AI news',
    });

    expect(plan.policy.toolFailureMode).toBe('fail_open');
    expect(plan.policy.toolSelectionMode).toBe('discovered');
    expect(plan.capability.selectedToolNames).toContain('web-search');
    expect(plan.capability.result?.tier1.length).toBeGreaterThan(0);
    expect(plan.diagnostics.discoveryAttempts).toBeGreaterThan(0);
    expect(plan.diagnostics.usedFallback).toBe(false);
  });

  it('honors per-request failure-mode override', async () => {
    const planner = new AgentOSTurnPlanner({}, discoveryEngine);
    const plan = await planner.planTurn({
      userId: 'u1',
      sessionId: 's1',
      persona,
      userMessage: 'plan deployment',
      options: {
        customFlags: {
          toolFailureMode: 'fail_closed',
          toolSelectionMode: 'all',
        },
      },
    });

    expect(plan.policy.toolFailureMode).toBe('fail_closed');
    expect(plan.policy.toolSelectionMode).toBe('all');
  });

  it('throws in fail_closed mode when discovery fails', async () => {
    const failingDiscovery = createDiscoveryEngine({
      discover: vi.fn().mockRejectedValue(new Error('embedding failure')),
    });
    const config: TurnPlannerConfig = {
      defaultToolFailureMode: 'fail_closed',
      discovery: { enabled: true },
    };
    const planner = new AgentOSTurnPlanner(config, failingDiscovery);

    await expect(
      planner.planTurn({
        userId: 'u1',
        sessionId: 's1',
        persona,
        userMessage: 'search incident timeline',
      }),
    ).rejects.toThrow(/fail-closed/i);
  });

  it('falls back to all tools in fail_open mode when discovery fails', async () => {
    const failingDiscovery = createDiscoveryEngine({
      discover: vi.fn().mockRejectedValue(new Error('embedding failure')),
    });
    const planner = new AgentOSTurnPlanner(
      { defaultToolFailureMode: 'fail_open' },
      failingDiscovery,
    );
    const plan = await planner.planTurn({
      userId: 'u1',
      sessionId: 's1',
      persona,
      userMessage: 'search incident timeline',
    });

    expect(plan.policy.toolFailureMode).toBe('fail_open');
    expect(plan.policy.toolSelectionMode).toBe('all');
    expect(plan.capability.fallbackReason).toMatch(/Discovery failed/i);
    expect(plan.capability.fallbackApplied).toBe(true);
    expect(plan.diagnostics.usedFallback).toBe(true);
  });
});

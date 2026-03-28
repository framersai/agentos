import { describe, expect, it } from 'vitest';
import type { CapabilityDiscoveryResult } from '../../discovery/types.js';
import type { AgentOSInput } from '../types/AgentOSInput.js';
import {
  applySelfImprovementSessionOverrides,
  buildSelfImprovementSkillPromptContext,
  buildSelfImprovementSessionRuntimeKey,
  disableSelfImprovementSessionSkill,
  enableSelfImprovementSessionSkill,
  filterCapabilityDiscoveryResultByDisabledSkills,
  setSelfImprovementRuntimeParam,
  type SelfImprovementSessionRuntimeState,
} from '../selfImprovementRuntime.js';

describe('AgentOS self-improvement runtime overrides', () => {
  it('applies stored temperature overrides to later turns unless explicitly overridden', () => {
    const runtimeStore = new Map<string, SelfImprovementSessionRuntimeState>();
    const sessionKey = buildSelfImprovementSessionRuntimeKey('session-1');

    setSelfImprovementRuntimeParam(runtimeStore, sessionKey, 'temperature', 0.2);
    setSelfImprovementRuntimeParam(runtimeStore, sessionKey, 'verbosity', 'high');

    const input: AgentOSInput = {
      userId: 'user-1',
      sessionId: 'session-1',
      textInput: 'hello',
    };

    const merged = applySelfImprovementSessionOverrides(runtimeStore, input);
    expect(merged.options).toEqual({ temperature: 0.2 });
    expect(merged.userContextOverride?.preferences).toEqual({ verbosity: 'high' });

    const explicit = applySelfImprovementSessionOverrides(runtimeStore, {
      ...input,
      options: { temperature: 0.9 },
    });
    expect(explicit.options?.temperature).toBe(0.9);
  });

  it('scopes overrides by session id', () => {
    const runtimeStore = new Map<string, SelfImprovementSessionRuntimeState>();
    const sessionKey = buildSelfImprovementSessionRuntimeKey('session-1');

    setSelfImprovementRuntimeParam(runtimeStore, sessionKey, 'temperature', 0.2);

    const otherSession = applySelfImprovementSessionOverrides(runtimeStore, {
      userId: 'user-1',
      sessionId: 'session-2',
      textInput: 'hello',
    } satisfies AgentOSInput);

    expect(otherSession.options).toBeUndefined();
    expect(otherSession.userContextOverride).toBeUndefined();
  });

  it('builds session skill prompt context from enabled skills and disabled markers', () => {
    const runtimeStore = new Map<string, SelfImprovementSessionRuntimeState>();
    const sessionKey = buildSelfImprovementSessionRuntimeKey('session-1');

    enableSelfImprovementSessionSkill(runtimeStore, sessionKey, {
      skillId: 'research-skill',
      name: 'Research Skill',
      category: 'research',
      description: 'Finds and synthesizes information.',
      content: 'Use web search, compare sources, and cite the strongest evidence.',
    });
    disableSelfImprovementSessionSkill(runtimeStore, sessionKey, 'finance-skill');

    const promptContext = buildSelfImprovementSkillPromptContext(runtimeStore, sessionKey);

    expect(promptContext).toContain('Session Skill Modules');
    expect(promptContext).toContain('Research Skill');
    expect(promptContext).toContain('Disabled session skills: finance-skill');
  });

  it('treats skill ids and names as aliases when disabling and re-enabling session skills', () => {
    const runtimeStore = new Map<string, SelfImprovementSessionRuntimeState>();
    const sessionKey = buildSelfImprovementSessionRuntimeKey('session-1');
    const skill = {
      skillId: 'skill-123',
      name: 'research-skill',
      category: 'research',
    };

    enableSelfImprovementSessionSkill(runtimeStore, sessionKey, skill);
    disableSelfImprovementSessionSkill(runtimeStore, sessionKey, 'research-skill');

    expect(buildSelfImprovementSkillPromptContext(runtimeStore, sessionKey)).toContain(
      'Disabled session skills: research-skill',
    );
    expect(
      filterCapabilityDiscoveryResultByDisabledSkills(makeDiscoveryResult(), ['research-skill']).tier1,
    ).toHaveLength(1);

    enableSelfImprovementSessionSkill(runtimeStore, sessionKey, skill);

    const promptContext = buildSelfImprovementSkillPromptContext(runtimeStore, sessionKey);
    expect(promptContext).toContain('research-skill');
    expect(promptContext).not.toContain('Disabled session skills: research-skill');
  });

  it('filters disabled skills out of discovery results and renumbers summaries', () => {
    const filtered = filterCapabilityDiscoveryResultByDisabledSkills(makeDiscoveryResult(), [
      'research-skill',
    ]);

    expect(filtered.tier0).not.toContain('research-skill');
    expect(filtered.tier1).toHaveLength(1);
    expect(filtered.tier1[0]?.capability.name).toBe('web-search');
    expect(filtered.tier1[0]?.summaryText).toBe('1. web-search (tool, 0.84): Search the web.');
    expect(filtered.tier2).toHaveLength(1);
    expect(filtered.tier2[0]?.capability.name).toBe('web-search');
    expect(filtered.diagnostics.capabilitiesRetrieved).toBe(2);
  });
});

function makeDiscoveryResult(): CapabilityDiscoveryResult {
  return {
    tier0: 'Available capability categories:\n- Research: research-skill (1)\n- Tools: web-search (1)',
    tier1: [
      {
        capability: {
          id: 'skill:research-skill',
          kind: 'skill',
          name: 'research-skill',
          displayName: 'Research Skill',
          description: 'Research workflow guidance.',
          category: 'research',
          tags: [],
          requiredSecrets: [],
          requiredTools: ['web-search'],
          available: true,
          fullContent: 'Use web-search and synthesize multiple sources.',
          sourceRef: { type: 'skill', skillName: 'research-skill' },
        },
        relevanceScore: 0.91,
        summaryText: '1. research-skill (skill, 0.91): Research workflow guidance.',
      },
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
        relevanceScore: 0.84,
        summaryText: '2. web-search (tool, 0.84): Search the web.',
      },
    ],
    tier2: [
      {
        capability: {
          id: 'skill:research-skill',
          kind: 'skill',
          name: 'research-skill',
          displayName: 'Research Skill',
          description: 'Research workflow guidance.',
          category: 'research',
          tags: [],
          requiredSecrets: [],
          requiredTools: ['web-search'],
          available: true,
          fullContent: 'Use web-search and synthesize multiple sources.',
          sourceRef: { type: 'skill', skillName: 'research-skill' },
        },
        fullText: 'Research Skill full content',
      },
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
        fullText: 'Web Search full schema',
      },
    ],
    tokenEstimate: {
      tier0Tokens: 18,
      tier1Tokens: 24,
      tier2Tokens: 16,
      totalTokens: 58,
    },
    diagnostics: {
      queryTimeMs: 5,
      embeddingTimeMs: 1,
      graphTraversalTimeMs: 1,
      candidatesScanned: 2,
      capabilitiesRetrieved: 4,
    },
  };
}

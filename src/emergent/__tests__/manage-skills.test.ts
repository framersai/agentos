/**
 * @fileoverview Tests for ManageSkillsTool.
 *
 * Covers:
 *  1. Enable a skill when wildcard allowlist is set
 *  2. Enable a skill by exact skillId match in allowlist
 *  3. Enable a skill via category-based allowlist entry
 *  4. Enable a skill via same-category expansion (active skill shares category)
 *  5. Require approval for a new category when requireApprovalForNewCategories is true
 *  6. Deny skill when not in allowlist and approval not required
 *  7. Reject disabling a locked skill
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManageSkillsTool, type ManageSkillsDeps } from '../ManageSkillsTool.js';
import type { ToolExecutionContext } from '../../core/tools/ITool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ToolExecutionContext for testing. */
function makeContext(): ToolExecutionContext {
  return {
    gmiId: 'test-gmi',
    personaId: 'test-persona',
    userContext: { userId: 'test-user' } as any,
    correlationId: 'test-session',
  };
}

/** Build default deps with sensible mocks. */
function makeDeps(overrides?: Partial<ManageSkillsDeps>): ManageSkillsDeps {
  return {
    config: {
      allowlist: ['*'],
      requireApprovalForNewCategories: false,
    },
    getActiveSkills: () => [],
    getLockedSkills: () => [],
    loadSkill: vi.fn().mockResolvedValue({
      skillId: 'data-analysis',
      name: 'Data Analysis',
      category: 'analytics',
    }),
    unloadSkill: vi.fn(),
    searchSkills: vi.fn().mockReturnValue([
      {
        skillId: 'web-search',
        name: 'Web Search',
        category: 'research',
        description: 'Search the web for information.',
      },
    ]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManageSkillsTool', () => {
  const ctx = makeContext();

  it('should enable a skill when wildcard allowlist is set', async () => {
    const deps = makeDeps({ config: { allowlist: ['*'], requireApprovalForNewCategories: false } });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'enable', skillId: 'data-analysis' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output.status).toBe('enabled');
    expect(result.output.skill.skillId).toBe('data-analysis');
    expect(deps.loadSkill).toHaveBeenCalledWith('data-analysis');
  });

  it('should enable a skill by exact skillId match in allowlist', async () => {
    const deps = makeDeps({
      config: { allowlist: ['data-analysis'], requireApprovalForNewCategories: true },
    });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'enable', skillId: 'data-analysis' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output.status).toBe('enabled');
  });

  it('should enable a skill via category-based allowlist entry', async () => {
    const deps = makeDeps({
      config: { allowlist: ['category:analytics'], requireApprovalForNewCategories: true },
    });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'enable', skillId: 'data-analysis' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output.status).toBe('enabled');
  });

  it('should enable a skill via same-category expansion', async () => {
    const deps = makeDeps({
      config: { allowlist: [], requireApprovalForNewCategories: true },
      getActiveSkills: () => [
        { skillId: 'metric-tracker', name: 'Metric Tracker', category: 'analytics' },
      ],
    });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'enable', skillId: 'data-analysis' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output.status).toBe('enabled');
  });

  it('should require approval for a new category when configured', async () => {
    const deps = makeDeps({
      config: { allowlist: [], requireApprovalForNewCategories: true },
      getActiveSkills: () => [],
    });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'enable', skillId: 'data-analysis' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output.status).toBe('requires_approval');
    expect(result.output.category).toBe('analytics');
    // Should unload the speculatively loaded skill
    expect(deps.unloadSkill).toHaveBeenCalledWith('data-analysis');
  });

  it('should deny skill when not in allowlist and approval not required', async () => {
    const deps = makeDeps({
      config: { allowlist: [], requireApprovalForNewCategories: false },
      getActiveSkills: () => [],
    });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'enable', skillId: 'data-analysis' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not permitted');
    expect(deps.unloadSkill).toHaveBeenCalledWith('data-analysis');
  });

  it('should reject disabling a locked skill', async () => {
    const deps = makeDeps({
      getLockedSkills: () => ['core-reasoning'],
    });
    const tool = new ManageSkillsTool(deps);

    const result = await tool.execute({ action: 'disable', skillId: 'core-reasoning' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
    expect(deps.unloadSkill).not.toHaveBeenCalled();
  });
});

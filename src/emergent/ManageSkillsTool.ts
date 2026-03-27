/**
 * @fileoverview ManageSkillsTool — ITool implementation that enables agents to
 * dynamically enable, disable, and search for skills at runtime.
 *
 * @module @framers/agentos/emergent/ManageSkillsTool
 *
 * Agents call `manage_skills` to self-modify their active skill set. The tool
 * enforces an allowlist-based permission model:
 * - Wildcard (`'*'`) allows all skills unconditionally.
 * - Exact skill ID matches are always permitted.
 * - Category-based allowlist entries (`'category:X'`) permit any skill in that category.
 * - Same-category expansion: if any skill in category X is already active, other
 *   skills in X are also permitted without explicit allowlist entry.
 * - New categories may require approval when `requireApprovalForNewCategories` is set.
 *
 * Locked skills cannot be disabled.
 */

import type {
  ITool,
  ToolExecutionResult,
  ToolExecutionContext,
  JSONSchemaObject,
} from '../core/tools/ITool.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal skill descriptor used for active skill listing and search results.
 */
export interface SkillDescriptor {
  /** Unique skill identifier. */
  skillId: string;
  /** Human-readable skill name. */
  name: string;
  /** Category the skill belongs to. */
  category: string;
}

/**
 * Extended skill descriptor returned by search, including a description.
 */
export interface SkillSearchResult extends SkillDescriptor {
  /** Natural language description of the skill's purpose. */
  description: string;
}

// ============================================================================
// INPUT TYPE
// ============================================================================

/**
 * Input arguments accepted by the `manage_skills` tool.
 * Discriminated on the `action` field.
 */
export interface ManageSkillsInput extends Record<string, any> {
  /** The action to perform: enable, disable, search, or list. */
  action: 'enable' | 'disable' | 'search' | 'list';
  /** Skill ID to enable or disable (required for enable/disable). */
  skillId?: string;
  /** Search query string (required for search). */
  query?: string;
}

// ============================================================================
// CONSTRUCTOR DEPS
// ============================================================================

/**
 * Dependencies injected into the {@link ManageSkillsTool} constructor.
 */
export interface ManageSkillsDeps {
  /** Configuration controlling allowlist and approval requirements. */
  config: {
    /**
     * Allowlist of permitted skill IDs or patterns.
     * - `['*']` → all skills allowed.
     * - Exact skill IDs are matched literally.
     * - `'category:X'` → any skill in category X is allowed.
     */
    allowlist: string[];
    /** Whether enabling skills in new categories requires approval. */
    requireApprovalForNewCategories: boolean;
  };
  /** Returns the currently active skills for the agent. */
  getActiveSkills: () => SkillDescriptor[];
  /** Returns the list of skill IDs that cannot be disabled. */
  getLockedSkills: () => string[];
  /** Load and activate a skill by its ID. Returns the skill descriptor. */
  loadSkill: (id: string) => Promise<SkillDescriptor>;
  /** Unload and deactivate a skill by its ID. */
  unloadSkill: (id: string) => void;
  /** Search for available skills matching a query string. */
  searchSkills: (query: string) => SkillSearchResult[];
}

// ============================================================================
// TOOL IMPLEMENTATION
// ============================================================================

/**
 * ITool implementation enabling agents to dynamically manage their skill set
 * at runtime, subject to allowlist and lock constraints.
 *
 * @example
 * ```ts
 * const tool = new ManageSkillsTool({
 *   config: { allowlist: ['*'], requireApprovalForNewCategories: false },
 *   getActiveSkills: () => agent.skills,
 *   getLockedSkills: () => ['core-reasoning'],
 *   loadSkill: (id) => skillRegistry.load(id),
 *   unloadSkill: (id) => skillRegistry.unload(id),
 *   searchSkills: (q) => skillRegistry.search(q),
 * });
 * ```
 */
export class ManageSkillsTool implements ITool<ManageSkillsInput> {
  /** @inheritdoc */
  readonly id = 'com.framers.emergent.manage-skills';

  /** @inheritdoc */
  readonly name = 'manage_skills';

  /** @inheritdoc */
  readonly displayName = 'Manage Skills';

  /** @inheritdoc */
  readonly description =
    'Enable, disable, search, or list skills available to this agent. ' +
    'Subject to allowlist and lock constraints.';

  /** @inheritdoc */
  readonly category = 'emergent';

  /** @inheritdoc */
  readonly hasSideEffects = true;

  /** @inheritdoc */
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['enable', 'disable', 'search', 'list'],
        description: 'The skill management action to perform.',
      },
      skillId: {
        type: 'string',
        description: 'Skill ID to enable or disable.',
      },
      query: {
        type: 'string',
        description: 'Search query for finding skills.',
      },
    },
    required: ['action'],
  };

  /** Injected dependencies. */
  private readonly deps: ManageSkillsDeps;

  /**
   * Create a new ManageSkillsTool.
   *
   * @param deps - Injected dependencies including config, skill accessors,
   *   and loader/unloader functions.
   */
  constructor(deps: ManageSkillsDeps) {
    this.deps = deps;
  }

  // --------------------------------------------------------------------------
  // EXECUTE
  // --------------------------------------------------------------------------

  /**
   * Execute the requested skill management action.
   *
   * @param args - Action type and associated parameters.
   * @param _context - Tool execution context (unused but required by ITool).
   * @returns A {@link ToolExecutionResult} wrapping the action outcome.
   */
  async execute(
    args: ManageSkillsInput,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    switch (args.action) {
      case 'enable':
        return this.handleEnable(args.skillId);
      case 'disable':
        return this.handleDisable(args.skillId);
      case 'search':
        return this.handleSearch(args.query);
      case 'list':
        return this.handleList();
      default:
        return {
          success: false,
          error: `Unknown action "${args.action}". Must be one of: enable, disable, search, list`,
        };
    }
  }

  // --------------------------------------------------------------------------
  // ACTION HANDLERS
  // --------------------------------------------------------------------------

  /**
   * Enable a skill after checking allowlist permissions.
   *
   * Allowlist resolution order:
   * 1. `['*']` → always allowed
   * 2. Exact skillId match → allowed
   * 3. `'category:X'` in allowlist and skill.category === X → allowed
   * 4. Skill's category already represented in active skills → allowed (same-category expansion)
   * 5. Otherwise → `requires_approval` if requireApprovalForNewCategories, else `denied`
   */
  private async handleEnable(
    skillId: string | undefined,
  ): Promise<ToolExecutionResult> {
    if (!skillId) {
      return { success: false, error: 'skillId is required for the enable action' };
    }

    // Load the skill first to get its metadata
    let skill: SkillDescriptor;
    try {
      skill = await this.deps.loadSkill(skillId);
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to load skill "${skillId}": ${err.message ?? String(err)}`,
      };
    }

    // Resolve allowlist permission
    const permissionResult = this.resolvePermission(skill);

    if (permissionResult === 'allowed') {
      return {
        success: true,
        output: {
          status: 'enabled',
          skill: { skillId: skill.skillId, name: skill.name, category: skill.category },
        },
      };
    }

    // Not allowed — unload the skill we speculatively loaded
    try {
      this.deps.unloadSkill(skillId);
    } catch {
      // Best-effort unload; skill may not have been fully registered
    }

    if (permissionResult === 'requires_approval') {
      return {
        success: true,
        output: {
          status: 'requires_approval',
          skillId,
          category: skill.category,
          reason: `Skill category "${skill.category}" is new and requires approval.`,
        },
      };
    }

    return {
      success: false,
      error: `Skill "${skillId}" is not permitted by the allowlist.`,
    };
  }

  /**
   * Resolve whether a skill is permitted by the allowlist configuration.
   *
   * @returns `'allowed'`, `'requires_approval'`, or `'denied'`
   */
  private resolvePermission(
    skill: SkillDescriptor,
  ): 'allowed' | 'requires_approval' | 'denied' {
    const { allowlist, requireApprovalForNewCategories } = this.deps.config;

    // 1. Wildcard
    if (allowlist.includes('*')) {
      return 'allowed';
    }

    // 2. Exact skill ID match
    if (allowlist.includes(skill.skillId)) {
      return 'allowed';
    }

    // 3. Category-based allowlist entry
    if (allowlist.includes(`category:${skill.category}`)) {
      return 'allowed';
    }

    // 4. Same-category expansion: category already represented in active skills
    const activeSkills = this.deps.getActiveSkills();
    const activeCategories = new Set(activeSkills.map((s) => s.category));
    if (activeCategories.has(skill.category)) {
      return 'allowed';
    }

    // 5. Otherwise — requires approval or denied
    return requireApprovalForNewCategories ? 'requires_approval' : 'denied';
  }

  /**
   * Disable a skill, rejecting if it is locked.
   */
  private async handleDisable(
    skillId: string | undefined,
  ): Promise<ToolExecutionResult> {
    if (!skillId) {
      return { success: false, error: 'skillId is required for the disable action' };
    }

    const lockedSkills = this.deps.getLockedSkills();
    if (lockedSkills.includes(skillId)) {
      return {
        success: false,
        error: `Skill "${skillId}" is locked and cannot be disabled.`,
      };
    }

    this.deps.unloadSkill(skillId);

    return {
      success: true,
      output: { status: 'disabled', skillId },
    };
  }

  /**
   * Search for available skills by query string.
   */
  private async handleSearch(
    query: string | undefined,
  ): Promise<ToolExecutionResult> {
    if (!query) {
      return { success: false, error: 'query is required for the search action' };
    }

    const results = this.deps.searchSkills(query);

    return {
      success: true,
      output: { results },
    };
  }

  /**
   * List currently active skills.
   */
  private async handleList(): Promise<ToolExecutionResult> {
    const skills = this.deps.getActiveSkills();

    return {
      success: true,
      output: { skills },
    };
  }
}

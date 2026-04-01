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
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
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
    getActiveSkills: (context?: ToolExecutionContext) => SkillDescriptor[];
    /** Returns the list of skill IDs that cannot be disabled. */
    getLockedSkills: () => string[];
    /** Load and activate a skill by its ID. Returns the skill descriptor. */
    loadSkill: (id: string, context?: ToolExecutionContext) => Promise<SkillDescriptor>;
    /** Unload and deactivate a skill by its ID. */
    unloadSkill: (id: string, context?: ToolExecutionContext) => void;
    /** Search for available skills matching a query string. */
    searchSkills: (query: string, context?: ToolExecutionContext) => SkillSearchResult[];
}
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
export declare class ManageSkillsTool implements ITool<ManageSkillsInput> {
    /** @inheritdoc */
    readonly id = "com.framers.emergent.manage-skills";
    /** @inheritdoc */
    readonly name = "manage_skills";
    /** @inheritdoc */
    readonly displayName = "Manage Skills";
    /** @inheritdoc */
    readonly description: string;
    /** @inheritdoc */
    readonly category = "emergent";
    /** @inheritdoc */
    readonly hasSideEffects = true;
    /** @inheritdoc */
    readonly inputSchema: JSONSchemaObject;
    /** Injected dependencies. */
    private readonly deps;
    /** Session-local active skill overlays. */
    private readonly sessionStates;
    /**
     * Create a new ManageSkillsTool.
     *
     * @param deps - Injected dependencies including config, skill accessors,
     *   and loader/unloader functions.
     */
    constructor(deps: ManageSkillsDeps);
    /**
     * Execute the requested skill management action.
     *
     * @param args - Action type and associated parameters.
     * @param _context - Tool execution context (unused but required by ITool).
     * @returns A {@link ToolExecutionResult} wrapping the action outcome.
     */
    execute(args: ManageSkillsInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
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
    private handleEnable;
    /**
     * Resolve whether a skill is permitted by the allowlist configuration.
     *
     * @returns `'allowed'`, `'requires_approval'`, or `'denied'`
     */
    private resolvePermission;
    /**
     * Disable a skill, rejecting if it is locked.
     */
    private handleDisable;
    /**
     * Search for available skills by query string.
     */
    private handleSearch;
    /**
     * List currently active skills.
     */
    private handleList;
    private getEffectiveActiveSkills;
    private getSessionState;
}
//# sourceMappingURL=ManageSkillsTool.d.ts.map
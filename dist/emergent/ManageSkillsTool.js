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
import { resolveSelfImprovementSessionKey } from './sessionScope.js';
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
export class ManageSkillsTool {
    /**
     * Create a new ManageSkillsTool.
     *
     * @param deps - Injected dependencies including config, skill accessors,
     *   and loader/unloader functions.
     */
    constructor(deps) {
        /** @inheritdoc */
        this.id = 'com.framers.emergent.manage-skills';
        /** @inheritdoc */
        this.name = 'manage_skills';
        /** @inheritdoc */
        this.displayName = 'Manage Skills';
        /** @inheritdoc */
        this.description = 'Enable, disable, search, or list skills available to this agent. ' +
            'Subject to allowlist and lock constraints.';
        /** @inheritdoc */
        this.category = 'emergent';
        /** @inheritdoc */
        this.hasSideEffects = true;
        /** @inheritdoc */
        this.inputSchema = {
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
        /** Session-local active skill overlays. */
        this.sessionStates = new Map();
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
    async execute(args, context) {
        switch (args.action) {
            case 'enable':
                return this.handleEnable(args.skillId, context);
            case 'disable':
                return this.handleDisable(args.skillId, context);
            case 'search':
                return this.handleSearch(args.query, context);
            case 'list':
                return this.handleList(context);
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
    async handleEnable(skillId, context) {
        if (!skillId) {
            return { success: false, error: 'skillId is required for the enable action' };
        }
        const activeSkills = this.getEffectiveActiveSkills(context);
        const existingSkill = activeSkills.find((skill) => skill.skillId === skillId);
        if (existingSkill) {
            return {
                success: true,
                output: {
                    status: 'enabled',
                    alreadyActive: true,
                    skill: existingSkill,
                },
            };
        }
        // Load the skill first to get its metadata
        let skill;
        try {
            skill = await this.deps.loadSkill(skillId, context);
        }
        catch (err) {
            return {
                success: false,
                error: `Failed to load skill "${skillId}": ${err.message ?? String(err)}`,
            };
        }
        // Resolve allowlist permission
        const permissionResult = this.resolvePermission(skill, activeSkills);
        if (permissionResult === 'allowed') {
            const sessionState = this.getSessionState(context);
            sessionState.disabledSkillIds.delete(skill.skillId);
            sessionState.enabledSkills.set(skill.skillId, skill);
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
            this.deps.unloadSkill(skillId, context);
        }
        catch {
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
    resolvePermission(skill, activeSkills = this.deps.getActiveSkills()) {
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
    async handleDisable(skillId, context) {
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
        const activeSkills = this.getEffectiveActiveSkills(context);
        if (!activeSkills.some((skill) => skill.skillId === skillId)) {
            return {
                success: false,
                error: `Skill "${skillId}" is not currently active.`,
            };
        }
        this.deps.unloadSkill(skillId, context);
        const sessionState = this.getSessionState(context);
        sessionState.enabledSkills.delete(skillId);
        sessionState.disabledSkillIds.add(skillId);
        return {
            success: true,
            output: { status: 'disabled', skillId },
        };
    }
    /**
     * Search for available skills by query string.
     */
    async handleSearch(query, context) {
        if (!query) {
            return { success: false, error: 'query is required for the search action' };
        }
        const results = this.deps.searchSkills(query, context);
        return {
            success: true,
            output: { results },
        };
    }
    /**
     * List currently active skills.
     */
    async handleList(context) {
        const skills = this.getEffectiveActiveSkills(context);
        return {
            success: true,
            output: { skills },
        };
    }
    getEffectiveActiveSkills(context) {
        const sessionState = this.getSessionState(context, false);
        const skillsById = new Map();
        for (const skill of this.deps.getActiveSkills(context)) {
            if (!sessionState.disabledSkillIds.has(skill.skillId)) {
                skillsById.set(skill.skillId, skill);
            }
        }
        for (const [skillId, skill] of sessionState.enabledSkills) {
            if (!sessionState.disabledSkillIds.has(skillId)) {
                skillsById.set(skillId, skill);
            }
        }
        return Array.from(skillsById.values());
    }
    getSessionState(context, createIfMissing = true) {
        const sessionKey = resolveSelfImprovementSessionKey(context);
        const existing = this.sessionStates.get(sessionKey);
        if (existing) {
            return existing;
        }
        const emptyState = {
            enabledSkills: new Map(),
            disabledSkillIds: new Set(),
        };
        if (createIfMissing) {
            this.sessionStates.set(sessionKey, emptyState);
        }
        return emptyState;
    }
}
//# sourceMappingURL=ManageSkillsTool.js.map
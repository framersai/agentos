/**
 * @file SelfImprovementSessionManager.ts
 * @module api/SelfImprovementSessionManager
 *
 * @description
 * Manages self-improvement session runtime state: per-session skill
 * activation/deactivation, model option overrides, user preference
 * tracking, and prompt context generation.
 *
 * Previously these concerns were distributed across ~10 private methods
 * inside `AgentOS.ts`. This extraction centralizes session-scoped
 * self-improvement logic into a single focused class.
 *
 * The class also exposes a `buildToolDeps()` factory that assembles the
 * `SelfImprovementToolDeps` closure object required by the emergent
 * capability engine. The closures returned by `buildToolDeps()` reference
 * runtime services lazily through callback accessors, so they resolve
 * against the fully initialized AgentOS at tool-call time, not at
 * bootstrap.
 */
import { PersonalityMutationStore } from '../../emergent/PersonalityMutationStore.js';
import { resolveSelfImprovementSessionKey } from '../../emergent/sessionScope.js';
import { applySelfImprovementSessionOverrides as applySessionRuntimeOverrides, buildSelfImprovementSkillPromptContext as buildSessionSkillPromptContext, buildSelfImprovementSessionRuntimeKey as buildSessionRuntimeKey, disableSelfImprovementSessionSkill as disableSessionSkill, enableSelfImprovementSessionSkill as enableSessionSkill, getSelfImprovementRuntimeParam as getSessionRuntimeParam, listSelfImprovementDisabledSkillIds as listDisabledSessionSkillIds, listSelfImprovementSessionSkills as listSessionSkills, setSelfImprovementRuntimeParam as setSessionRuntimeParam, } from './selfImprovementRuntime.js';
function resolveSessionKey(context) {
    return resolveSelfImprovementSessionKey((context ?? {
        gmiId: 'self-improvement',
        personaId: 'self-improvement',
        userContext: { userId: 'system' },
    }));
}
/**
 * @class SelfImprovementSessionManager
 *
 * Owns the `selfImprovementSessionRuntime` map and exposes all session-scoped
 * operations: key building, param get/set, skill enable/disable, override
 * application, prompt context generation, and tool-deps factory.
 */
export class SelfImprovementSessionManager {
    constructor(logger) {
        this.logger = logger;
        /** Per-session runtime state (model options, user prefs, skills). */
        this.sessionRuntime = new Map();
    }
    // ---------------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------------
    /**
     * Provide a lazy getter for the configured skill catalog. This is called
     * once during AgentOS initialization with a closure that reads the frozen
     * config at call time.
     *
     * @param getter - Callable that returns the current configured skills array.
     */
    setConfiguredSkillsGetter(getter) {
        this.configuredSkillsGetter = getter;
    }
    // ---------------------------------------------------------------------------
    // Session key helpers
    // ---------------------------------------------------------------------------
    /**
     * Build the canonical session runtime key from a session ID.
     *
     * @param sessionId - The raw session identifier.
     * @returns Normalized session key string.
     */
    buildSessionRuntimeKey(sessionId) {
        return buildSessionRuntimeKey(sessionId);
    }
    // ---------------------------------------------------------------------------
    // Parameter access
    // ---------------------------------------------------------------------------
    /**
     * Get a runtime parameter value for a session.
     *
     * @param sessionKey - Canonical session key.
     * @param param      - Parameter name.
     * @returns The stored value, or `undefined`.
     */
    getRuntimeParam(sessionKey, param) {
        return getSessionRuntimeParam(this.sessionRuntime, sessionKey, param);
    }
    /**
     * Set a runtime parameter value for a session.
     *
     * @param sessionKey - Canonical session key.
     * @param param      - Parameter name.
     * @param value      - Value to store.
     */
    setRuntimeParam(sessionKey, param, value) {
        setSessionRuntimeParam(this.sessionRuntime, sessionKey, param, value);
    }
    // ---------------------------------------------------------------------------
    // Session overrides
    // ---------------------------------------------------------------------------
    /**
     * Apply self-improvement session overrides (model options, user preferences)
     * to an `AgentOSInput` payload.
     *
     * @param input - The original input.
     * @returns A new input with merged session overrides.
     */
    applySessionOverrides(input) {
        return applySessionRuntimeOverrides(this.sessionRuntime, input);
    }
    // ---------------------------------------------------------------------------
    // Skill catalog
    // ---------------------------------------------------------------------------
    /**
     * Return the configured discovery skills from the AgentOS config.
     *
     * @returns Array of configured skill descriptors.
     */
    getConfiguredDiscoverySkills() {
        if (this.configuredSkillsGetter) {
            return this.configuredSkillsGetter();
        }
        return [];
    }
    /**
     * Normalize a partial configured skill into a full descriptor.
     *
     * @param skill      - Partial skill data.
     * @param fallbackId - Optional fallback ID when none is available.
     * @returns Normalized skill descriptor.
     */
    normalizeConfiguredSkill(skill, fallbackId) {
        const skillId = String(skill.id ?? skill.name ?? fallbackId ?? 'unknown');
        return {
            skillId,
            name: String(skill.name ?? fallbackId ?? skillId),
            category: String(skill.category ?? 'general'),
            ...(typeof skill.description === 'string' ? { description: skill.description } : {}),
            ...(typeof skill.content === 'string' ? { content: skill.content } : {}),
            ...(typeof skill.sourcePath === 'string' ? { sourcePath: skill.sourcePath } : {}),
        };
    }
    /**
     * Resolve a skill descriptor by ID from the configured skill catalog.
     *
     * @param skillId - The skill identifier to look up.
     * @returns The resolved descriptor, or `undefined` if not found.
     */
    resolveConfiguredSkill(skillId) {
        const configured = this.getConfiguredDiscoverySkills().find((skill) => String(skill.id ?? skill.name ?? '') === skillId);
        return configured ? this.normalizeConfiguredSkill(configured, skillId) : undefined;
    }
    // ---------------------------------------------------------------------------
    // Session skill management
    // ---------------------------------------------------------------------------
    /**
     * List active skills for a session.
     *
     * @param sessionKey - Canonical session key.
     * @returns Array of enabled skill descriptors.
     */
    listSessionSkills(sessionKey) {
        return listSessionSkills(this.sessionRuntime, sessionKey);
    }
    /**
     * List disabled skill IDs for a session.
     *
     * @param sessionKey - Canonical session key.
     * @returns Array of disabled skill identifier strings.
     */
    listDisabledSkillIds(sessionKey) {
        return listDisabledSessionSkillIds(this.sessionRuntime, sessionKey);
    }
    /**
     * Build skill-related prompt context for a session.
     *
     * @param sessionId - The raw session identifier.
     * @returns Prompt context string, or `undefined` when empty.
     */
    buildSkillPromptContext(sessionId) {
        const sessionKey = this.buildSessionRuntimeKey(sessionId);
        return buildSessionSkillPromptContext(this.sessionRuntime, sessionKey);
    }
    // ---------------------------------------------------------------------------
    // SelfImprovementToolDeps factory
    // ---------------------------------------------------------------------------
    /**
     * Build the `SelfImprovementToolDeps` closure object consumed by the
     * emergent capability engine. All closures resolve lazily against the
     * provided runtime accessors.
     *
     * @param storageAdapter - Optional storage adapter for the personality mutation store.
     * @param accessors      - Lazy runtime service accessors.
     * @returns Assembled `SelfImprovementToolDeps`, or `undefined` when no
     *          storage adapter or accessors are available.
     */
    buildToolDeps(storageAdapter, accessors) {
        const mutationStore = storageAdapter
            ? new PersonalityMutationStore({
                run: async (sql, params) => storageAdapter.run(sql, params),
                get: async (sql, params) => storageAdapter.get(sql, params),
                all: async (sql, params) => storageAdapter.all(sql, params),
                exec: async (sql) => storageAdapter.exec(sql),
            })
            : undefined;
        return {
            // --- Personality (HEXACO) ---
            getPersonality: () => {
                try {
                    const gmi = accessors.getActiveGMI();
                    const traits = gmi?.getPersona()?.personalityTraits;
                    if (traits && typeof traits === 'object') {
                        const result = {};
                        for (const [k, v] of Object.entries(traits)) {
                            if (typeof v === 'number')
                                result[k] = v;
                        }
                        return result;
                    }
                }
                catch { /* GMI not ready yet — return empty. */ }
                return {};
            },
            setPersonality: (trait, value) => {
                try {
                    const gmi = accessors.getActiveGMI();
                    const persona = gmi?.getPersona();
                    if (persona) {
                        if (!persona.personalityTraits) {
                            persona.personalityTraits = {};
                        }
                        persona.personalityTraits[trait] = value;
                    }
                }
                catch { /* GMI not ready — ignore. */ }
            },
            mutationStore,
            // --- Skills ---
            getActiveSkills: (context) => {
                const sessionKey = resolveSessionKey(context);
                return this.listSessionSkills(sessionKey).map((skill) => ({
                    skillId: skill.skillId,
                    name: skill.name,
                    category: skill.category,
                }));
            },
            getLockedSkills: () => [],
            loadSkill: async (id, context) => {
                const sessionKey = resolveSessionKey(context);
                const resolvedSkill = this.resolveConfiguredSkill(id) ?? {
                    skillId: id,
                    name: id,
                    category: 'dynamic',
                };
                enableSessionSkill(this.sessionRuntime, sessionKey, resolvedSkill);
                return {
                    skillId: resolvedSkill.skillId,
                    name: resolvedSkill.name,
                    category: resolvedSkill.category,
                };
            },
            unloadSkill: (id, context) => {
                const sessionKey = resolveSessionKey(context);
                const resolvedSkill = this.resolveConfiguredSkill(id);
                disableSessionSkill(this.sessionRuntime, sessionKey, resolvedSkill?.name ?? id);
            },
            searchSkills: (query) => {
                const q = query.toLowerCase();
                return this.getConfiguredDiscoverySkills()
                    .filter((skill) => (skill.name ?? '').toLowerCase().includes(q) ||
                    (skill.description ?? '').toLowerCase().includes(q))
                    .map((skill) => {
                    const normalizedSkill = this.normalizeConfiguredSkill(skill);
                    return {
                        skillId: normalizedSkill.skillId,
                        name: normalizedSkill.name,
                        category: normalizedSkill.category,
                        description: normalizedSkill.description ?? '',
                    };
                });
            },
            // --- Tools ---
            executeTool: async (name, args, context) => {
                const orchestrator = accessors.getToolOrchestrator();
                const tool = await orchestrator.getTool(name);
                if (!tool) {
                    throw new Error(`Tool "${name}" not found in orchestrator.`);
                }
                const result = await tool.execute((args ?? {}), context ?? {
                    gmiId: 'self-improvement',
                    personaId: 'self-improvement',
                    userContext: { userId: 'system' },
                });
                if (!result.success) {
                    throw new Error(result.error ?? `Tool "${name}" failed.`);
                }
                return result.output;
            },
            listTools: () => {
                try {
                    const orchestrator = accessors.getToolOrchestrator();
                    return orchestrator.toolExecutor
                        ?.listAvailableTools()
                        ?.map((t) => t.name) ?? [];
                }
                catch {
                    return [];
                }
            },
            getSessionParam: (param, context) => {
                const sessionKey = resolveSessionKey(context);
                return this.getRuntimeParam(sessionKey, param);
            },
            setSessionParam: (param, value, context) => {
                const sessionKey = resolveSessionKey(context);
                this.setRuntimeParam(sessionKey, param, value);
            },
            // --- Memory ---
            storeMemory: async (trace) => {
                try {
                    const gmi = accessors.getActiveGMI();
                    const mem = gmi?.getCognitiveMemoryManager?.();
                    if (mem) {
                        await mem.encode(`[self-improvement:${trace.type}] ${trace.content}`, { valence: 0, arousal: 0, dominance: 0.5 }, 'neutral', {
                            type: 'semantic',
                            scope: (trace.scope ?? 'agent'),
                            tags: trace.tags,
                        });
                    }
                }
                catch { /* Memory not available — silently skip. */ }
            },
        };
    }
}
//# sourceMappingURL=SelfImprovementSessionManager.js.map
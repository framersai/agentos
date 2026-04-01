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
import type { AgentOSInput } from '../types/AgentOSInput';
import type { ILogger } from '../../logging/ILogger';
import type { SelfImprovementToolDeps } from '../../emergent/EmergentCapabilityEngine.js';
import type { CapabilityIndexSources } from '../../discovery/types';
import type { StorageAdapter } from '@framers/sql-storage-adapter';
import { type SelfImprovementSkillDescriptor } from './selfImprovementRuntime.js';
/**
 * Shape for configured skills discovered from the AgentOS config.
 * Matches the non-null element type of `CapabilityIndexSources['skills']`
 * augmented with an optional `id` field.
 */
type ConfiguredSkill = NonNullable<CapabilityIndexSources['skills']>[number] & {
    id?: string;
};
/**
 * Lazy accessors injected by AgentOS so that `buildToolDeps()` closures
 * can resolve runtime services at tool-call time rather than at bootstrap.
 */
export interface SelfImprovementRuntimeAccessors {
    /** Returns the first active GMI, if any. */
    getActiveGMI: () => any | undefined;
    /** Returns the tool orchestrator instance. */
    getToolOrchestrator: () => import('../core/tools/IToolOrchestrator').IToolOrchestrator;
}
/**
 * @class SelfImprovementSessionManager
 *
 * Owns the `selfImprovementSessionRuntime` map and exposes all session-scoped
 * operations: key building, param get/set, skill enable/disable, override
 * application, prompt context generation, and tool-deps factory.
 */
export declare class SelfImprovementSessionManager {
    private readonly logger;
    /** Per-session runtime state (model options, user prefs, skills). */
    private readonly sessionRuntime;
    /** Skill catalog from config, resolved lazily on first access. */
    private configuredSkillsGetter?;
    constructor(logger: ILogger);
    /**
     * Provide a lazy getter for the configured skill catalog. This is called
     * once during AgentOS initialization with a closure that reads the frozen
     * config at call time.
     *
     * @param getter - Callable that returns the current configured skills array.
     */
    setConfiguredSkillsGetter(getter: () => ConfiguredSkill[]): void;
    /**
     * Build the canonical session runtime key from a session ID.
     *
     * @param sessionId - The raw session identifier.
     * @returns Normalized session key string.
     */
    buildSessionRuntimeKey(sessionId: string): string;
    /**
     * Get a runtime parameter value for a session.
     *
     * @param sessionKey - Canonical session key.
     * @param param      - Parameter name.
     * @returns The stored value, or `undefined`.
     */
    getRuntimeParam(sessionKey: string, param: string): unknown;
    /**
     * Set a runtime parameter value for a session.
     *
     * @param sessionKey - Canonical session key.
     * @param param      - Parameter name.
     * @param value      - Value to store.
     */
    setRuntimeParam(sessionKey: string, param: string, value: unknown): void;
    /**
     * Apply self-improvement session overrides (model options, user preferences)
     * to an `AgentOSInput` payload.
     *
     * @param input - The original input.
     * @returns A new input with merged session overrides.
     */
    applySessionOverrides(input: AgentOSInput): AgentOSInput;
    /**
     * Return the configured discovery skills from the AgentOS config.
     *
     * @returns Array of configured skill descriptors.
     */
    getConfiguredDiscoverySkills(): ConfiguredSkill[];
    /**
     * Normalize a partial configured skill into a full descriptor.
     *
     * @param skill      - Partial skill data.
     * @param fallbackId - Optional fallback ID when none is available.
     * @returns Normalized skill descriptor.
     */
    normalizeConfiguredSkill(skill: Partial<ConfiguredSkill>, fallbackId?: string): SelfImprovementSkillDescriptor;
    /**
     * Resolve a skill descriptor by ID from the configured skill catalog.
     *
     * @param skillId - The skill identifier to look up.
     * @returns The resolved descriptor, or `undefined` if not found.
     */
    resolveConfiguredSkill(skillId: string): SelfImprovementSkillDescriptor | undefined;
    /**
     * List active skills for a session.
     *
     * @param sessionKey - Canonical session key.
     * @returns Array of enabled skill descriptors.
     */
    listSessionSkills(sessionKey: string): SelfImprovementSkillDescriptor[];
    /**
     * List disabled skill IDs for a session.
     *
     * @param sessionKey - Canonical session key.
     * @returns Array of disabled skill identifier strings.
     */
    listDisabledSkillIds(sessionKey: string): string[];
    /**
     * Build skill-related prompt context for a session.
     *
     * @param sessionId - The raw session identifier.
     * @returns Prompt context string, or `undefined` when empty.
     */
    buildSkillPromptContext(sessionId: string): string | undefined;
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
    buildToolDeps(storageAdapter: StorageAdapter | undefined, accessors: SelfImprovementRuntimeAccessors): SelfImprovementToolDeps;
}
export {};
//# sourceMappingURL=SelfImprovementSessionManager.d.ts.map
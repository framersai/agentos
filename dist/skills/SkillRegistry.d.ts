/**
 * @fileoverview Skill Registry for AgentOS
 * @module @framers/agentos/skills/SkillRegistry
 *
 * Runtime registry for managing and querying loaded skills.
 * Provides methods for registration, filtering, and building
 * skill snapshots for agent context.
 */
import type { SkillEntry, SkillSnapshot, SkillEligibilityContext, SkillCommandSpec, SkillsConfig } from './types.js';
/**
 * Registry options for initialization.
 */
export interface SkillRegistryOptions {
    /** Workspace directory containing skills */
    workspaceDir?: string;
    /** Managed/global skills directory (e.g., ~/.codex/skills). */
    managedSkillsDir?: string;
    /** Additional skill directories to scan */
    extraDirs?: string[];
    /** Bundled skills directory */
    bundledSkillsDir?: string;
    /** Skills configuration */
    config?: SkillsConfig;
}
/**
 * Skill Registry for managing loaded skills at runtime.
 */
export declare class SkillRegistry {
    private readonly entries;
    private config?;
    private snapshotVersion;
    constructor(config?: SkillsConfig);
    /**
     * Register a skill entry.
     *
     * @returns Whether the skill was registered (false if already exists)
     */
    register(entry: SkillEntry): boolean;
    /**
     * Unregister a skill by name.
     */
    unregister(name: string): boolean;
    /**
     * Clear all registered skills.
     */
    clear(): void;
    /**
     * Get a skill by name.
     */
    getByName(name: string): SkillEntry | undefined;
    /**
     * List all registered skills.
     */
    listAll(): SkillEntry[];
    /**
     * Get the count of registered skills.
     */
    get size(): number;
    /**
     * Check if a skill is registered.
     */
    has(name: string): boolean;
    /**
     * Load skills from one or more directories.
     */
    loadFromDirs(dirs: string[]): Promise<number>;
    /**
     * Load skills from a single directory, optionally tagging the source.
     */
    loadFromDir(dir: string, options?: {
        source?: string;
    }): Promise<number>;
    /**
     * Reload all skills from configured directories.
     */
    reload(options: SkillRegistryOptions): Promise<number>;
    /**
     * Get skills filtered by platform.
     */
    filterByPlatform(platform: string): SkillEntry[];
    /**
     * Get skills filtered by eligibility context.
     */
    filterByEligibility(context: SkillEligibilityContext): SkillEntry[];
    /**
     * Get skills that can be invoked by users.
     */
    getUserInvocableSkills(): SkillEntry[];
    /**
     * Get skills that can be invoked by the model.
     */
    getModelInvocableSkills(): SkillEntry[];
    /**
     * Build a skill snapshot for agent context.
     */
    buildSnapshot(options?: {
        platform?: string;
        eligibility?: SkillEligibilityContext;
        filter?: string[];
        /**
         * If true, apply OpenClaw-style eligibility gating (OS/bins/anyBins/env/config).
         * This is useful for "only show runnable skills" behavior.
         */
        strict?: boolean;
        /** Optional config object used to evaluate `requires.config` paths. */
        runtimeConfig?: Record<string, unknown>;
    }): SkillSnapshot;
    /**
     * Format skills into a prompt for LLM context.
     */
    buildPrompt(entries: SkillEntry[]): string;
    /**
     * Build command specifications for all skills.
     */
    buildCommandSpecs(options?: {
        platform?: string;
        eligibility?: SkillEligibilityContext;
        reservedNames?: Set<string>;
    }): SkillCommandSpec[];
    /**
     * Check requirements for all registered skills.
     */
    checkAllRequirements(hasBin: (bin: string) => boolean): Map<string, {
        met: boolean;
        missing: string[];
    }>;
    /**
     * Get skills with unmet requirements.
     */
    getSkillsWithMissingRequirements(hasBin: (bin: string) => boolean): Array<{
        skill: string;
        missing: string[];
    }>;
}
//# sourceMappingURL=SkillRegistry.d.ts.map
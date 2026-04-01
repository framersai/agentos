/**
 * @fileoverview Skill Registry for AgentOS
 * @module @framers/agentos/skills/SkillRegistry
 *
 * Runtime registry for managing and querying loaded skills.
 * Provides methods for registration, filtering, and building
 * skill snapshots for agent context.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSkillsFromDir, filterByPlatform, filterByEligibility, checkBinaryRequirements, } from './SkillLoader.js';
/**
 * Skill Registry for managing loaded skills at runtime.
 */
export class SkillRegistry {
    constructor(config) {
        this.entries = new Map();
        this.snapshotVersion = 1;
        this.config = config;
    }
    // ============================================================================
    // REGISTRATION
    // ============================================================================
    /**
     * Register a skill entry.
     *
     * @returns Whether the skill was registered (false if already exists)
     */
    register(entry) {
        const name = entry.skill.name;
        const skillKey = entry.metadata?.skillKey ?? name;
        if (this.entries.has(name)) {
            console.warn(`[SkillRegistry] Skill '${name}' already registered, skipping`);
            return false;
        }
        // If an allowlist is configured, only apply it to bundled skills.
        const allowBundled = normalizeAllowlist(this.config?.allowBundled);
        if (allowBundled && entry.source === 'bundled') {
            if (!allowBundled.includes(skillKey) && !allowBundled.includes(name)) {
                console.log(`[SkillRegistry] Bundled skill '${name}' blocked by allowBundled, skipping`);
                return false;
            }
        }
        // Check if skill is enabled in config
        const skillConfig = this.config?.entries?.[skillKey] ?? this.config?.entries?.[name];
        if (skillConfig?.enabled === false) {
            console.log(`[SkillRegistry] Skill '${name}' disabled in config, skipping`);
            return false;
        }
        this.entries.set(name, entry);
        this.snapshotVersion++;
        return true;
    }
    /**
     * Unregister a skill by name.
     */
    unregister(name) {
        const existed = this.entries.delete(name);
        if (existed) {
            this.snapshotVersion++;
        }
        return existed;
    }
    /**
     * Clear all registered skills.
     */
    clear() {
        this.entries.clear();
        this.snapshotVersion++;
    }
    // ============================================================================
    // QUERIES
    // ============================================================================
    /**
     * Get a skill by name.
     */
    getByName(name) {
        return this.entries.get(name);
    }
    /**
     * List all registered skills.
     */
    listAll() {
        return Array.from(this.entries.values());
    }
    /**
     * Get the count of registered skills.
     */
    get size() {
        return this.entries.size;
    }
    /**
     * Check if a skill is registered.
     */
    has(name) {
        return this.entries.has(name);
    }
    // ============================================================================
    // LOADING
    // ============================================================================
    /**
     * Load skills from one or more directories.
     */
    async loadFromDirs(dirs) {
        let count = 0;
        for (const dir of dirs) {
            count += await this.loadFromDir(dir);
        }
        return count;
    }
    /**
     * Load skills from a single directory, optionally tagging the source.
     */
    async loadFromDir(dir, options) {
        let count = 0;
        const entries = await loadSkillsFromDir(dir);
        for (const entry of entries) {
            if (options?.source) {
                entry.source = options.source;
            }
            if (this.register(entry)) {
                count++;
            }
        }
        return count;
    }
    /**
     * Reload all skills from configured directories.
     */
    async reload(options) {
        this.clear();
        if (options.config) {
            this.config = options.config;
        }
        // Load in high → low precedence order (first registered wins):
        // workspace > managed > bundled > extra.
        let count = 0;
        if (options.workspaceDir) {
            count += await this.loadFromDir(options.workspaceDir, { source: 'workspace' });
        }
        if (options.managedSkillsDir) {
            count += await this.loadFromDir(options.managedSkillsDir, { source: 'managed' });
        }
        if (options.bundledSkillsDir) {
            count += await this.loadFromDir(options.bundledSkillsDir, { source: 'bundled' });
        }
        if (options.extraDirs) {
            for (const dir of options.extraDirs) {
                count += await this.loadFromDir(dir, { source: 'extra' });
            }
        }
        return count;
    }
    // ============================================================================
    // FILTERING
    // ============================================================================
    /**
     * Get skills filtered by platform.
     */
    filterByPlatform(platform) {
        return filterByPlatform(this.listAll(), platform);
    }
    /**
     * Get skills filtered by eligibility context.
     */
    filterByEligibility(context) {
        return filterByEligibility(this.listAll(), context);
    }
    /**
     * Get skills that can be invoked by users.
     */
    getUserInvocableSkills() {
        return this.listAll().filter((entry) => entry.invocation?.userInvocable !== false);
    }
    /**
     * Get skills that can be invoked by the model.
     */
    getModelInvocableSkills() {
        return this.listAll().filter((entry) => entry.invocation?.disableModelInvocation !== true);
    }
    // ============================================================================
    // SNAPSHOTS
    // ============================================================================
    /**
     * Build a skill snapshot for agent context.
     */
    buildSnapshot(options) {
        let entries = this.listAll();
        // Apply platform filter
        if (options?.platform) {
            entries = filterByPlatform(entries, options.platform);
        }
        if (options?.strict) {
            const platform = (options.platform && String(options.platform).trim()) || process.platform;
            entries = entries.filter((entry) => shouldIncludeSkillEntry(entry, {
                platform,
                skillsConfig: this.config,
                runtimeConfig: options.runtimeConfig,
            }));
        }
        // Apply eligibility filter
        if (options?.eligibility) {
            entries = filterByEligibility(entries, options.eligibility);
        }
        // Apply name filter
        if (options?.filter && options.filter.length > 0) {
            const filterSet = new Set(options.filter);
            entries = entries.filter((e) => filterSet.has(e.skill.name));
        }
        // Build prompt
        const prompt = this.buildPrompt(entries);
        // Build skill list
        const skills = entries.map((e) => ({
            name: e.skill.name,
            primaryEnv: e.metadata?.primaryEnv,
        }));
        return {
            prompt,
            skills,
            resolvedSkills: entries.map((e) => e.skill),
            version: this.snapshotVersion,
            createdAt: new Date(),
        };
    }
    /**
     * Format skills into a prompt for LLM context.
     */
    buildPrompt(entries) {
        if (entries.length === 0) {
            return '';
        }
        const sections = entries.map((entry) => {
            const { skill, metadata } = entry;
            const emoji = metadata?.emoji || '\u{1F4E6}';
            const header = `## ${emoji} ${skill.name}`;
            const desc = skill.description ? `\n${skill.description}\n` : '';
            const content = skill.content ? `\n${skill.content}` : '';
            return `${header}${desc}${content}`;
        });
        return `# Available Skills\n\n${sections.join('\n\n---\n\n')}`;
    }
    // ============================================================================
    // COMMANDS
    // ============================================================================
    /**
     * Build command specifications for all skills.
     */
    buildCommandSpecs(options) {
        let entries = this.getUserInvocableSkills();
        if (options?.platform) {
            entries = filterByPlatform(entries, options.platform);
        }
        if (options?.eligibility) {
            entries = filterByEligibility(entries, options.eligibility);
        }
        const reservedNames = options?.reservedNames || new Set();
        const usedNames = new Set(reservedNames);
        const specs = [];
        for (const entry of entries) {
            const baseName = sanitizeCommandName(entry.skill.name);
            const name = resolveUniqueCommandName(baseName, usedNames);
            usedNames.add(name);
            specs.push({
                name,
                skillName: entry.skill.name,
                description: truncateDescription(entry.skill.description),
            });
        }
        return specs;
    }
    // ============================================================================
    // REQUIREMENTS
    // ============================================================================
    /**
     * Check requirements for all registered skills.
     */
    checkAllRequirements(hasBin) {
        const results = new Map();
        for (const entry of this.listAll()) {
            results.set(entry.skill.name, checkBinaryRequirements(entry, hasBin));
        }
        return results;
    }
    /**
     * Get skills with unmet requirements.
     */
    getSkillsWithMissingRequirements(hasBin) {
        const results = [];
        for (const entry of this.listAll()) {
            const { met, missing } = checkBinaryRequirements(entry, hasBin);
            if (!met) {
                results.push({ skill: entry.skill.name, missing });
            }
        }
        return results;
    }
}
// ============================================================================
// HELPERS
// ============================================================================
const COMMAND_MAX_LENGTH = 32;
const COMMAND_FALLBACK = 'skill';
const DESCRIPTION_MAX_LENGTH = 100;
/**
 * Sanitize a skill name into a valid command name.
 */
function sanitizeCommandName(raw) {
    // Convert to lowercase, replace non-alphanumeric with hyphens
    let name = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // Remove leading/trailing hyphens
    name = name.replace(/^-+|-+$/g, '');
    // Collapse multiple hyphens
    name = name.replace(/-+/g, '-');
    // Truncate to max length
    if (name.length > COMMAND_MAX_LENGTH) {
        name = name.slice(0, COMMAND_MAX_LENGTH);
        // Clean up trailing hyphen
        name = name.replace(/-+$/, '');
    }
    return name || COMMAND_FALLBACK;
}
/**
 * Resolve a unique command name avoiding collisions.
 */
function resolveUniqueCommandName(base, used) {
    if (!used.has(base)) {
        return base;
    }
    // Append numeric suffix
    for (let i = 2; i < 100; i++) {
        const candidate = `${base}-${i}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
    // Fallback with random suffix
    return `${base}-${Date.now() % 1000}`;
}
/**
 * Truncate description to max length.
 */
function truncateDescription(desc) {
    if (desc.length <= DESCRIPTION_MAX_LENGTH) {
        return desc;
    }
    return desc.slice(0, DESCRIPTION_MAX_LENGTH - 3) + '...';
}
function normalizeAllowlist(input) {
    if (!Array.isArray(input))
        return undefined;
    const normalized = input.map((entry) => String(entry).trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
}
function isTruthy(value) {
    if (value === undefined || value === null)
        return false;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    if (typeof value === 'string')
        return value.trim().length > 0;
    return true;
}
function resolveConfigPath(config, pathStr) {
    if (!config)
        return undefined;
    const parts = pathStr.split('.').filter(Boolean);
    let current = config;
    for (const part of parts) {
        if (typeof current !== 'object' || current === null)
            return undefined;
        current = current[part];
    }
    return current;
}
function isConfigPathTruthy(config, pathStr) {
    return isTruthy(resolveConfigPath(config, pathStr));
}
function normalizePlatformName(raw) {
    const lower = raw.toLowerCase();
    if (lower === 'darwin' || lower === 'macos' || lower === 'mac')
        return 'darwin';
    if (lower === 'win32' || lower === 'windows')
        return 'win32';
    if (lower === 'linux')
        return 'linux';
    return lower;
}
function hasBinary(bin) {
    // Local PATH-only check (no shell).
    // Mirrors OpenClaw's behavior and is safe to call in hot paths.
    const pathEnv = process.env.PATH ?? '';
    const parts = pathEnv.split(path.delimiter).filter(Boolean);
    const candidates = process.platform === 'win32' ? [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`] : [bin];
    for (const part of parts) {
        for (const candidateName of candidates) {
            const candidate = path.join(part, candidateName);
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                return true;
            }
            catch {
                // keep scanning
            }
        }
    }
    return false;
}
function shouldIncludeSkillEntry(entry, opts) {
    const name = entry.skill.name;
    const skillKey = entry.metadata?.skillKey ?? name;
    const skillConfig = opts.skillsConfig?.entries?.[skillKey] ?? opts.skillsConfig?.entries?.[name];
    if (skillConfig?.enabled === false)
        return false;
    const osList = entry.metadata?.os ?? [];
    if (osList.length > 0) {
        const platform = normalizePlatformName(opts.platform);
        const allowed = osList.some((p) => normalizePlatformName(p) === platform);
        if (!allowed)
            return false;
    }
    if (entry.metadata?.always === true) {
        return true;
    }
    const requires = entry.metadata?.requires;
    const requiredBins = requires?.bins ?? [];
    const requiredAnyBins = requires?.anyBins ?? [];
    const requiredEnv = requires?.env ?? [];
    const requiredConfig = requires?.config ?? [];
    for (const bin of requiredBins) {
        if (!hasBinary(bin))
            return false;
    }
    if (requiredAnyBins.length > 0) {
        const ok = requiredAnyBins.some((bin) => hasBinary(bin));
        if (!ok)
            return false;
    }
    for (const envName of requiredEnv) {
        if (process.env[envName])
            continue;
        if (skillConfig?.env?.[envName])
            continue;
        if (skillConfig?.apiKey && entry.metadata?.primaryEnv === envName)
            continue;
        return false;
    }
    for (const cfgPath of requiredConfig) {
        if (!isConfigPathTruthy(opts.runtimeConfig, cfgPath))
            return false;
    }
    return true;
}
//# sourceMappingURL=SkillRegistry.js.map
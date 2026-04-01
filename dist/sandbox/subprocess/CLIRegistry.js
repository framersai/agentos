/**
 * @fileoverview CLI discovery registry — scans PATH for known binaries
 * so AgentOS can auto-detect available tools, LLM CLIs, and utilities.
 *
 * CLI descriptors are loaded from JSON files in `./registry/` at startup,
 * organized by category (llm, devtools, runtimes, cloud, databases, media,
 * networking, package-managers). Extensions and providers can register
 * additional descriptors at runtime via {@link CLIRegistry.register}.
 *
 * @module agentos/sandbox/subprocess/CLIRegistry
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execa } from 'execa';
/* ------------------------------------------------------------------ */
/*  JSON registry loader                                               */
/* ------------------------------------------------------------------ */
/** Directory containing per-category JSON descriptor files. */
const REGISTRY_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'registry');
/**
 * Load all CLI descriptors from the bundled JSON registry files.
 *
 * Each `.json` file in `./registry/` is an array of {@link CLIDescriptor}
 * objects grouped by category (e.g. `llm.json`, `cloud.json`). This
 * loader reads them all at startup so the registry is pre-populated
 * without hardcoding descriptors in TypeScript.
 *
 * Community contributions add new CLIs by editing JSON — no code changes.
 */
function loadBundledDescriptors() {
    const descriptors = [];
    try {
        if (!fs.existsSync(REGISTRY_DIR))
            return descriptors;
        for (const file of fs.readdirSync(REGISTRY_DIR)) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const raw = fs.readFileSync(path.join(REGISTRY_DIR, file), 'utf-8');
                const entries = JSON.parse(raw);
                if (Array.isArray(entries))
                    descriptors.push(...entries);
            }
            catch {
                /* skip malformed registry files */
            }
        }
    }
    catch {
        /* registry dir missing — start empty */
    }
    return descriptors;
}
/**
 * Pre-loaded bundled descriptors from `./registry/*.json`.
 * Exported for tests and consumers that need the raw data.
 */
export const WELL_KNOWN_CLIS = loadBundledDescriptors();
/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */
/**
 * Registry of known CLI binaries with PATH scanning capabilities.
 *
 * Usage:
 * 1. Create a registry (bundled JSON descriptors loaded automatically).
 * 2. Providers/extensions register additional CLIs via {@link register}.
 * 3. Call {@link scan} to discover what's installed on the user's machine.
 * 4. Results feed into `wunderland doctor`, capability discovery, and provider auto-detection.
 *
 * @example
 * ```typescript
 * const registry = new CLIRegistry();
 * console.log(`${registry.list().length} CLIs registered`);
 *
 * // Add a custom CLI at runtime
 * registry.register({
 *   binaryName: 'my-tool',
 *   displayName: 'My Tool',
 *   description: 'Custom internal CLI',
 *   category: 'devtools',
 *   installGuidance: 'brew install my-tool',
 * });
 *
 * const results = await registry.scan();
 * for (const r of results) {
 *   console.log(`${r.displayName}: ${r.installed ? `v${r.version}` : 'not installed'}`);
 * }
 * ```
 */
export class CLIRegistry {
    /**
     * Create a registry, optionally pre-populated with bundled JSON descriptors.
     * @param loadDefaults — whether to register {@link WELL_KNOWN_CLIS} (default true)
     */
    constructor(loadDefaults = true) {
        this.descriptors = new Map();
        if (loadDefaults) {
            this.registerAll(WELL_KNOWN_CLIS);
        }
    }
    /** Register a single CLI descriptor. Overwrites existing entry for the same binaryName. */
    register(descriptor) {
        this.descriptors.set(descriptor.binaryName, descriptor);
    }
    /** Register multiple descriptors at once. */
    registerAll(descriptors) {
        for (const d of descriptors)
            this.register(d);
    }
    /** Remove a descriptor by binary name. */
    unregister(binaryName) {
        return this.descriptors.delete(binaryName);
    }
    /**
     * Scan PATH for all registered CLIs.
     * Runs `which` + `--version` for each descriptor in parallel.
     * @returns scan results for every registered CLI (installed or not)
     */
    async scan() {
        return Promise.all(Array.from(this.descriptors.values()).map(d => this.check(d.binaryName)));
    }
    /**
     * Check a single binary by name.
     * @param binaryName — the binary to look for (must be registered)
     * @returns scan result with installation status, path, and version
     */
    async check(binaryName) {
        const descriptor = this.descriptors.get(binaryName);
        if (!descriptor) {
            return {
                binaryName,
                displayName: binaryName,
                description: '',
                category: 'unknown',
                installGuidance: '',
                installed: false,
            };
        }
        try {
            const whichResult = await execa('which', [binaryName]);
            const binaryPath = whichResult.stdout.trim();
            const versionFlag = descriptor.versionFlag ?? '--version';
            let version = 'unknown';
            try {
                const versionResult = await execa(binaryName, [versionFlag]);
                const pattern = descriptor.versionPattern ?? /(\d+\.\d+\.\d+)/;
                const match = versionResult.stdout.match(pattern);
                version = match ? match[1] : 'unknown';
            }
            catch {
                /* version check failed — binary still exists though */
            }
            return { ...descriptor, installed: true, binaryPath, version };
        }
        catch {
            return { ...descriptor, installed: false };
        }
    }
    /** Get all registered descriptors (installed or not). */
    list() {
        return Array.from(this.descriptors.values());
    }
    /** Get only installed CLIs. */
    async installed() {
        const results = await this.scan();
        return results.filter(r => r.installed);
    }
    /** Get CLIs by category. */
    async byCategory(category) {
        const results = await this.scan();
        return results.filter(r => r.category === category);
    }
    /** Get all unique categories registered. */
    categories() {
        return [...new Set(Array.from(this.descriptors.values()).map(d => d.category))].sort();
    }
    /** Total number of registered descriptors. */
    get size() {
        return this.descriptors.size;
    }
    /** Check if a binary is registered (not whether it's installed). */
    has(binaryName) {
        return this.descriptors.has(binaryName);
    }
    /** Get a descriptor by binary name. */
    get(binaryName) {
        return this.descriptors.get(binaryName);
    }
}
//# sourceMappingURL=CLIRegistry.js.map
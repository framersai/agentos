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
import type { CLIDescriptor, CLIScanResult } from './types.js';
/**
 * Pre-loaded bundled descriptors from `./registry/*.json`.
 * Exported for tests and consumers that need the raw data.
 */
export declare const WELL_KNOWN_CLIS: CLIDescriptor[];
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
export declare class CLIRegistry {
    private descriptors;
    /**
     * Create a registry, optionally pre-populated with bundled JSON descriptors.
     * @param loadDefaults — whether to register {@link WELL_KNOWN_CLIS} (default true)
     */
    constructor(loadDefaults?: boolean);
    /** Register a single CLI descriptor. Overwrites existing entry for the same binaryName. */
    register(descriptor: CLIDescriptor): void;
    /** Register multiple descriptors at once. */
    registerAll(descriptors: CLIDescriptor[]): void;
    /** Remove a descriptor by binary name. */
    unregister(binaryName: string): boolean;
    /**
     * Scan PATH for all registered CLIs.
     * Runs `which` + `--version` for each descriptor in parallel.
     * @returns scan results for every registered CLI (installed or not)
     */
    scan(): Promise<CLIScanResult[]>;
    /**
     * Check a single binary by name.
     * @param binaryName — the binary to look for (must be registered)
     * @returns scan result with installation status, path, and version
     */
    check(binaryName: string): Promise<CLIScanResult>;
    /** Get all registered descriptors (installed or not). */
    list(): CLIDescriptor[];
    /** Get only installed CLIs. */
    installed(): Promise<CLIScanResult[]>;
    /** Get CLIs by category. */
    byCategory(category: string): Promise<CLIScanResult[]>;
    /** Get all unique categories registered. */
    categories(): string[];
    /** Total number of registered descriptors. */
    get size(): number;
    /** Check if a binary is registered (not whether it's installed). */
    has(binaryName: string): boolean;
    /** Get a descriptor by binary name. */
    get(binaryName: string): CLIDescriptor | undefined;
}
//# sourceMappingURL=CLIRegistry.d.ts.map
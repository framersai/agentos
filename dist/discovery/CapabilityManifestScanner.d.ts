/**
 * @fileoverview Capability Manifest Scanner — file-based discovery.
 * @module @framers/agentos/discovery/CapabilityManifestScanner
 *
 * Scans directories for CAPABILITY.yaml manifest files and optional
 * SKILL.md companions. Supports hot-reload via fs.watch with debouncing.
 *
 * Directory conventions:
 *   ~/.wunderland/capabilities/       (user-global)
 *   ./.wunderland/capabilities/       (workspace-local)
 *   $WUNDERLAND_CAPABILITY_DIRS       (env var, colon-separated)
 *
 * CAPABILITY.yaml format:
 *   id: custom:my-tool
 *   kind: tool
 *   name: my-tool
 *   displayName: My Custom Tool
 *   description: Does something useful
 *   category: information
 *   tags: [search, api]
 *   requiredSecrets: [MY_API_KEY]
 *   inputSchema: { type: object, properties: { query: { type: string } } }
 *   skillContent: ./SKILL.md   # optional relative path
 *
 * Extends the existing workspace-discovery.ts pattern from agentos-skills-registry.
 */
import type { CapabilityDescriptor } from './types.js';
export declare class CapabilityManifestScanner {
    private watchers;
    /**
     * Get default scan directories.
     *
     * 1. ~/.wunderland/capabilities/ (user-global)
     * 2. ./.wunderland/capabilities/ (workspace-local, relative to cwd)
     * 3. $WUNDERLAND_CAPABILITY_DIRS (env var, colon-separated)
     */
    getDefaultDirs(): string[];
    /**
     * Scan directories for CAPABILITY.yaml files.
     * Each subdirectory should contain a CAPABILITY.yaml and optional SKILL.md.
     *
     * Structure:
     *   <dir>/
     *     my-custom-tool/
     *       CAPABILITY.yaml
     *       SKILL.md          (optional)
     *       schema.json       (optional)
     */
    scan(dirs?: string[]): Promise<CapabilityDescriptor[]>;
    /**
     * Parse a single CAPABILITY.yaml file into a CapabilityDescriptor.
     */
    parseManifest(yamlPath: string, capDir: string): Promise<CapabilityDescriptor | null>;
    /**
     * Watch directories for changes and call the callback when capabilities
     * are added, modified, or removed.
     *
     * Uses debouncing to prevent rapid-fire events from fs.watch.
     */
    watch(dirs: string[], onChange: (descriptors: CapabilityDescriptor[]) => void, debounceMs?: number): void;
    /**
     * Stop watching all directories.
     */
    stopWatching(): void;
}
//# sourceMappingURL=CapabilityManifestScanner.d.ts.map
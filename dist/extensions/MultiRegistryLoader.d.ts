/**
 * @file Multi-registry loader for extensions and personas
 * @_module extensions/MultiRegistryLoader
 */
import type { MultiRegistryConfig, RegistrySource } from './RegistryConfig.js';
import type { ExtensionKind } from './types.js';
import { ExtensionManager } from './ExtensionManager.js';
import type { ExtensionPack } from './manifest.js';
/**
 * Loader that supports multiple registries (npm, GitHub, git, file, URL)
 */
export declare class MultiRegistryLoader {
    private manager;
    private config;
    private cache;
    constructor(manager: ExtensionManager, config: MultiRegistryConfig);
    /**
     * Load an extension of a specific kind from the appropriate registry
     */
    loadExtension(kind: ExtensionKind, extensionId: string): Promise<ExtensionPack | null>;
    /**
     * Load from a specific registry source
     */
    loadFromSource(source: RegistrySource, resourceId: string): Promise<ExtensionPack | null>;
    /**
     * Load from npm package
     */
    private loadFromNpm;
    /**
     * Load from GitHub repository
     */
    private loadFromGitHub;
    /**
     * Load from git repository (clone and load)
     */
    private loadFromGit;
    /**
     * Load from local file system
     */
    private loadFromFile;
    /**
     * Load from HTTP(S) URL
     */
    private loadFromUrl;
    /**
     * Check if cached data is still valid
     */
    private isCacheValid;
    /**
     * Clear cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        keys: string[];
    };
}
//# sourceMappingURL=MultiRegistryLoader.d.ts.map
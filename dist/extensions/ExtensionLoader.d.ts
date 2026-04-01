/**
 * Extension Registry Loader
 * Automatically discovers and loads extensions from npm and local registry
 */
import { ExtensionManager } from './ExtensionManager';
import { ExtensionPack } from './manifest';
/**
 * Configuration for extension loading
 */
export interface ExtensionLoaderConfig {
    /** Enable automatic loading of curated extensions */
    loadCurated?: boolean;
    /** Enable loading of community extensions */
    loadCommunity?: boolean;
    /** NPM registry URL */
    npmRegistry?: string;
    /** Local registry path */
    localRegistryPath?: string;
    /** Extension scope (default: @framers) */
    extensionScope?: string;
    /** Cache directory for downloaded extensions */
    cacheDir?: string;
    /** Auto-install missing extensions from npm */
    autoInstall?: boolean;
    /** Extension whitelist (if specified, only these are loaded) */
    whitelist?: string[];
    /** Extension blacklist (these are never loaded) */
    blacklist?: string[];
}
/**
 * Extension metadata from registry
 */
export interface ExtensionMetadata {
    id: string;
    name: string;
    package: string;
    version: string;
    category: string;
    description: string;
    verified?: boolean;
    tools?: string[];
    author?: any;
}
/**
 * Loads and manages extensions from various sources
 */
export declare class ExtensionLoader {
    private manager;
    private config;
    private loadedExtensions;
    private extensionMetadata;
    constructor(manager: ExtensionManager, config?: ExtensionLoaderConfig);
    /**
     * Initialize and load all configured extensions
     */
    initialize(): Promise<void>;
    /**
     * Load registry metadata from local registry.json
     */
    private loadRegistryMetadata;
    /**
     * Check if an extension should be loaded based on whitelist/blacklist
     */
    private shouldLoadExtension;
    /**
     * Load curated extensions
     */
    private loadCuratedExtensions;
    /**
     * Load community extensions
     */
    private loadCommunityExtensions;
    /**
     * Load a specific extension
     */
    loadExtension(packageName: string): Promise<ExtensionPack | null>;
    /**
     * Install extension from npm
     */
    private installFromNpm;
    /**
     * Get extension-specific options from environment
     */
    private getExtensionOptions;
    /**
     * Check for and install missing extensions
     */
    private checkAndInstallMissing;
    /**
     * Search npm for AgentOS extensions
     */
    searchNpmExtensions(query?: string): Promise<ExtensionMetadata[]>;
    /**
     * Infer category from package name
     */
    private inferCategory;
    /**
     * Get loaded extensions
     */
    getLoadedExtensions(): Map<string, ExtensionPack>;
    /**
     * Get extension metadata
     */
    getExtensionMetadata(): Map<string, ExtensionMetadata>;
    /**
     * Get available tools from all loaded extensions
     */
    getAvailableTools(): Array<{
        id: string;
        name: string;
        description: string;
        extension: string;
    }>;
    /**
     * Reload all extensions
     */
    reload(): Promise<void>;
}
//# sourceMappingURL=ExtensionLoader.d.ts.map
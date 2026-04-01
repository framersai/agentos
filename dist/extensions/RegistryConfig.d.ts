/**
 * @fileoverview Registry configuration system for loading extensions and personas
 * from multiple sources (npm, GitHub, git, file system, URLs)
 *
 * @module extensions/RegistryConfig
 */
import type { ExtensionKind } from './types';
/**
 * Registry source type
 */
export type RegistrySourceType = 'npm' | 'github' | 'git' | 'file' | 'url';
/**
 * Configuration for a single registry source
 */
export interface RegistrySource {
    /** Type of registry source */
    type: RegistrySourceType;
    /** Location (npm package name, GitHub repo, git URL, file path, or HTTP URL) */
    location: string;
    /** Optional branch/tag for git sources */
    branch?: string;
    /** Optional authentication token for private sources */
    token?: string;
    /** Whether this is a verified/trusted source */
    verified?: boolean;
    /** Cache duration in milliseconds (default: 1 hour) */
    cacheDuration?: number;
    /** Whether to auto-install from npm if not present */
    autoInstall?: boolean;
}
/**
 * Multi-registry configuration
 */
export interface MultiRegistryConfig {
    /**
     * Named registries that can be referenced
     * Key is the registry name, value is the source config
     */
    registries: Record<string, RegistrySource>;
    /**
     * Default registry names for each extension kind
     * If not specified, uses 'default' registry
     */
    defaultRegistries?: {
        tool?: string;
        guardrail?: string;
        workflow?: string;
        persona?: string;
        [key: string]: string | undefined;
    };
    /**
     * Resolver function to determine which registry to use for a given kind
     * Overrides defaultRegistries if provided
     */
    resolver?: (kind: ExtensionKind) => string | null;
    /**
     * Global cache settings
     */
    cacheSettings?: {
        enabled?: boolean;
        directory?: string;
        maxAge?: number;
    };
}
/**
 * Default registry configuration for AgentOS
 */
export declare const DEFAULT_REGISTRY_CONFIG: MultiRegistryConfig;
/**
 * Parse GitHub repo URL into components
 */
export declare function parseGitHubUrl(url: string): {
    owner: string;
    repo: string;
    path?: string;
    branch?: string;
} | null;
/**
 * Resolve registry source for a given extension kind
 */
export declare function resolveRegistryForKind(kind: ExtensionKind, config: MultiRegistryConfig): RegistrySource | null;
/**
 * Merge registry configurations (useful for overrides)
 */
export declare function mergeRegistryConfigs(base: MultiRegistryConfig, override: Partial<MultiRegistryConfig>): MultiRegistryConfig;
//# sourceMappingURL=RegistryConfig.d.ts.map
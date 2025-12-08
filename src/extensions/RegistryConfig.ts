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
export const DEFAULT_REGISTRY_CONFIG: MultiRegistryConfig = {
  registries: {
    'agentos-extensions': {
      type: 'npm',
      location: '@framers/agentos-extensions',
      verified: true,
      cacheDuration: 3600000, // 1 hour
      autoInstall: true,
    },
    'agentos-personas': {
      type: 'npm',
      location: '@framersai/agentos-personas',
      verified: true,
      cacheDuration: 3600000,
      autoInstall: true,
    },
  },
  defaultRegistries: {
    tool: 'agentos-extensions',
    guardrail: 'agentos-extensions',
    workflow: 'agentos-extensions',
    persona: 'agentos-personas',
  },
  cacheSettings: {
    enabled: true,
    maxAge: 86400000, // 24 hours
  },
};

/**
 * Parse GitHub repo URL into components
 */
export function parseGitHubUrl(
  url: string
): { owner: string; repo: string; path?: string; branch?: string } | null {
  // Support formats:
  // - github.com/owner/repo
  // - github.com/owner/repo/tree/branch/path
  // - github.com/owner/repo/blob/branch/path/file
  const match = /github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?/.exec(
    url
  );

  if (!match) return null;

  const [, owner, repo, branch, path] = match;
  return {
    owner,
    repo: repo.replace(/\\.git$/, ''),
    branch,
    path,
  };
}

/**
 * Resolve registry source for a given extension kind
 */
export function resolveRegistryForKind(
  kind: ExtensionKind,
  config: MultiRegistryConfig
): RegistrySource | null {
  // Use custom resolver if provided
  if (config.resolver) {
    const registryName = config.resolver(kind);
    if (registryName && config.registries[registryName]) {
      return config.registries[registryName];
    }
  }
  
  // Use default registry for kind
  const defaultRegistryName = config.defaultRegistries?.[kind];
  if (defaultRegistryName && config.registries[defaultRegistryName]) {
    return config.registries[defaultRegistryName];
  }
  
  // Fallback to 'default' registry if exists
  if (config.registries['default']) {
    return config.registries['default'];
  }
  
  return null;
}

/**
 * Merge registry configurations (useful for overrides)
 */
export function mergeRegistryConfigs(
  base: MultiRegistryConfig,
  override: Partial<MultiRegistryConfig>
): MultiRegistryConfig {
  return {
    registries: {
      ...base.registries,
      ...override.registries,
    },
    defaultRegistries: {
      ...base.defaultRegistries,
      ...override.defaultRegistries,
    },
    resolver: override.resolver ?? base.resolver,
    cacheSettings: {
      ...base.cacheSettings,
      ...override.cacheSettings,
    },
  };
}



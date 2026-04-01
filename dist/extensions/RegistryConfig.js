/**
 * @fileoverview Registry configuration system for loading extensions and personas
 * from multiple sources (npm, GitHub, git, file system, URLs)
 *
 * @module extensions/RegistryConfig
 */
/**
 * Default registry configuration for AgentOS
 */
export const DEFAULT_REGISTRY_CONFIG = {
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
export function parseGitHubUrl(url) {
    // Support formats:
    // - github.com/owner/repo
    // - github.com/owner/repo/tree/branch/path
    // - github.com/owner/repo/blob/branch/path/file
    const match = /github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?/.exec(url);
    if (!match)
        return null;
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
export function resolveRegistryForKind(kind, config) {
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
export function mergeRegistryConfigs(base, override) {
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
//# sourceMappingURL=RegistryConfig.js.map
/**
 * @file Multi-registry loader for extensions and personas
 * @_module extensions/MultiRegistryLoader
 */
import { resolveRegistryForKind } from './RegistryConfig.js';
/**
 * Loader that supports multiple registries (npm, GitHub, git, file, URL)
 */
export class MultiRegistryLoader {
    constructor(manager, config) {
        this.manager = manager;
        this.cache = new Map();
        this.config = config;
    }
    /**
     * Load an extension of a specific kind from the appropriate registry
     */
    async loadExtension(kind, extensionId) {
        const registry = resolveRegistryForKind(kind, this.config);
        if (!registry) {
            console.warn(`No registry configured for extension kind: ${kind}`);
            return null;
        }
        return this.loadFromSource(registry, extensionId);
    }
    /**
     * Load from a specific registry source
     */
    async loadFromSource(source, resourceId) {
        const cacheKey = `${source.type}:${source.location}:${resourceId}`;
        // Check cache
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (this.isCacheValid(cached, source.cacheDuration)) {
                return cached.data;
            }
        }
        let result = null;
        switch (source.type) {
            case 'npm':
                result = await this.loadFromNpm(source, resourceId);
                break;
            case 'github':
                result = await this.loadFromGitHub(source, resourceId);
                break;
            case 'git':
                result = await this.loadFromGit(source, resourceId);
                break;
            case 'file':
                result = await this.loadFromFile(source, resourceId);
                break;
            case 'url':
                result = await this.loadFromUrl(source, resourceId);
                break;
        }
        // Cache result
        if (result) {
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now(),
            });
        }
        return result;
    }
    /**
     * Load from npm package
     */
    async loadFromNpm(source, resourceId) {
        try {
            const packageName = source.location;
            await import(packageName);
            const registryPath = `${packageName}/registry/${resourceId}`;
            const extensionModule = await import(registryPath);
            return extensionModule.default || extensionModule;
        }
        catch (error) {
            if (source.autoInstall) {
                console.log(`Installing ${source.location} from npm...`);
            }
            console.error(`Failed to load from npm: ${source.location}`, error);
            return null;
        }
    }
    /**
     * Load from GitHub repository
     */
    async loadFromGitHub(source, resourceId) {
        try {
            const [owner, repo] = source.location.split('/');
            const branch = source.branch || 'main';
            const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
            const resourceUrl = `${baseUrl}/registry/${resourceId}/index.json`;
            const response = await fetch(resourceUrl, {
                headers: source.token ? { Authorization: `token ${source.token}` } : {},
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error(`Failed to load from GitHub: ${source.location}`, error);
            return null;
        }
    }
    /**
     * Load from git repository (clone and load)
     */
    async loadFromGit(_source, _resourceId) {
        console.warn('Git source loading not yet implemented');
        return null;
    }
    /**
     * Load from local file system
     */
    async loadFromFile(source, resourceId) {
        try {
            const path = `${source.location}/registry/${resourceId}/index.js`;
            const _module = await import(path);
            return _module.default || _module;
        }
        catch (error) {
            console.error(`Failed to load from file: ${source.location}`, error);
            return null;
        }
    }
    /**
     * Load from HTTP(S) URL
     */
    async loadFromUrl(source, resourceId) {
        try {
            const url = `${source.location}/registry/${resourceId}/index.json`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error(`Failed to load from URL: ${source.location}`, error);
            return null;
        }
    }
    /**
     * Check if cached data is still valid
     */
    isCacheValid(cached, duration) {
        if (!duration)
            return false;
        const age = Date.now() - cached.timestamp;
        return age < duration;
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys()),
        };
    }
}
//# sourceMappingURL=MultiRegistryLoader.js.map
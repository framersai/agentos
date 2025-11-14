/**
 * @file Multi-registry loader for extensions and personas
 * @module extensions/MultiRegistryLoader
 */

import type {
  MultiRegistryConfig,
  RegistrySource,
} from './RegistryConfig.js';
import type { ExtensionKind } from './types.js';
import { resolveRegistryForKind } from './RegistryConfig.js';
import { ExtensionManager } from './ExtensionManager.js';
import type { ExtensionPack } from './manifest.js';

/**
 * Loader that supports multiple registries (npm, GitHub, git, file, URL)
 */
export class MultiRegistryLoader {
  private config: MultiRegistryConfig;
  private cache: Map<string, any> = new Map();

  constructor(
    private manager: ExtensionManager,
    config: MultiRegistryConfig
  ) {
    this.config = config;
  }

  /**
   * Load an extension of a specific kind from the appropriate registry
   */
  async loadExtension(
    kind: ExtensionKind,
    extensionId: string
  ): Promise<ExtensionPack | null> {
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
  async loadFromSource(
    source: RegistrySource,
    resourceId: string
  ): Promise<ExtensionPack | null> {
    const cacheKey = `${source.type}:${source.location}:${resourceId}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (this.isCacheValid(cached, source.cacheDuration)) {
        return cached.data;
      }
    }

    let result: ExtensionPack | null = null;

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
  private async loadFromNpm(
    source: RegistrySource,
    resourceId: string
  ): Promise<ExtensionPack | null> {
    try {
      const packageName = source.location;
      const module = await import(packageName);
      
      const registryPath = `${packageName}/registry/${resourceId}`;
      const extensionModule = await import(registryPath);
      
      return extensionModule.default || extensionModule;
    } catch (error) {
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
  private async loadFromGitHub(
    source: RegistrySource,
    resourceId: string
  ): Promise<ExtensionPack | null> {
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
    } catch (error) {
      console.error(`Failed to load from GitHub: ${source.location}`, error);
      return null;
    }
  }

  /**
   * Load from git repository (clone and load)
   */
  private async loadFromGit(
    source: RegistrySource,
    resourceId: string
  ): Promise<ExtensionPack | null> {
    console.warn('Git source loading not yet implemented');
    return null;
  }

  /**
   * Load from local file system
   */
  private async loadFromFile(
    source: RegistrySource,
    resourceId: string
  ): Promise<ExtensionPack | null> {
    try {
      const path = `${source.location}/registry/${resourceId}/index.js`;
      const module = await import(path);
      return module.default || module;
    } catch (error) {
      console.error(`Failed to load from file: ${source.location}`, error);
      return null;
    }
  }

  /**
   * Load from HTTP(S) URL
   */
  private async loadFromUrl(
    source: RegistrySource,
    resourceId: string
  ): Promise<ExtensionPack | null> {
    try {
      const url = `${source.location}/registry/${resourceId}/index.json`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Failed to load from URL: ${source.location}`, error);
      return null;
    }
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(cached: any, duration?: number): boolean {
    if (!duration) return false;
    const age = Date.now() - cached.timestamp;
    return age < duration;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}



import { ExtensionRegistry } from './ExtensionRegistry';
import type { ExtensionKind, ExtensionLifecycleContext } from './types';
import type { ExtensionEventListener } from './events';
import type { ExtensionManifest, ExtensionPack, ExtensionPackManifestEntry, ExtensionOverrides } from './manifest';
interface ExtensionManagerOptions {
    manifest?: ExtensionManifest;
    secrets?: Record<string, string>;
    overrides?: ExtensionOverrides;
}
/**
 * Coordinates discovery and lifecycle management for extension packs. Packs
 * emit descriptors which are registered into kind-specific registries.
 */
export declare class ExtensionManager {
    private readonly emitter;
    private readonly registries;
    private readonly options;
    private readonly overrides?;
    private readonly secrets;
    private readonly services;
    private readonly loadedPacks;
    private readonly loadedPackKeys;
    private readonly loadedPackRecords;
    constructor(options?: ExtensionManagerOptions);
    /**
      * Loads packs defined in the manifest, registering their descriptors in the
      * appropriate registries. Supports factory-based packs as well as resolving
      * packs from `package` and `module` manifest entries.
      */
    loadManifest(context?: ExtensionLifecycleContext): Promise<void>;
    /**
     * Registers a listener for extension lifecycle events.
     */
    on(listener: ExtensionEventListener): void;
    off(listener: ExtensionEventListener): void;
    /**
     * Directly loads a pack instance (typically produced by an inline factory)
     * and registers all of its descriptors.
     */
    loadPackFromFactory(pack: ExtensionPack, identifier?: string, options?: Record<string, unknown>, lifecycleContext?: ExtensionLifecycleContext): Promise<void>;
    /**
     * Load a single manifest entry at runtime, applying the same resolution,
     * secret hydration, registration, and event emission logic as {@link loadManifest}.
     *
     * This enables schema-on-demand / lazy-loading flows where an agent can
     * enable an extension pack mid-session.
     */
    loadPackEntry(entry: ExtensionPackManifestEntry, lifecycleContext?: ExtensionLifecycleContext): Promise<{
        loaded: true;
        key: string;
        pack: {
            name: string;
            version?: string;
            identifier?: string;
        };
    } | {
        loaded: false;
        skipped: true;
        reason: 'disabled' | 'already_loaded' | 'unresolved';
        key?: string;
    } | {
        loaded: false;
        skipped: false;
        reason: 'failed';
        key?: string;
        error: Error;
        sourceName: string;
    }>;
    /**
     * Convenience: load an extension pack by npm package name at runtime.
     */
    loadPackFromPackage(packageName: string, options?: Record<string, unknown>, identifier?: string, lifecycleContext?: ExtensionLifecycleContext): Promise<{
        loaded: true;
        key: string;
        pack: {
            name: string;
            version?: string;
            identifier?: string;
        };
    } | {
        loaded: false;
        skipped: true;
        reason: 'disabled' | 'already_loaded' | 'unresolved';
        key?: string;
    } | {
        loaded: false;
        skipped: false;
        reason: 'failed';
        key?: string;
        error: Error;
        sourceName: string;
    }>;
    /**
     * Convenience: load an extension pack by local module specifier at runtime.
     */
    loadPackFromModule(moduleSpecifier: string, options?: Record<string, unknown>, identifier?: string, lifecycleContext?: ExtensionLifecycleContext): Promise<{
        loaded: true;
        key: string;
        pack: {
            name: string;
            version?: string;
            identifier?: string;
        };
    } | {
        loaded: false;
        skipped: true;
        reason: 'disabled' | 'already_loaded' | 'unresolved';
        key?: string;
    } | {
        loaded: false;
        skipped: false;
        reason: 'failed';
        key?: string;
        error: Error;
        sourceName: string;
    }>;
    /**
     * List pack metadata for packs loaded during this process lifetime.
     */
    listLoadedPacks(): Array<{
        key: string;
        name: string;
        version?: string;
        identifier?: string;
        packageName?: string;
        module?: string;
        loadedAt: string;
    }>;
    /**
     * Provides the registry for a particular kind, creating it if necessary.
     */
    getRegistry<TPayload>(kind: ExtensionKind): ExtensionRegistry<TPayload>;
    /**
     * Deactivates all loaded descriptors and extension packs.
     *
     * This is intentionally best-effort: one failing deactivation should not
     * prevent other packs/descriptors from shutting down.
     */
    shutdown(context?: ExtensionLifecycleContext): Promise<void>;
    private ensureDefaultRegistries;
    private resolvePackKey;
    private resolvePack;
    private resolvePackFromModule;
    private registerPack;
    private registerDescriptor;
    private enrichLifecycleContext;
    private resolveSecret;
    private resolveOverride;
    private hydrateSecretsFromPackEntry;
    private emitDescriptorEvent;
    private emitPackEvent;
}
export {};
//# sourceMappingURL=ExtensionManager.d.ts.map
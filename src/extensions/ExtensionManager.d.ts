import { ExtensionRegistry } from './ExtensionRegistry';
import type { ExtensionKind, ExtensionLifecycleContext } from './types';
import type { ExtensionEventListener } from './events';
import type { ExtensionManifest, ExtensionPack } from './manifest';
interface ExtensionManagerOptions {
    manifest?: ExtensionManifest;
    secrets?: Record<string, string>;
}
/**
 * Coordinates discovery and lifecycle management for extension packs. Packs
 * emit descriptors which are registered into kind-specific registries.
 */
export declare class ExtensionManager {
    private readonly emitter;
    private readonly registries;
    private readonly options;
    private readonly secrets;
    private readonly loadedPacks;
    constructor(options?: ExtensionManagerOptions);
    /**
      * Loads packs defined in the manifest, registering their descriptors in the
      * appropriate registries. This method currently supports factory-based packs;
      * package/module resolution will be introduced in a follow-up iteration.
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
    private resolvePack;
    private registerPack;
    private registerDescriptor;
    private enrichLifecycleContext;
    private resolveSecret;
    private emitDescriptorEvent;
    private emitPackEvent;
}
export {};
//# sourceMappingURL=ExtensionManager.d.ts.map
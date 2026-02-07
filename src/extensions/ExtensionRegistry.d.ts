import type { ActiveExtensionDescriptor, ExtensionDescriptor, ExtensionLifecycleContext, ExtensionKind } from './types';
/**
 * Maintains layered stacks of descriptors for a particular extension kind.
 * New registrations push onto the stack, allowing later descriptors to
 * override earlier ones while maintaining history for fallbacks or debugging.
 */
export declare class ExtensionRegistry<TPayload = unknown> {
    private readonly kind;
    private readonly stacks;
    constructor(kind: ExtensionKind);
    /**
     * Registers a descriptor, making it the active entry for its id.
     */
    register(descriptor: ExtensionDescriptor<TPayload>, context?: ExtensionLifecycleContext): Promise<void>;
    /**
     * Removes the active descriptor for an id. If older descriptors exist in the
     * stack, they become active again.
     */
    unregister(id: string, context?: ExtensionLifecycleContext): Promise<boolean>;
    /**
     * Returns the active descriptor for the provided id.
     */
    getActive(id: string): ActiveExtensionDescriptor<TPayload> | undefined;
    /**
     * Lists all currently active descriptors for this registry.
     */
    listActive(): ActiveExtensionDescriptor<TPayload>[];
    /**
     * Returns the full stack history for a descriptor id.
     */
    listHistory(id: string): ActiveExtensionDescriptor<TPayload>[];
    /**
     * Clears all stacks, calling deactivate hooks for active descriptors.
     */
    clear(context?: ExtensionLifecycleContext): Promise<void>;
    private getOrCreateStack;
    private removeStack;
}
//# sourceMappingURL=ExtensionRegistry.d.ts.map
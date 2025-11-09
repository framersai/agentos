import type {
  ActiveExtensionDescriptor,
  ExtensionDescriptor,
  ExtensionLifecycleContext,
  ExtensionKind,
} from './types';

/**
 * Internal representation of a descriptor stack for a given id.
 */
interface DescriptorStackEntry<TPayload> {
  descriptors: ActiveExtensionDescriptor<TPayload>[];
}

/**
 * Maintains layered stacks of descriptors for a particular extension kind.
 * New registrations push onto the stack, allowing later descriptors to
 * override earlier ones while maintaining history for fallbacks or debugging.
 */
export class ExtensionRegistry<TPayload = unknown> {
  private readonly stacks: Map<string, DescriptorStackEntry<TPayload>> = new Map();

  constructor(private readonly kind: ExtensionKind) {}

  /**
   * Registers a descriptor, making it the active entry for its id.
   */
  public async register(
    descriptor: ExtensionDescriptor<TPayload>,
    context?: ExtensionLifecycleContext,
  ): Promise<void> {
    const stack = this.getOrCreateStack(descriptor.id);
    const resolvedPriority = descriptor.priority ?? 0;
    const activeDescriptor: ActiveExtensionDescriptor<TPayload> = {
      ...descriptor,
      resolvedPriority,
      stackIndex: stack.descriptors.length,
    };

    stack.descriptors.push(activeDescriptor);
    await descriptor.onActivate?.(context ?? {});
  }

  /**
   * Removes the active descriptor for an id. If older descriptors exist in the
   * stack, they become active again.
   */
  public async unregister(id: string, context?: ExtensionLifecycleContext): Promise<boolean> {
    const stack = this.stacks.get(id);
    if (!stack || stack.descriptors.length === 0) {
      return false;
    }

    const current = stack.descriptors.pop();
    if (current) {
      await current.onDeactivate?.(context ?? {});
    }

    const next = stack.descriptors.at(-1);
    if (!next) {
      this.stacks.delete(id);
      return true;
    }

    await next.onActivate?.(context ?? {});
    return true;
  }

  /**
   * Returns the active descriptor for the provided id.
   */
  public getActive(id: string): ActiveExtensionDescriptor<TPayload> | undefined {
    const stack = this.stacks.get(id);
    return stack?.descriptors.at(-1);
  }

  /**
   * Lists all currently active descriptors for this registry.
   */
  public listActive(): ActiveExtensionDescriptor<TPayload>[] {
    const result: ActiveExtensionDescriptor<TPayload>[] = [];
    for (const entry of this.stacks.values()) {
      const active = entry.descriptors.at(-1);
      if (active) {
        result.push(active);
      }
    }
    return result;
  }

  /**
   * Returns the full stack history for a descriptor id.
   */
  public listHistory(id: string): ActiveExtensionDescriptor<TPayload>[] {
    const stack = this.stacks.get(id);
    return stack ? [...stack.descriptors] : [];
  }

  /**
   * Clears all stacks, calling deactivate hooks for active descriptors.
   */
  public async clear(context?: ExtensionLifecycleContext): Promise<void> {
    for (const [id] of this.stacks) {
      await this.removeStack(id, context);
    }
    this.stacks.clear();
  }

  private getOrCreateStack(id: string): DescriptorStackEntry<TPayload> {
    const existing = this.stacks.get(id);
    if (existing) {
      return existing;
    }
    const entry: DescriptorStackEntry<TPayload> = { descriptors: [] };
    this.stacks.set(id, entry);
    return entry;
  }

  private async removeStack(id: string, context?: ExtensionLifecycleContext): Promise<void> {
    const stack = this.stacks.get(id);
    if (!stack) {
      return;
    }
    const descriptors = [...stack.descriptors].reverse();
    for (const descriptor of descriptors) {
      await descriptor.onDeactivate?.(context ?? {});
    }
    this.stacks.delete(id);
  }
}

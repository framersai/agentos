/**
 * Maintains layered stacks of descriptors for a particular extension kind.
 * New registrations push onto the stack, allowing later descriptors to
 * override earlier ones while maintaining history for fallbacks or debugging.
 */
export class ExtensionRegistry {
    constructor(kind) {
        this.kind = kind;
        this.stacks = new Map();
    }
    /**
     * Registers a descriptor, making it the active entry for its id.
     */
    async register(descriptor, context) {
        const stack = this.getOrCreateStack(descriptor.id);
        const resolvedPriority = descriptor.priority ?? 0;
        const prevActive = stack.active ?? this.computeActive(stack);
        const activeDescriptor = {
            ...descriptor,
            resolvedPriority,
            stackIndex: stack.nextStackIndex++,
        };
        stack.descriptors.push(activeDescriptor);
        const nextActive = this.computeActive(stack);
        if (prevActive !== nextActive) {
            await prevActive?.onDeactivate?.(context ?? {});
            await nextActive?.onActivate?.(context ?? {});
        }
        else if (!prevActive && nextActive) {
            // First descriptor registered in this stack.
            await nextActive.onActivate?.(context ?? {});
        }
        stack.active = nextActive;
    }
    /**
     * Removes the active descriptor for an id. If older descriptors exist in the
     * stack, they become active again.
     */
    async unregister(id, context) {
        const stack = this.stacks.get(id);
        if (!stack || stack.descriptors.length === 0) {
            return false;
        }
        const prevActive = stack.active ?? this.computeActive(stack);
        if (!prevActive) {
            // No active descriptor, but the stack has descriptors; treat as best-effort.
            const last = stack.descriptors.pop();
            if (last) {
                await last.onDeactivate?.(context ?? {});
            }
        }
        else {
            const idx = stack.descriptors.findIndex((d) => d.stackIndex === prevActive.stackIndex);
            if (idx >= 0) {
                stack.descriptors.splice(idx, 1);
            }
            await prevActive.onDeactivate?.(context ?? {});
        }
        if (stack.descriptors.length === 0) {
            this.stacks.delete(id);
            return true;
        }
        const nextActive = this.computeActive(stack);
        if (nextActive) {
            await nextActive.onActivate?.(context ?? {});
        }
        stack.active = nextActive;
        return true;
    }
    /**
     * Returns the active descriptor for the provided id.
     */
    getActive(id) {
        const stack = this.stacks.get(id);
        return stack?.active ?? (stack ? this.computeActive(stack) : undefined);
    }
    /**
     * Lists all currently active descriptors for this registry.
     */
    listActive() {
        const result = [];
        for (const entry of this.stacks.values()) {
            const active = entry.active ?? this.computeActive(entry);
            if (active) {
                entry.active = active;
                result.push(active);
            }
        }
        return result;
    }
    /**
     * Returns the full stack history for a descriptor id.
     */
    listHistory(id) {
        const stack = this.stacks.get(id);
        if (!stack) {
            return [];
        }
        // History is ordered by insertion (stackIndex ascending) for debuggability.
        return [...stack.descriptors].sort((a, b) => a.stackIndex - b.stackIndex);
    }
    /**
     * Clears all stacks, calling deactivate hooks for active descriptors.
     */
    async clear(context) {
        for (const [id] of this.stacks) {
            await this.removeStack(id, context);
        }
        this.stacks.clear();
    }
    getOrCreateStack(id) {
        const existing = this.stacks.get(id);
        if (existing) {
            return existing;
        }
        const entry = { descriptors: [], nextStackIndex: 0 };
        this.stacks.set(id, entry);
        return entry;
    }
    async removeStack(id, context) {
        const stack = this.stacks.get(id);
        if (!stack) {
            return;
        }
        const active = stack.active ?? this.computeActive(stack);
        if (active) {
            await active.onDeactivate?.(context ?? {});
        }
        this.stacks.delete(id);
    }
    computeActive(stack) {
        let active;
        for (const descriptor of stack.descriptors) {
            if (!active) {
                active = descriptor;
                continue;
            }
            if (descriptor.resolvedPriority > active.resolvedPriority) {
                active = descriptor;
                continue;
            }
            if (descriptor.resolvedPriority === active.resolvedPriority &&
                descriptor.stackIndex > active.stackIndex) {
                active = descriptor;
            }
        }
        return active;
    }
}
//# sourceMappingURL=ExtensionRegistry.js.map
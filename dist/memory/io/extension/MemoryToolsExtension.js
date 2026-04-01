/**
 * @fileoverview Extension-pack helpers for exposing the standalone SQLite
 * memory editor tools through the AgentOS extension system.
 *
 * The underlying tools already exist as `ITool` implementations; this module
 * adapts them into `tool` descriptors and extension packs so they can be
 * loaded through `ExtensionManager`, which is the same registry path consumed
 * by `ToolExecutor` and `ToolOrchestrator`.
 *
 * @module agentos/memory/extension/MemoryToolsExtension
 */
import { EXTENSION_KIND_TOOL, } from '../../../extensions/types.js';
function toToolDescriptor(tool, priority) {
    return {
        id: tool.name,
        kind: EXTENSION_KIND_TOOL,
        ...(priority !== undefined ? { priority } : {}),
        payload: tool,
        metadata: {
            toolId: tool.id,
            origin: 'memory-tools-pack',
            category: tool.category ?? 'memory',
        },
        onDeactivate: async () => {
            if (typeof tool.shutdown === 'function') {
                await tool.shutdown();
            }
        },
    };
}
/**
 * Convert a standalone `Memory` facade's built-in tool set into extension
 * descriptors that can be registered directly with `ExtensionManager`.
 */
export function createMemoryToolDescriptors(memory, options) {
    return memory
        .createTools({ includeReflect: options?.includeReflect })
        .map((tool) => toToolDescriptor(tool, options?.priority));
}
/**
 * Create an `ExtensionPack` exposing the standalone memory editor tools.
 *
 * Loading the returned pack through `ExtensionManager` makes the tools
 * immediately visible to `ToolExecutor`/`ToolOrchestrator` because they all
 * share the same `tool` registry.
 */
export function createMemoryToolsPack(memory, options) {
    return {
        name: options?.name ?? 'agentos-memory-tools',
        version: options?.version ?? '1.0.0',
        descriptors: createMemoryToolDescriptors(memory, options),
    };
}
//# sourceMappingURL=MemoryToolsExtension.js.map
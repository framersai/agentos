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
import type { ExtensionPack } from '../../../extensions/manifest.js';
import { type ToolDescriptor } from '../../../extensions/types.js';
import type { Memory } from '../../io/facade/Memory.js';
/**
 * Options controlling which memory tools are exposed and how their descriptors
 * are prioritised.
 */
export interface MemoryToolsExtensionOptions {
    /**
     * Include the `memory_reflect` consolidation tool when available.
     * Defaults to `true`.
     */
    includeReflect?: boolean;
    /**
     * Optional registry priority applied to all emitted tool descriptors.
     */
    priority?: number;
    /**
     * Optional pack name override.
     * @default 'agentos-memory-tools'
     */
    name?: string;
    /**
     * Optional pack version override.
     * @default '1.0.0'
     */
    version?: string;
    /**
     * Include the `rehydrate_memory` tool for inflating gisted/archived traces.
     * Requires an `IMemoryArchive` to be provided via the archive option.
     * Defaults to `false`.
     */
    includeRehydrate?: boolean;
}
/**
 * Convert a standalone `Memory` facade's built-in tool set into extension
 * descriptors that can be registered directly with `ExtensionManager`.
 */
export declare function createMemoryToolDescriptors(memory: Pick<Memory, 'createTools'>, options?: Pick<MemoryToolsExtensionOptions, 'includeReflect' | 'priority'>): ToolDescriptor[];
/**
 * Create an `ExtensionPack` exposing the standalone memory editor tools.
 *
 * Loading the returned pack through `ExtensionManager` makes the tools
 * immediately visible to `ToolExecutor`/`ToolOrchestrator` because they all
 * share the same `tool` registry.
 */
export declare function createMemoryToolsPack(memory: Pick<Memory, 'createTools'>, options?: MemoryToolsExtensionOptions): ExtensionPack;
//# sourceMappingURL=MemoryToolsExtension.d.ts.map
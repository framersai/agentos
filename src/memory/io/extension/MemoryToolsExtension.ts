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

import type { ITool } from '../../../core/tools/ITool.js';
import type { ExtensionPack } from '../../../extensions/manifest.js';
import {
  EXTENSION_KIND_TOOL,
  type ToolDescriptor,
} from '../../../extensions/types.js';
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

function toToolDescriptor(tool: ITool, priority?: number): ToolDescriptor {
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
export function createMemoryToolDescriptors(
  memory: Pick<Memory, 'createTools'>,
  options?: Pick<MemoryToolsExtensionOptions, 'includeReflect' | 'priority'>,
): ToolDescriptor[] {
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
export function createMemoryToolsPack(
  memory: Pick<Memory, 'createTools'>,
  options?: MemoryToolsExtensionOptions,
): ExtensionPack {
  return {
    name: options?.name ?? 'agentos-memory-tools',
    version: options?.version ?? '1.0.0',
    descriptors: createMemoryToolDescriptors(memory, options),
  };
}

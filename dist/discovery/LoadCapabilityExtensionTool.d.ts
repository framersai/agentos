/**
 * @fileoverview load_capability_extension meta-tool.
 * @module @framers/agentos/discovery/LoadCapabilityExtensionTool
 *
 * Activates a curated extension pack at runtime so its tools become available
 * on the next tool-selection iteration without requiring a process restart or
 * config mutation.
 */
import type { ITool } from '../core/tools/ITool.js';
import type { IToolOrchestrator } from '../core/tools/IToolOrchestrator.js';
interface LoadCapabilityExtensionInput {
    extensionId: string;
}
interface LoadCapabilityExtensionOutput {
    extensionId: string;
    registeredTools: string[];
}
/**
 * Create the load_capability_extension meta-tool.
 *
 * This tool is intentionally narrow: it only exposes the existing
 * `ToolOrchestrator.loadExtensionAtRuntime()` hook as an agent-callable
 * capability so the discovery loop can actually activate loadable extensions.
 */
export declare function createLoadCapabilityExtensionTool(toolOrchestrator: IToolOrchestrator): ITool<LoadCapabilityExtensionInput, LoadCapabilityExtensionOutput>;
export {};
//# sourceMappingURL=LoadCapabilityExtensionTool.d.ts.map
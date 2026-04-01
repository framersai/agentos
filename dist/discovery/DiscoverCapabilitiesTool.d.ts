/**
 * @fileoverview discover_capabilities meta-tool.
 * @module @framers/agentos/discovery/DiscoverCapabilitiesTool
 *
 * A built-in ITool that agents can call to search for available capabilities.
 * This is the "agentic" part of the discovery loop — the agent actively
 * participates in finding capabilities rather than passively receiving
 * a static tool list.
 *
 * The tool costs ~80 tokens in the tool list, returning semantically
 * matched capabilities with relevance scores.
 *
 * When a ToolOrchestrator reference is provided, each result includes a
 * `loadable` flag indicating whether the capability exists in the extension
 * registry but is not yet loaded. The agent can use this to trigger runtime
 * loading via the `load_capability_extension` meta-tool.
 *
 * Usage by the agent:
 *   discover_capabilities({ query: "search the web", kind: "tool" })
 *   → [{ id: "tool:web-search", name: "Web Search", relevance: 0.87, loadable: true, extensionId: "web-search", ... }]
 */
import type { ITool } from '../core/tools/ITool.js';
import type { IToolOrchestrator } from '../core/tools/IToolOrchestrator.js';
import type { ICapabilityDiscoveryEngine } from './types.js';
interface DiscoverCapabilitiesInput {
    query: string;
    kind?: 'tool' | 'skill' | 'extension' | 'channel' | 'any';
    category?: string;
}
interface DiscoverCapabilitiesOutput {
    capabilities: Array<{
        id: string;
        name: string;
        kind: string;
        description: string;
        category: string;
        relevance: number;
        available: boolean;
        /** Whether this capability can be loaded at runtime via loadExtensionAtRuntime. */
        loadable?: boolean;
        /** The extension registry name to pass to loadExtensionAtRuntime. */
        extensionId?: string;
    }>;
    totalIndexed: number;
}
/**
 * Create the discover_capabilities meta-tool.
 *
 * @param discoveryEngine - The initialized CapabilityDiscoveryEngine
 * @param toolOrchestrator - Optional ToolOrchestrator reference used to
 *   determine whether a discovered capability is already loaded or can
 *   be loaded at runtime. When provided, results include `loadable` and
 *   `extensionId` fields that can be passed to `load_capability_extension`.
 * @returns An ITool instance ready for registration with ToolOrchestrator
 */
export declare function createDiscoverCapabilitiesTool(discoveryEngine: ICapabilityDiscoveryEngine, toolOrchestrator?: IToolOrchestrator): ITool<DiscoverCapabilitiesInput, DiscoverCapabilitiesOutput>;
export {};
//# sourceMappingURL=DiscoverCapabilitiesTool.d.ts.map
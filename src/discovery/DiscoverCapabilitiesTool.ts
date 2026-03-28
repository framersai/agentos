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
 * loading via `loadExtensionAtRuntime`.
 *
 * Usage by the agent:
 *   discover_capabilities({ query: "search the web", kind: "tool" })
 *   → [{ id: "tool:web-search", name: "Web Search", relevance: 0.87, loadable: true, extensionId: "web-search", ... }]
 */

import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
import type { IToolOrchestrator } from '../core/tools/IToolOrchestrator.js';
import type { ICapabilityDiscoveryEngine } from './types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

const INPUT_SCHEMA: JSONSchemaObject = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Natural language description of the capability you need (e.g., "search the web", "send a Discord message", "summarize a document")',
    },
    kind: {
      type: 'string',
      enum: ['tool', 'skill', 'extension', 'channel', 'any'],
      description: 'Filter by capability type. Use "any" to search all types.',
      default: 'any',
    },
    category: {
      type: 'string',
      description: 'Filter by category (e.g., "information", "communication", "developer-tools")',
    },
  },
  required: ['query'],
};

const OUTPUT_SCHEMA: JSONSchemaObject = {
  type: 'object',
  properties: {
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          relevance: { type: 'number' },
          available: { type: 'boolean' },
          loadable: { type: 'boolean' },
          extensionId: { type: 'string' },
        },
      },
    },
    totalIndexed: { type: 'number' },
  },
};

// ============================================================================
// TOOL IMPLEMENTATION
// ============================================================================

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
 * Lazily loads the TOOL_CATALOG from the extensions registry and builds
 * a Set of extension names that have a `createPack` factory (i.e., can
 * be loaded at runtime). Returns an empty set if the registry is not
 * available.
 */
let _catalogCachePromise: Promise<Set<string>> | undefined;
function getLoadableCatalogNames(): Promise<Set<string>> {
  if (!_catalogCachePromise) {
    _catalogCachePromise = (async () => {
      try {
        const registry = await import('@framers/agentos-extensions-registry');
        const catalog: Array<{ name: string; createPack?: unknown }> =
          (registry.TOOL_CATALOG as any[]) ?? [];
        const names = new Set<string>();
        for (const entry of catalog) {
          if (typeof entry.createPack === 'function') {
            names.add(entry.name);
          }
        }
        return names;
      } catch {
        return new Set<string>();
      }
    })();
  }
  return _catalogCachePromise;
}

/**
 * Create the discover_capabilities meta-tool.
 *
 * @param discoveryEngine - The initialized CapabilityDiscoveryEngine
 * @param toolOrchestrator - Optional ToolOrchestrator reference used to
 *   determine whether a discovered capability is already loaded or can
 *   be loaded at runtime. When provided, results include `loadable` and
 *   `extensionId` fields.
 * @returns An ITool instance ready for registration with ToolOrchestrator
 */
export function createDiscoverCapabilitiesTool(
  discoveryEngine: ICapabilityDiscoveryEngine,
  toolOrchestrator?: IToolOrchestrator,
): ITool<DiscoverCapabilitiesInput, DiscoverCapabilitiesOutput> {
  return {
    id: 'agentos-discover-capabilities',
    name: 'discover_capabilities',
    displayName: 'Discover Capabilities',
    description:
      'Search for available tools, skills, extensions, and channels by describing what you need. ' +
      'Use when you need a capability not already visible in your context. ' +
      'Returns matched capabilities with relevance scores. ' +
      'Capabilities marked loadable=true can be activated at runtime.',
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    category: 'meta',
    hasSideEffects: false,

    async execute(
      args: DiscoverCapabilitiesInput,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult<DiscoverCapabilitiesOutput>> {
      if (!discoveryEngine.isInitialized()) {
        return {
          success: false,
          error: 'Capability discovery engine is not initialized.',
        };
      }

      try {
        const result = await discoveryEngine.discover(args.query, {
          kind: args.kind ?? 'any',
          category: args.category,
          onlyAvailable: false,
        });

        // Resolve loadable catalog names for runtime-loading annotation.
        const loadableNames = toolOrchestrator
          ? await getLoadableCatalogNames()
          : new Set<string>();

        const capabilities = await Promise.all(
          result.tier1.map(async (r) => {
            const base = {
              id: r.capability.id,
              name: r.capability.displayName,
              kind: r.capability.kind,
              description: r.capability.description,
              category: r.capability.category,
              relevance: Math.round(r.relevanceScore * 100) / 100,
              available: r.capability.available,
            };

            // When the orchestrator is available, check whether the capability
            // is currently loaded and whether it can be loaded at runtime.
            if (!toolOrchestrator) {
              return base;
            }

            // Derive the extension name from the capability's source reference
            // or fall back to the capability's machine-readable name.
            const capName = r.capability.name;
            const sourceRef = r.capability.sourceRef;
            const candidateExtensionId =
              (sourceRef.type === 'extension' ? (sourceRef as { packageName: string }).packageName : undefined) ??
              capName;

            // Check if the tool is already registered in the orchestrator.
            const existingTool = await toolOrchestrator.getTool(capName);
            const isLoaded = !!existingTool;

            // A capability is loadable when it is NOT currently loaded but
            // its extension exists in the catalog with a createPack factory.
            const isLoadable = !isLoaded && loadableNames.has(candidateExtensionId);

            return {
              ...base,
              ...(isLoadable
                ? { loadable: true, extensionId: candidateExtensionId }
                : { loadable: false }),
            };
          }),
        );

        return {
          success: true,
          output: {
            capabilities,
            totalIndexed: discoveryEngine.listCapabilityIds().length,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: `Discovery search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

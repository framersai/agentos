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
 * Usage by the agent:
 *   discover_capabilities({ query: "search the web", kind: "tool" })
 *   → [{ id: "tool:web-search", name: "Web Search", relevance: 0.87, ... }]
 */

import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
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
  }>;
  totalIndexed: number;
}

/**
 * Create the discover_capabilities meta-tool.
 *
 * @param discoveryEngine - The initialized CapabilityDiscoveryEngine
 * @returns An ITool instance ready for registration with ToolOrchestrator
 */
export function createDiscoverCapabilitiesTool(
  discoveryEngine: ICapabilityDiscoveryEngine,
): ITool<DiscoverCapabilitiesInput, DiscoverCapabilitiesOutput> {
  return {
    id: 'agentos-discover-capabilities',
    name: 'discover_capabilities',
    displayName: 'Discover Capabilities',
    description:
      'Search for available tools, skills, extensions, and channels by describing what you need. ' +
      'Use when you need a capability not already visible in your context. ' +
      'Returns matched capabilities with relevance scores.',
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

        const capabilities = result.tier1.map((r) => ({
          id: r.capability.id,
          name: r.capability.displayName,
          kind: r.capability.kind,
          description: r.capability.description,
          category: r.capability.category,
          relevance: Math.round(r.relevanceScore * 100) / 100,
          available: r.capability.available,
        }));

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

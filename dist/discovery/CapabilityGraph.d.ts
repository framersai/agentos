/**
 * @fileoverview Capability Relationship Graph
 * @module @framers/agentos/discovery/CapabilityGraph
 *
 * Lightweight, deterministic relationship graph over capabilities.
 * Built from metadata (SKILL.md frontmatter, preset co-occurrence),
 * NOT from LLM extraction.
 *
 * Uses graphology (already in codebase via GraphRAGEngine) for:
 * - O(1) neighbor lookups
 * - Edge attributes (type, weight)
 * - Sub-millisecond traversal for ~100 nodes
 *
 * Implements ICapabilityGraph so Neo4j can be swapped in later
 * if capabilities scale to 1000+.
 *
 * Edge types:
 * - DEPENDS_ON: Skill → Tool (from requiredTools)
 * - COMPOSED_WITH: Co-occur in agent presets (suggestedSkills + suggestedExtensions)
 * - SAME_CATEGORY: Shared category (weak signal, low weight)
 * - TAGGED_WITH: Shared tags (weighted by overlap count, ≥2 tags)
 */
import type { CapabilityDescriptor, CapabilityEdge, ICapabilityGraph, PresetCoOccurrence, RelatedCapability } from './types.js';
export declare class CapabilityGraph implements ICapabilityGraph {
    private graph;
    private ensureGraph;
    /**
     * Build the graph from capability descriptors and preset co-occurrence data.
     *
     * Construction order:
     * 1. Add all capabilities as nodes
     * 2. Add DEPENDS_ON edges (skill → tool dependencies)
     * 3. Add COMPOSED_WITH edges (preset co-occurrence)
     * 4. Add TAGGED_WITH edges (shared tags, ≥2 overlap)
     * 5. Add SAME_CATEGORY edges (weak signal)
     */
    buildGraph(capabilities: CapabilityDescriptor[], presetCoOccurrences?: PresetCoOccurrence[]): Promise<void>;
    /**
     * Get capabilities related to a given capability (1-hop neighbors).
     * Returns neighbors with edge weights, sorted by weight descending.
     */
    getRelated(capabilityId: string): RelatedCapability[];
    /**
     * Get the subgraph for a set of capability IDs.
     * Returns all nodes and edges within the induced subgraph.
     */
    getSubgraph(capabilityIds: string[]): {
        nodes: string[];
        edges: CapabilityEdge[];
    };
    /**
     * Apply graph-based re-ranking boost to search results.
     *
     * For each result in the search results:
     * 1. Look up its graph neighbors
     * 2. If a neighbor is also in the results, boost both by graphBoostFactor * edge weight
     * 3. If a neighbor is NOT in results but has a DEPENDS_ON edge, add it as a candidate
     *
     * Returns re-ranked results with potentially new candidates added.
     */
    rerank(searchResults: Array<{
        id: string;
        score: number;
    }>, graphBoostFactor: number): Array<{
        id: string;
        score: number;
        boosted: boolean;
    }>;
    nodeCount(): number;
    edgeCount(): number;
    clear(): void;
    /**
     * Safely add an edge, handling the case where it already exists.
     * If the edge already exists, update to the higher weight.
     */
    private safeAddEdge;
}
//# sourceMappingURL=CapabilityGraph.d.ts.map
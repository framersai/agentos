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
let _GraphCtor;
async function resolveGraphology() {
    if (_GraphCtor)
        return _GraphCtor;
    try {
        const mod = await import('graphology');
        _GraphCtor = (mod.default ?? mod);
        return _GraphCtor;
    }
    catch {
        throw new Error('graphology is required for CapabilityGraph but was not found. ' +
            'Install it: npm install graphology graphology-types');
    }
}
// ============================================================================
// GRAPHOLOGY-BASED CAPABILITY GRAPH
// ============================================================================
export class CapabilityGraph {
    constructor() {
        this.graph = null;
    }
    ensureGraph() {
        if (!this.graph) {
            throw new Error('CapabilityGraph not initialized. Call buildGraph() first.');
        }
        return this.graph;
    }
    // ============================================================================
    // BUILD
    // ============================================================================
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
    async buildGraph(capabilities, presetCoOccurrences) {
        // Lazy-load graphology on first use
        const GraphCtor = await resolveGraphology();
        if (!this.graph) {
            this.graph = new GraphCtor({ multi: false, type: 'undirected' });
        }
        // Clear any existing graph
        this.graph.clear();
        // 1. Add all capabilities as nodes
        for (const cap of capabilities) {
            this.graph.addNode(cap.id, {
                kind: cap.kind,
                category: cap.category,
                name: cap.name,
            });
        }
        // 2. Add DEPENDS_ON edges (skill → tool)
        for (const cap of capabilities) {
            if (cap.requiredTools.length > 0) {
                for (const toolName of cap.requiredTools) {
                    // Try both tool:name and skill:name patterns
                    const toolId = `tool:${toolName}`;
                    if (this.graph.hasNode(cap.id) && this.graph.hasNode(toolId)) {
                        this.safeAddEdge(cap.id, toolId, 'DEPENDS_ON', 1.0);
                    }
                }
            }
        }
        // 3. Add COMPOSED_WITH edges from preset co-occurrence
        if (presetCoOccurrences) {
            for (const preset of presetCoOccurrences) {
                const validIds = preset.capabilityIds.filter((id) => this.graph.hasNode(id));
                for (let i = 0; i < validIds.length; i++) {
                    for (let j = i + 1; j < validIds.length; j++) {
                        this.safeAddEdge(validIds[i], validIds[j], 'COMPOSED_WITH', 0.5);
                    }
                }
            }
        }
        // 4. Add TAGGED_WITH edges (shared tags, ≥2 overlap)
        const tagIndex = new Map();
        for (const cap of capabilities) {
            for (const tag of cap.tags) {
                const list = tagIndex.get(tag) ?? [];
                list.push(cap.id);
                tagIndex.set(tag, list);
            }
        }
        // Count tag overlaps between capability pairs
        const pairOverlaps = new Map();
        for (const [, capIds] of tagIndex) {
            for (let i = 0; i < capIds.length; i++) {
                for (let j = i + 1; j < capIds.length; j++) {
                    const key = [capIds[i], capIds[j]].sort().join('||');
                    pairOverlaps.set(key, (pairOverlaps.get(key) ?? 0) + 1);
                }
            }
        }
        for (const [key, count] of pairOverlaps) {
            if (count >= 2) {
                const [a, b] = key.split('||');
                this.safeAddEdge(a, b, 'TAGGED_WITH', count * 0.3);
            }
        }
        // 5. Add SAME_CATEGORY edges (weak signal — only between same-kind capabilities)
        const categoryIndex = new Map();
        for (const cap of capabilities) {
            const key = `${cap.kind}:${cap.category}`;
            const list = categoryIndex.get(key) ?? [];
            list.push(cap.id);
            categoryIndex.set(key, list);
        }
        for (const [, capIds] of categoryIndex) {
            // Only add category edges for groups of 2-8 (avoid massive cliques)
            if (capIds.length >= 2 && capIds.length <= 8) {
                for (let i = 0; i < capIds.length; i++) {
                    for (let j = i + 1; j < capIds.length; j++) {
                        this.safeAddEdge(capIds[i], capIds[j], 'SAME_CATEGORY', 0.1);
                    }
                }
            }
        }
    }
    // ============================================================================
    // QUERY
    // ============================================================================
    /**
     * Get capabilities related to a given capability (1-hop neighbors).
     * Returns neighbors with edge weights, sorted by weight descending.
     */
    getRelated(capabilityId) {
        if (!this.graph)
            return [];
        const g = this.ensureGraph();
        if (!g.hasNode(capabilityId))
            return [];
        const related = [];
        g.forEachEdge(capabilityId, (_edge, attrs, source, target) => {
            const neighborId = source === capabilityId ? target : source;
            related.push({
                id: neighborId,
                weight: attrs.weight,
                relationType: attrs.type,
            });
        });
        // Sort by weight descending
        related.sort((a, b) => b.weight - a.weight);
        return related;
    }
    /**
     * Get the subgraph for a set of capability IDs.
     * Returns all nodes and edges within the induced subgraph.
     */
    getSubgraph(capabilityIds) {
        const g = this.ensureGraph();
        const nodeSet = new Set(capabilityIds.filter((id) => g.hasNode(id)));
        const edges = [];
        for (const nodeId of nodeSet) {
            g.forEachEdge(nodeId, (_edge, attrs, source, target) => {
                // Only include edges where both endpoints are in the subgraph
                if (nodeSet.has(source) && nodeSet.has(target)) {
                    // Avoid duplicates (undirected graph)
                    const edgeKey = [source, target].sort().join('||');
                    if (!edges.some((e) => [e.sourceId, e.targetId].sort().join('||') === edgeKey)) {
                        edges.push({
                            sourceId: source,
                            targetId: target,
                            type: attrs.type,
                            weight: attrs.weight,
                        });
                    }
                }
            });
        }
        return {
            nodes: Array.from(nodeSet),
            edges,
        };
    }
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
    rerank(searchResults, graphBoostFactor) {
        const resultMap = new Map();
        // Initialize with original scores
        for (const r of searchResults) {
            resultMap.set(r.id, { score: r.score, boosted: false });
        }
        // Apply graph boosts
        for (const r of searchResults) {
            const related = this.getRelated(r.id);
            for (const rel of related) {
                if (resultMap.has(rel.id)) {
                    // Both in results — mutual boost
                    const existing = resultMap.get(rel.id);
                    existing.score += graphBoostFactor * rel.weight;
                    existing.boosted = true;
                }
                else if (rel.relationType === 'DEPENDS_ON' || rel.relationType === 'COMPOSED_WITH') {
                    // Not in results but has strong relationship — pull in as candidate
                    resultMap.set(rel.id, {
                        score: r.score * graphBoostFactor * rel.weight,
                        boosted: true,
                    });
                }
            }
        }
        // Sort by score descending
        return Array.from(resultMap.entries())
            .map(([id, { score, boosted }]) => ({ id, score, boosted }))
            .sort((a, b) => b.score - a.score);
    }
    // ============================================================================
    // ACCESSORS
    // ============================================================================
    nodeCount() {
        return this.graph?.order ?? 0;
    }
    edgeCount() {
        return this.graph?.size ?? 0;
    }
    clear() {
        this.graph?.clear();
    }
    // ============================================================================
    // INTERNAL HELPERS
    // ============================================================================
    /**
     * Safely add an edge, handling the case where it already exists.
     * If the edge already exists, update to the higher weight.
     */
    safeAddEdge(source, target, type, weight) {
        const g = this.ensureGraph();
        if (!g.hasNode(source) || !g.hasNode(target))
            return;
        if (source === target)
            return;
        try {
            const existingEdge = g.edge(source, target);
            if (existingEdge) {
                // Edge exists — keep the one with higher weight or stronger type
                const existing = g.getEdgeAttributes(existingEdge);
                if (weight > existing.weight) {
                    g.setEdgeAttribute(existingEdge, 'weight', weight);
                    g.setEdgeAttribute(existingEdge, 'type', type);
                }
            }
            else {
                g.addEdge(source, target, { type, weight });
            }
        }
        catch {
            // Edge might already exist in the other direction for undirected
            try {
                g.addEdge(source, target, { type, weight });
            }
            catch {
                // Silently ignore — edge already exists
            }
        }
    }
}
//# sourceMappingURL=CapabilityGraph.js.map
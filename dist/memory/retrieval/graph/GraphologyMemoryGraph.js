/**
 * @fileoverview In-memory graphology-based memory graph (dev/testing).
 *
 * Follows the CapabilityGraph pattern: lazy-loaded graphology,
 * O(1) neighbor lookups, sub-ms traversal for typical memory counts.
 *
 * @module agentos/memory/graph/GraphologyMemoryGraph
 */
import { spreadActivation } from './SpreadingActivation.js';
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
        throw new Error('graphology is required for GraphologyMemoryGraph but was not found. ' +
            'Install it: npm install graphology graphology-types');
    }
}
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
export class GraphologyMemoryGraph {
    constructor() {
        this.graph = null;
    }
    async initialize() {
        const GraphCtor = await resolveGraphology();
        this.graph = new GraphCtor({ multi: false, type: 'undirected' });
    }
    ensureGraph() {
        if (!this.graph)
            throw new Error('GraphologyMemoryGraph not initialized.');
        return this.graph;
    }
    // --- Node operations ---
    async addNode(memoryId, metadata) {
        const g = this.ensureGraph();
        if (g.hasNode(memoryId)) {
            g.replaceNodeAttributes(memoryId, metadata);
        }
        else {
            g.addNode(memoryId, metadata);
        }
    }
    async removeNode(memoryId) {
        const g = this.ensureGraph();
        if (g.hasNode(memoryId)) {
            g.dropNode(memoryId);
        }
    }
    hasNode(memoryId) {
        return this.graph?.hasNode(memoryId) ?? false;
    }
    // --- Edge operations ---
    async addEdge(edge) {
        const g = this.ensureGraph();
        if (!g.hasNode(edge.sourceId) || !g.hasNode(edge.targetId))
            return;
        if (edge.sourceId === edge.targetId)
            return;
        try {
            const existing = g.edge(edge.sourceId, edge.targetId);
            if (existing) {
                const attrs = g.getEdgeAttributes(existing);
                if (edge.weight > attrs.weight) {
                    g.setEdgeAttribute(existing, 'weight', edge.weight);
                    g.setEdgeAttribute(existing, 'type', edge.type);
                }
            }
            else {
                g.addEdge(edge.sourceId, edge.targetId, {
                    type: edge.type,
                    weight: edge.weight,
                    createdAt: edge.createdAt,
                });
            }
        }
        catch {
            // Edge already exists in other direction (undirected)
        }
    }
    getEdges(memoryId, type) {
        const g = this.ensureGraph();
        if (!g.hasNode(memoryId))
            return [];
        const edges = [];
        g.forEachEdge(memoryId, (_edge, attrs, source, target) => {
            const edgeType = attrs.type;
            if (!type || edgeType === type) {
                edges.push({
                    sourceId: source,
                    targetId: target,
                    type: edgeType,
                    weight: attrs.weight,
                    createdAt: attrs.createdAt,
                });
            }
        });
        return edges;
    }
    async removeEdge(sourceId, targetId) {
        const g = this.ensureGraph();
        try {
            const edge = g.edge(sourceId, targetId);
            if (edge)
                g.dropEdge(edge);
        }
        catch { /* no-op */ }
    }
    // --- Spreading activation ---
    async spreadingActivation(seedIds, config) {
        const g = this.ensureGraph();
        // Delegate to pure-function implementation
        return spreadActivation({
            seedIds,
            getNeighbors: (nodeId) => {
                if (!g.hasNode(nodeId))
                    return [];
                const neighbors = [];
                g.forEachEdge(nodeId, (_edge, attrs, source, target) => {
                    const neighborId = source === nodeId ? target : source;
                    neighbors.push({ id: neighborId, weight: attrs.weight });
                });
                return neighbors;
            },
            config,
        });
    }
    // --- Co-activation (Hebbian learning) ---
    async recordCoActivation(memoryIds, learningRate = 0.1) {
        const g = this.ensureGraph();
        const validIds = memoryIds.filter((id) => g.hasNode(id));
        const now = Date.now();
        for (let i = 0; i < validIds.length; i++) {
            for (let j = i + 1; j < validIds.length; j++) {
                try {
                    const existing = g.edge(validIds[i], validIds[j]);
                    if (existing) {
                        const attrs = g.getEdgeAttributes(existing);
                        // Hebbian: strengthen existing connection
                        g.setEdgeAttribute(existing, 'weight', Math.min(1.0, attrs.weight + learningRate));
                    }
                    else {
                        g.addEdge(validIds[i], validIds[j], {
                            type: 'CO_ACTIVATED',
                            weight: learningRate,
                            createdAt: now,
                        });
                    }
                }
                catch { /* edge already exists */ }
            }
        }
    }
    // --- Conflict detection ---
    getConflicts(memoryId) {
        return this.getEdges(memoryId, 'CONTRADICTS');
    }
    // --- Clustering ---
    async detectClusters(minSize = 3) {
        const g = this.ensureGraph();
        if (g.order < minSize)
            return [];
        // Simple connected-component clustering (upgrade to Louvain when graphology-communities is available)
        const visited = new Set();
        const clusters = [];
        let clusterIdx = 0;
        g.forEachNode((nodeId) => {
            if (visited.has(nodeId))
                return;
            // BFS from this node
            const component = [];
            const queue = [nodeId];
            visited.add(nodeId);
            while (queue.length > 0) {
                const current = queue.shift();
                component.push(current);
                g.forEachEdge(current, (_edge, _attrs, source, target) => {
                    const neighbor = source === current ? target : source;
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            }
            if (component.length >= minSize) {
                // Density = actual edges / possible edges
                let edgeCount = 0;
                for (const id of component) {
                    const nodeEdges = this.getEdges(id);
                    edgeCount += nodeEdges.filter((e) => component.includes(e.sourceId === id ? e.targetId : e.sourceId)).length;
                }
                edgeCount /= 2; // undirected
                const possibleEdges = (component.length * (component.length - 1)) / 2;
                clusters.push({
                    clusterId: `cluster_${clusterIdx++}`,
                    memberIds: component,
                    density: possibleEdges > 0 ? edgeCount / possibleEdges : 0,
                });
            }
        });
        return clusters;
    }
    // --- Lifecycle ---
    nodeCount() {
        return this.graph?.order ?? 0;
    }
    edgeCount() {
        return this.graph?.size ?? 0;
    }
    clear() {
        this.graph?.clear();
    }
    async shutdown() {
        this.graph?.clear();
        this.graph = null;
    }
}
//# sourceMappingURL=GraphologyMemoryGraph.js.map
/**
 * @fileoverview Anderson's spreading activation algorithm.
 *
 * Pure function implementation decoupled from graph backend.
 * Used by both GraphologyMemoryGraph and KnowledgeGraphMemoryGraph.
 *
 * Algorithm:
 * 1. Seed nodes start at activation = 1.0
 * 2. Each hop: neighbor_activation = current · edge_weight · decayPerHop
 * 3. Multi-path summation (capped at 1.0)
 * 4. BFS with maxDepth and activationThreshold cutoffs
 * 5. Hebbian rule: co-retrieved memories strengthen edges (caller's responsibility)
 *
 * @module agentos/memory/graph/SpreadingActivation
 */
import type { SpreadingActivationConfig, ActivatedNode } from './IMemoryGraph.js';
export interface SpreadingActivationInput {
    seedIds: string[];
    /** Get neighbors with edge weights. Can be sync or async. */
    getNeighbors: (nodeId: string) => Array<{
        id: string;
        weight: number;
    }> | Promise<Array<{
        id: string;
        weight: number;
    }>>;
    config?: SpreadingActivationConfig;
}
/**
 * Run spreading activation from seed nodes.
 *
 * Returns activated nodes sorted by activation level (descending),
 * excluding seed nodes themselves.
 */
export declare function spreadActivation(input: SpreadingActivationInput): Promise<ActivatedNode[]>;
//# sourceMappingURL=SpreadingActivation.d.ts.map
/**
 * @file ProviderAssignmentEngine.ts
 * @description Assigns LLM providers and models to graph nodes.
 *
 * Five strategies:
 *   best     — top model from each provider
 *   cheapest — cheapest model from each provider
 *   balanced — complexity-based tier selection
 *   explicit — user-specified per-node assignments
 *   mixed    — explicit overrides with a fallback strategy
 */
import type { GraphNode } from '../ir/types.js';
import type { ProviderStrategyConfig, NodeProviderAssignment } from './types.js';
/** Node with an optional complexity annotation from the planner. */
type AnnotatedNode = GraphNode & {
    complexity?: number;
};
/**
 * Assigns LLM providers and models to graph nodes based on strategy.
 */
export declare class ProviderAssignmentEngine {
    private readonly availableProviders;
    private readonly rotation;
    constructor(availableProviders: string[]);
    /**
     * Assign providers/models to all nodes in a graph.
     *
     * @param nodes - Graph nodes, optionally annotated with `complexity` (0-1).
     * @param config - Strategy configuration.
     */
    assign(nodes: AnnotatedNode[], config: ProviderStrategyConfig): NodeProviderAssignment[];
    /** Check whether all required providers are available (have API keys). */
    checkAvailability(assignments: NodeProviderAssignment[]): {
        available: boolean;
        missing: string[];
    };
    private assignBest;
    private assignCheapest;
    private assignBalanced;
    private assignExplicit;
    private assignMixed;
    /** Pick a provider from the preferred list, rotating to avoid pinning all nodes to one provider. */
    private pickProvider;
}
export {};
//# sourceMappingURL=ProviderAssignmentEngine.d.ts.map
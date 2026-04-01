/**
 * @file GraphExpander.ts
 * @description Applies GraphPatch modifications atomically to a CompiledExecutionGraph.
 *
 * Handles:
 * - Node additions and removals
 * - Edge rewiring
 * - Guardrail threshold checks for autonomy gating
 * - Exceeded-threshold reporting
 */
import type { CompiledExecutionGraph } from '../ir/types.js';
import type { GraphPatch, GuardrailThresholds, AutonomyMode } from './types.js';
/** Current resource consumption for threshold checking. */
export interface ExpansionState {
    currentCost: number;
    currentAgentCount: number;
    currentExpansions: number;
    currentToolForges: number;
    currentDepth?: number;
    patchCostDelta: number;
    patchAgentDelta: number;
    patchToolForgeDelta?: number;
    patchDepthDelta?: number;
}
/**
 * Applies GraphPatch modifications atomically to a CompiledExecutionGraph.
 * Checks guardrail thresholds before approving expansions in guardrailed mode.
 */
export declare class GraphExpander {
    private readonly thresholds;
    constructor(thresholds: GuardrailThresholds);
    /**
     * Apply a patch to a graph, returning a new graph (immutable).
     * Patches are applied atomically — all changes happen together.
     */
    applyPatch(graph: CompiledExecutionGraph, patch: GraphPatch): CompiledExecutionGraph;
    /**
     * Determine whether an expansion should be auto-approved
     * based on autonomy mode and resource thresholds.
     *
     * - autonomous: always approve
     * - guided: never auto-approve (requires user input)
     * - guardrailed: approve if below all thresholds
     */
    shouldAutoApprove(autonomy: AutonomyMode, state: ExpansionState): boolean;
    /**
     * Identify which specific threshold was exceeded.
     * Returns null if no threshold is exceeded.
     */
    getExceededThreshold(state: ExpansionState): {
        threshold: string;
        value: number;
        cap: number;
    } | null;
}
//# sourceMappingURL=GraphExpander.d.ts.map
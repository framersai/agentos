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

import type { CompiledExecutionGraph, GraphEdge } from '../ir/types.js';
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
export class GraphExpander {
  private readonly thresholds: GuardrailThresholds;

  constructor(thresholds: GuardrailThresholds) {
    this.thresholds = thresholds;
  }

  /**
   * Apply a patch to a graph, returning a new graph (immutable).
   * Patches are applied atomically — all changes happen together.
   */
  applyPatch(graph: CompiledExecutionGraph, patch: GraphPatch): CompiledExecutionGraph {
    let nodes = [...graph.nodes];
    let edges: GraphEdge[] = [...graph.edges];

    // 1. Remove nodes (and their connected edges)
    if (patch.removeNodes?.length) {
      const removeSet = new Set(patch.removeNodes);
      nodes = nodes.filter((n) => !removeSet.has(n.id));
      edges = edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target));
    }

    // 2. Rewire edges (must happen before adding new edges)
    if (patch.rewireEdges?.length) {
      for (const rewire of patch.rewireEdges) {
        const edge = edges.find((e) => e.source === rewire.from && e.target === rewire.to);
        if (edge) {
          edge.target = rewire.newTarget;
        }
      }
    }

    // 3. Add new nodes
    nodes.push(...patch.addNodes);

    // 4. Add new edges (assign IDs if missing)
    const newEdges: GraphEdge[] = patch.addEdges.map((e, i) => ({
      ...e,
      id: e.id ?? `patch_edge_${Date.now()}_${i}`,
    }));
    edges.push(...newEdges);

    return { ...graph, nodes, edges };
  }

  /**
   * Determine whether an expansion should be auto-approved
   * based on autonomy mode and resource thresholds.
   *
   * - autonomous: always approve
   * - guided: never auto-approve (requires user input)
   * - guardrailed: approve if below all thresholds
   */
  shouldAutoApprove(autonomy: AutonomyMode, state: ExpansionState): boolean {
    if (autonomy === 'autonomous') return true;
    if (autonomy === 'guided') return false;

    const patchToolForgeDelta = state.patchToolForgeDelta ?? 0;
    const currentDepth = state.currentDepth ?? 0;
    const patchDepthDelta = state.patchDepthDelta ?? 0;

    // Guardrailed: check every threshold
    if (state.currentCost + state.patchCostDelta > this.thresholds.maxTotalCost) return false;
    if (state.currentAgentCount + state.patchAgentDelta > this.thresholds.maxAgentCount) return false;
    if (state.currentToolForges + patchToolForgeDelta > this.thresholds.maxToolForges) return false;
    if (state.currentExpansions + 1 > this.thresholds.maxExpansions) return false;
    if (currentDepth + patchDepthDelta > this.thresholds.maxDepth) return false;
    if (state.patchCostDelta > this.thresholds.costPerExpansionCap) return false;

    return true;
  }

  /**
   * Identify which specific threshold was exceeded.
   * Returns null if no threshold is exceeded.
   */
  getExceededThreshold(
    state: ExpansionState,
  ): { threshold: string; value: number; cap: number } | null {
    const patchToolForgeDelta = state.patchToolForgeDelta ?? 0;
    const currentDepth = state.currentDepth ?? 0;
    const patchDepthDelta = state.patchDepthDelta ?? 0;

    if (state.currentCost + state.patchCostDelta > this.thresholds.maxTotalCost) {
      return {
        threshold: 'maxTotalCost',
        value: state.currentCost + state.patchCostDelta,
        cap: this.thresholds.maxTotalCost,
      };
    }
    if (state.currentAgentCount + state.patchAgentDelta > this.thresholds.maxAgentCount) {
      return {
        threshold: 'maxAgentCount',
        value: state.currentAgentCount + state.patchAgentDelta,
        cap: this.thresholds.maxAgentCount,
      };
    }
    if (state.currentToolForges + patchToolForgeDelta > this.thresholds.maxToolForges) {
      return {
        threshold: 'maxToolForges',
        value: state.currentToolForges + patchToolForgeDelta,
        cap: this.thresholds.maxToolForges,
      };
    }
    if (state.currentExpansions + 1 > this.thresholds.maxExpansions) {
      return {
        threshold: 'maxExpansions',
        value: state.currentExpansions + 1,
        cap: this.thresholds.maxExpansions,
      };
    }
    if (currentDepth + patchDepthDelta > this.thresholds.maxDepth) {
      return {
        threshold: 'maxDepth',
        value: currentDepth + patchDepthDelta,
        cap: this.thresholds.maxDepth,
      };
    }
    if (state.patchCostDelta > this.thresholds.costPerExpansionCap) {
      return {
        threshold: 'costPerExpansionCap',
        value: state.patchCostDelta,
        cap: this.thresholds.costPerExpansionCap,
      };
    }
    return null;
  }
}

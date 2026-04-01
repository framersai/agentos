/**
 * @file types.ts
 * @description Types for the self-expanding mission orchestrator.
 *
 * Covers: autonomy modes, provider assignment strategies, Tree of Thought
 * planning primitives, dynamic graph expansion (GraphPatch), guardrail
 * thresholds, and mission-specific event types.
 */
/** Sensible defaults — hit any of these and execution pauses. */
export const DEFAULT_THRESHOLDS = {
    maxTotalCost: 10.0,
    maxAgentCount: 10,
    maxToolForges: 5,
    maxExpansions: 8,
    maxDepth: 3,
    costPerExpansionCap: 2.0,
};
//# sourceMappingURL=types.js.map
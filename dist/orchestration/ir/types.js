/**
 * @file types.ts
 * @description Core Intermediate Representation (IR) types for the AgentOS Unified Orchestration Layer.
 *
 * All three authoring APIs — AgentGraph (graph-based), workflow (sequential), and mission
 * (goal-oriented) — compile down to these IR types before execution. Keeping a single shared IR
 * means the runtime, checkpointing, memory, and diagnostics subsystems only need one implementation.
 *
 * Dependency graph (no circular imports):
 *   primitive enums/constants → condition/executor unions → policy interfaces →
 *   view interfaces → GraphNode / GraphEdge / GraphState → CompiledExecutionGraph
 */
// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------
/** Sentinel node-id representing the implicit entry point of every graph. */
export const START = '__START__';
/** Sentinel node-id representing the implicit exit point of every graph. */
export const END = '__END__';
//# sourceMappingURL=types.js.map
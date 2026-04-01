/**
 * @file MissionCompiler.ts
 * @description Compiles `mission()` builder configuration to a
 * `CompiledExecutionGraph` IR using the current stub planning pipeline.
 *
 * Compilation pipeline:
 *   1. Generate the current stub `SimplePlan`
 *   2. Map plan steps to `GraphNode` objects via `stepToNode()`
 *   3. Splice declared anchors into the phase-ordered node sequence
 *   4. Build a linear edge chain (START → … → END)
 *   5. Apply mission-level guardrail policies to all nodes
 *   6. Lower to `CompiledExecutionGraph` via `GraphCompiler` + `GraphValidator`
 */
import type { GraphNode, CompiledExecutionGraph, MemoryConsistencyMode } from '../ir/types.js';
/**
 * Top-level configuration object consumed by `MissionCompiler.compile()`.
 * Produced internally by `MissionBuilder.compile()`.
 */
export interface MissionConfig {
    /** Human-readable mission name; becomes the compiled graph's display name. */
    name: string;
    /** Zod schema (or plain JSON-Schema object) describing the mission's input payload. */
    inputSchema: any;
    /**
     * Goal prompt template. Supports `{{variable}}` placeholders (e.g. `{{topic}}`).
     * The current stub compiler passes it through to generated reasoning nodes.
     */
    goalTemplate: string;
    /** Zod schema (or plain JSON-Schema object) describing the mission's output artifacts. */
    returnsSchema: any;
    /** Planner configuration controlling step generation and execution budgets. */
    plannerConfig: {
        /** Routing/planning strategy identifier (e.g. `'linear'`, `'react'`, `'tree-of-thought'`). */
        strategy: string;
        /** Hard cap on the total number of plan steps the planner may emit. */
        maxSteps: number;
        /**
         * Maximum LLM iterations a single `gmi` node may consume per invocation.
         * Forwarded to `gmiNode` as `maxInternalIterations`.
         */
        maxIterationsPerNode?: number;
        /**
         * When `true`, `gmi` nodes are configured to issue multiple tool calls per turn.
         * Forwarded to `gmiNode` as `parallelTools`.
         */
        parallelTools?: boolean;
    };
    /**
     * Optional mission-level policy overrides.
     * When set, they are applied to all compiled nodes unless a node already declares
     * its own policy.
     */
    policyConfig?: {
        memory?: {
            consistency?: MemoryConsistencyMode;
            read?: any;
            write?: any;
        };
        discovery?: {
            kind?: string;
            fallback?: string;
        };
        personality?: {
            traitRouting?: boolean;
            adaptStyle?: boolean;
            mood?: string;
        };
        /** Guardrail identifiers applied as output guardrails on every node. */
        guardrails?: string[];
    };
    /**
     * Declarative anchor nodes that must be spliced into the execution order at specific phases.
     * Anchors allow callers to inject pre-built `GraphNode` objects (e.g. specialised tools or
     * human-in-the-loop checkpoints) without modifying the planner output.
     */
    anchors: Array<{
        /** Node id assigned to the anchor inside the compiled graph. */
        id: string;
        /** Pre-built `GraphNode` to splice in. The compiler overwrites `node.id` with `anchor.id`. */
        node: GraphNode;
        /** Placement constraints that control where in the phase sequence the anchor is inserted. */
        constraints: {
            /** When `true` the compiler will throw if the anchor cannot be placed. */
            required: boolean;
            /**
             * Execution phase the anchor belongs to.  Phases are ordered:
             * `gather` → `process` → `validate` → `deliver`.
             */
            phase?: 'gather' | 'process' | 'validate' | 'deliver';
            /**
             * Insert the anchor *after* this node id (sibling anchor id or plan step id).
             * When the referenced id is not found the anchor is appended to the phase tail.
             */
            after?: any;
            /**
             * Insert the anchor *before* this node id.
             * Currently reserved for future use; has no effect in this compiler version.
             */
            before?: any;
        };
    }>;
}
/**
 * Minimal plan structure produced by the current stub planner. Each step maps
 * 1-to-1 to a `GraphNode` in the compiled IR.
 */
export interface SimplePlan {
    steps: Array<{
        /** Unique step id; becomes the compiled `GraphNode.id`. */
        id: string;
        /**
         * Step action type, used to select the correct node builder:
         * - `'reasoning'`   → `gmiNode`
         * - `'tool_call'`   → `toolNode`
         * - `'human_input'` → `humanNode`
         * - `'validation'`  → `guardrailNode`
         */
        action: string;
        /** Human-readable description injected as the node's instructions or prompt. */
        description: string;
        /** Execution phase this step belongs to (governs ordering alongside anchors). */
        phase: 'gather' | 'process' | 'validate' | 'deliver';
        /** Required when `action` is `'tool_call'`; the registered tool name. */
        toolName?: string;
    }>;
}
/**
 * Static compiler that transforms a `MissionConfig` into a `CompiledExecutionGraph`.
 *
 * The compiler is intentionally stateless — call `MissionCompiler.compile()` as many
 * times as needed; each invocation is fully isolated.
 *
 * @example
 * ```ts
 * const ir = MissionCompiler.compile({
 *   name: 'research-mission',
 *   inputSchema: z.object({ topic: z.string() }),
 *   goalTemplate: 'Research {{topic}} and produce a summary',
 *   returnsSchema: z.object({ summary: z.string() }),
 *   plannerConfig: { strategy: 'linear', maxSteps: 5 },
 *   anchors: [],
 * });
 * ```
 */
export declare class MissionCompiler {
    /**
     * Compile a mission config into a `CompiledExecutionGraph`.
     *
     * Uses the current stub planner that generates a simple phase-ordered plan based
     * on the mission goal template. Planner-backed decomposition is not wired into
     * this compiler yet.
     *
     * @param config - Fully-populated `MissionConfig` object produced by `MissionBuilder`.
     * @returns A validated `CompiledExecutionGraph` ready for `GraphRuntime`.
     * @throws {Error} When `GraphValidator.validate()` reports structural errors.
     */
    static compile(config: MissionConfig): CompiledExecutionGraph;
    /**
     * Stub planner: emits a fixed 3-step linear plan derived from the goal template.
     *
     * This is intentionally minimal — its only job is to prove the compilation pipeline
     * works end-to-end.  The real `PlanningEngine` (Task 16+) will replace this method.
     *
     * @param config - Mission configuration providing the goal template and planner settings.
     * @returns A `SimplePlan` with steps distributed across `gather`, `process`, and `deliver` phases.
     */
    private static generateStubPlan;
    /**
     * Convert a single `SimplePlan` step to its corresponding `GraphNode`.
     *
     * The returned node's `id` is immediately overwritten by the caller with `step.id`,
     * so the auto-generated id from the node builders is discarded.
     *
     * @param step   - Plan step descriptor.
     * @param config - Parent mission configuration (provides planner and policy settings).
     * @returns A fully-initialised `GraphNode` whose `id` will be overwritten by the caller.
     */
    private static stepToNode;
}
//# sourceMappingURL=MissionCompiler.d.ts.map
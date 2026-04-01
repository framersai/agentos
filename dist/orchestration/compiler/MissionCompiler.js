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
import { START, END } from '../ir/types.js';
import { gmiNode, toolNode, humanNode, guardrailNode } from '../builders/nodes.js';
import { GraphCompiler } from './GraphCompiler.js';
import { GraphValidator } from './Validator.js';
// ---------------------------------------------------------------------------
// MissionCompiler
// ---------------------------------------------------------------------------
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
export class MissionCompiler {
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
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
    static compile(config) {
        // 1. Generate the current phase-ordered stub plan
        const plan = this.generateStubPlan(config);
        // 2. Map plan steps to GraphNode objects
        const nodes = new Map();
        const edges = [];
        let edgeCounter = 0;
        const nextEdgeId = () => `me-${++edgeCounter}`;
        for (const step of plan.steps) {
            const node = this.stepToNode(step, config);
            nodes.set(step.id, node);
        }
        // 3. Splice anchors — overwrite their id so the compiled graph uses the declared id
        for (const anchor of config.anchors) {
            // Mutate a shallow copy to avoid modifying the caller's object
            const anchoredNode = { ...anchor.node, id: anchor.id };
            nodes.set(anchor.id, anchoredNode);
        }
        // 4. Build a phase-ordered sequence of node ids
        const phaseOrder = [
            'gather',
            'process',
            'validate',
            'deliver',
        ];
        const orderedNodeIds = [];
        for (const phase of phaseOrder) {
            // Plan steps belonging to this phase
            const phaseSteps = plan.steps.filter(s => s.phase === phase);
            for (const step of phaseSteps) {
                orderedNodeIds.push(step.id);
            }
            // Anchors belonging to this phase, respecting `after` constraints
            const phaseAnchors = config.anchors.filter(a => a.constraints.phase === phase);
            for (const anchor of phaseAnchors) {
                if (typeof anchor.constraints.after === 'string') {
                    const afterIdx = orderedNodeIds.indexOf(anchor.constraints.after);
                    if (afterIdx >= 0) {
                        orderedNodeIds.splice(afterIdx + 1, 0, anchor.id);
                        continue;
                    }
                }
                orderedNodeIds.push(anchor.id);
            }
        }
        // Anchors without a phase constraint are appended at the tail
        for (const anchor of config.anchors) {
            if (!anchor.constraints.phase && !orderedNodeIds.includes(anchor.id)) {
                orderedNodeIds.push(anchor.id);
            }
        }
        // 5. Build linear edge chain: START → n₀ → n₁ → … → END
        let prev = START;
        for (const nodeId of orderedNodeIds) {
            edges.push({ id: nextEdgeId(), source: prev, target: nodeId, type: 'static' });
            prev = nodeId;
        }
        edges.push({ id: nextEdgeId(), source: prev, target: END, type: 'static' });
        // 6. Apply mission-level guardrail policy to every node that has none yet
        if (config.policyConfig?.guardrails && config.policyConfig.guardrails.length > 0) {
            for (const [key, node] of nodes) {
                if (!node.guardrailPolicy) {
                    nodes.set(key, {
                        ...node,
                        guardrailPolicy: {
                            output: config.policyConfig.guardrails,
                            onViolation: 'warn',
                        },
                    });
                }
            }
        }
        // 7. Lower to CompiledExecutionGraph via GraphCompiler
        const ir = GraphCompiler.compile({
            name: config.name,
            nodes,
            edges,
            stateSchema: {
                input: config.inputSchema,
                scratch: config.inputSchema,
                artifacts: config.returnsSchema,
            },
            reducers: {},
            memoryConsistency: config.policyConfig?.memory?.consistency ?? 'snapshot',
            checkpointPolicy: 'every_node',
        });
        // 8. Validate structural correctness (acyclicity required for linear missions)
        const validation = GraphValidator.validate(ir, { requireAcyclic: true });
        if (!validation.valid) {
            throw new Error(`Mission compilation failed for "${config.name}": ${validation.errors.join('; ')}`);
        }
        return ir;
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Stub planner: emits a fixed 3-step linear plan derived from the goal template.
     *
     * This is intentionally minimal — its only job is to prove the compilation pipeline
     * works end-to-end.  The real `PlanningEngine` (Task 16+) will replace this method.
     *
     * @param config - Mission configuration providing the goal template and planner settings.
     * @returns A `SimplePlan` with steps distributed across `gather`, `process`, and `deliver` phases.
     */
    static generateStubPlan(config) {
        return {
            steps: [
                {
                    id: 'gather-info',
                    action: 'reasoning',
                    description: `Gather information for: ${config.goalTemplate}`,
                    phase: 'gather',
                },
                {
                    id: 'process-info',
                    action: 'reasoning',
                    description: 'Process and analyse gathered information',
                    phase: 'process',
                },
                {
                    id: 'deliver-result',
                    action: 'reasoning',
                    description: 'Deliver final result',
                    phase: 'deliver',
                },
            ],
        };
    }
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
    static stepToNode(step, config) {
        switch (step.action) {
            case 'tool_call':
                return { ...toolNode(step.toolName ?? 'unknown'), id: step.id };
            case 'human_input':
                return { ...humanNode({ prompt: step.description }), id: step.id };
            case 'validation':
                return {
                    ...guardrailNode(config.policyConfig?.guardrails ?? [], { onViolation: 'warn' }),
                    id: step.id,
                };
            case 'reasoning':
            default:
                return {
                    ...gmiNode({
                        instructions: step.description,
                        executionMode: 'planner_controlled',
                        maxInternalIterations: config.plannerConfig.maxIterationsPerNode,
                        parallelTools: config.plannerConfig.parallelTools,
                    }),
                    id: step.id,
                };
        }
    }
}
//# sourceMappingURL=MissionCompiler.js.map
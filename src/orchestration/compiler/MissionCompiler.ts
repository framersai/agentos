/**
 * @file MissionCompiler.ts
 * @description Bridges PlanningEngine output (or the stub planner) to a
 * `CompiledExecutionGraph` IR, enabling goal-oriented mission authoring via
 * the `mission()` builder API.
 *
 * Compilation pipeline:
 *   1. Run stub planner → `SimplePlan` (real PlanningEngine wired later)
 *   2. Map plan steps to `GraphNode` objects via `stepToNode()`
 *   3. Splice declared anchors into the phase-ordered node sequence
 *   4. Build a linear edge chain (START → … → END)
 *   5. Apply mission-level guardrail policies to all nodes
 *   6. Lower to `CompiledExecutionGraph` via `GraphCompiler` + `GraphValidator`
 */

import type {
  GraphNode,
  GraphEdge,
  CompiledExecutionGraph,
  MemoryConsistencyMode,
} from '../ir/types.js';
import { START, END } from '../ir/types.js';
import { gmiNode, toolNode, humanNode, guardrailNode } from '../builders/nodes.js';
import { GraphCompiler } from './GraphCompiler.js';
import { GraphValidator } from './Validator.js';

// ---------------------------------------------------------------------------
// Public configuration types
// ---------------------------------------------------------------------------

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
   * Goal prompt template.  Supports `{{variable}}` interpolation (e.g. `{{topic}}`).
   * Injected as the system instruction for the stub planner and `gmi` reasoning nodes.
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
    memory?: { consistency?: MemoryConsistencyMode; read?: any; write?: any };
    discovery?: { kind?: string; fallback?: string };
    personality?: { traitRouting?: boolean; adaptStyle?: boolean; mood?: string };
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

// ---------------------------------------------------------------------------
// Internal plan representation
// ---------------------------------------------------------------------------

/**
 * Minimal plan structure produced by the stub planner (and, eventually, by the
 * real `PlanningEngine`).  Each step maps 1-to-1 to a `GraphNode` in the compiled IR.
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
   * Uses a stub planner that generates a simple linear plan based on the goal template.
   * Real `PlanningEngine` integration will be wired in a future task once the planner
   * interface is stable.
   *
   * @param config - Fully-populated `MissionConfig` object produced by `MissionBuilder`.
   * @returns A validated `CompiledExecutionGraph` ready for `GraphRuntime`.
   * @throws {Error} When `GraphValidator.validate()` reports structural errors.
   */
  static compile(config: MissionConfig): CompiledExecutionGraph {
    // 1. Generate a linear plan (stub — real planner integration planned for Task 16+)
    const plan = this.generateStubPlan(config);

    // 2. Map plan steps to GraphNode objects
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    let edgeCounter = 0;
    const nextEdgeId = (): string => `me-${++edgeCounter}`;

    for (const step of plan.steps) {
      const node = this.stepToNode(step, config);
      nodes.set(step.id, node);
    }

    // 3. Splice anchors — overwrite their id so the compiled graph uses the declared id
    for (const anchor of config.anchors) {
      // Mutate a shallow copy to avoid modifying the caller's object
      const anchoredNode: GraphNode = { ...anchor.node, id: anchor.id };
      nodes.set(anchor.id, anchoredNode);
    }

    // 4. Build a phase-ordered sequence of node ids
    const phaseOrder: Array<'gather' | 'process' | 'validate' | 'deliver'> = [
      'gather',
      'process',
      'validate',
      'deliver',
    ];
    const orderedNodeIds: string[] = [];

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
          const afterIdx = orderedNodeIds.indexOf(anchor.constraints.after as string);
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
    let prev: string = START;
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
      throw new Error(
        `Mission compilation failed for "${config.name}": ${validation.errors.join('; ')}`,
      );
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
  private static generateStubPlan(config: MissionConfig): SimplePlan {
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
  private static stepToNode(
    step: SimplePlan['steps'][0],
    config: MissionConfig,
  ): GraphNode {
    switch (step.action) {
      case 'tool_call':
        return { ...toolNode(step.toolName ?? 'unknown'), id: step.id };

      case 'human_input':
        return { ...humanNode({ prompt: step.description }), id: step.id };

      case 'validation':
        return {
          ...guardrailNode(
            config.policyConfig?.guardrails ?? [],
            { onViolation: 'warn' },
          ),
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

/**
 * @file GraphRuntime.ts
 * @description Main execution engine for the AgentOS Unified Orchestration Layer.
 *
 * `GraphRuntime` ties together the `StateManager`, `NodeScheduler`, `NodeExecutor`,
 * and `ICheckpointStore` subsystems into a single runnable unit. It supports three
 * execution modes:
 *
 * - **`invoke()`** — execute a graph to completion and return final artifacts.
 * - **`stream()`** — execute a graph while yielding `GraphEvent` values at every step.
 * - **`resume()`** — restore a previously interrupted run from its latest checkpoint.
 *
 * Design principles:
 * - No mutable instance state beyond the injected config; each `invoke`/`stream`/`resume`
 *   call is fully isolated.
 * - All state lives in `GraphState`; `StateManager` is the sole authority for mutations.
 * - Checkpointing is always delegated to the injected `ICheckpointStore`.
 * - Edge evaluation is a pure function of `GraphEdge[]`, `GraphState`, and `NodeExecutionResult`.
 */

import type { CompiledExecutionGraph, GraphEdge, GraphState } from '../ir/types.js';
import { END } from '../ir/types.js';
import type { GraphEvent } from '../events/GraphEvent.js';
import type { ICheckpointStore, Checkpoint } from '../checkpoint/ICheckpointStore.js';
import { StateManager } from './StateManager.js';
import { NodeScheduler } from './NodeScheduler.js';
import { NodeExecutor, type NodeExecutionResult } from './NodeExecutor.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Dependencies required to construct a `GraphRuntime`.
 *
 * @property checkpointStore - Persistence backend for checkpoint snapshots.
 * @property nodeExecutor    - Dispatcher that runs individual graph nodes.
 */
export interface GraphRuntimeConfig {
  /** Persistence backend for checkpoint snapshots. */
  checkpointStore: ICheckpointStore;
  /** Dispatcher that executes individual `GraphNode` instances. */
  nodeExecutor: NodeExecutor;
}

// ---------------------------------------------------------------------------
// GraphRuntime
// ---------------------------------------------------------------------------

/**
 * Main execution engine for compiled AgentOS graphs.
 *
 * Instantiate once and reuse across multiple runs — the runtime itself is stateless
 * between calls. Each `invoke()` / `stream()` / `resume()` call creates isolated local
 * state tracked via closures.
 *
 * @example
 * ```ts
 * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
 * const result = await runtime.invoke(compiledGraph, { query: 'hello' });
 * ```
 */
export class GraphRuntime {
  /**
   * @param config - Injected dependencies shared across all runs handled by this instance.
   */
  constructor(private readonly config: GraphRuntimeConfig) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Execute the graph to completion and return the final `artifacts` payload.
   *
   * This is a convenience wrapper around `stream()` that discards intermediate events
   * and awaits the terminal `run_end` event.
   *
   * @param graph - Compiled execution graph to run.
   * @param input - Initial user-provided input; frozen into `GraphState.input`.
   * @returns The `GraphState.artifacts` value after the last node completes.
   */
  async invoke(graph: CompiledExecutionGraph, input: unknown): Promise<unknown> {
    let finalOutput: unknown;
    for await (const event of this.stream(graph, input)) {
      if (event.type === 'run_end') finalOutput = event.finalOutput;
    }
    return finalOutput;
  }

  /**
   * Execute the graph while yielding `GraphEvent` values at each significant step.
   *
   * Events are emitted in strict causal order:
   * `run_start` → (`node_start` → `node_end` → `edge_transition`?)+ → `run_end`
   *
   * Checkpoints are saved according to both the graph-wide `checkpointPolicy` and
   * per-node `checkpoint` settings. An `interrupt` event causes immediate suspension
   * followed by a terminal `run_end`.
   *
   * @param graph - Compiled execution graph to run.
   * @param input - Initial user-provided input; frozen into `GraphState.input`.
   * @yields {GraphEvent} Runtime events in causal order.
   */
  async *stream(graph: CompiledExecutionGraph, input: unknown): AsyncGenerator<GraphEvent> {
    const runId = crypto.randomUUID();
    const stateManager = new StateManager(graph.reducers);
    const scheduler = new NodeScheduler(graph.nodes, graph.edges);

    let state = stateManager.initialize(input);
    const startTime = Date.now();

    /** Node ids whose execution has fully completed in this run. */
    const completedNodes: string[] = [];
    /** Node ids that were bypassed due to conditional routing. */
    const skippedNodes: string[] = [];
    /** Per-node execution results accumulated for checkpoint persistence. */
    const nodeResults: Record<string, { effectClass: string; output: unknown; durationMs: number }> = {};

    yield { type: 'run_start', runId, graphId: graph.id };

    while (true) {
      const readyNodes = scheduler.getReadyNodes(completedNodes, skippedNodes);
      if (readyNodes.length === 0) break; // All work is done (or no START edge).

      for (const nodeId of readyNodes) {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (!node) {
          // Node declared in edges but missing from nodes array — skip defensively.
          skippedNodes.push(nodeId);
          continue;
        }

        state = stateManager.recordNodeVisit(state, nodeId);

        // ── Checkpoint BEFORE ────────────────────────────────────────────────
        if (node.checkpoint === 'before' || node.checkpoint === 'both') {
          await this.saveCheckpoint(graph, runId, nodeId, state, nodeResults, completedNodes);
          yield { type: 'checkpoint_saved', checkpointId: `${runId}-${nodeId}-before`, nodeId };
        }

        yield { type: 'node_start', nodeId, state: { input: state.input, scratch: state.scratch } };
        const nodeStart = Date.now();

        // ── Execute ───────────────────────────────────────────────────────────
        const result = await this.config.nodeExecutor.execute(node, state);
        const durationMs = Date.now() - nodeStart;

        nodeResults[nodeId] = {
          effectClass: node.effectClass,
          output: result.output,
          durationMs,
        };

        // Apply state patches produced by the node.
        if (result.scratchUpdate) {
          state = stateManager.updateScratch(state, result.scratchUpdate);
        }
        if (result.artifactsUpdate) {
          state = stateManager.updateArtifacts(state, result.artifactsUpdate);
        }

        yield { type: 'node_end', nodeId, output: result.output, durationMs };

        // ── Human interrupt ───────────────────────────────────────────────────
        if (result.interrupt) {
          yield { type: 'interrupt', nodeId, reason: 'human_approval' };
          // Persist so the run can be resumed later.
          await this.saveCheckpoint(graph, runId, nodeId, state, nodeResults, completedNodes);
          yield {
            type: 'run_end',
            runId,
            finalOutput: state.artifacts,
            totalDurationMs: Date.now() - startTime,
          };
          return;
        }

        completedNodes.push(nodeId);

        // ── Checkpoint AFTER ──────────────────────────────────────────────────
        if (
          node.checkpoint === 'after' ||
          node.checkpoint === 'both' ||
          graph.checkpointPolicy === 'every_node'
        ) {
          await this.saveCheckpoint(graph, runId, nodeId, state, nodeResults, completedNodes);
          yield { type: 'checkpoint_saved', checkpointId: `${runId}-${nodeId}-after`, nodeId };
        }

        // ── Edge routing ──────────────────────────────────────────────────────
        const outEdges = graph.edges.filter(e => e.source === nodeId);
        const targets = this.evaluateEdges(outEdges, state, result);

        // Any conditional-edge target that was NOT selected is marked as skipped
        // so downstream nodes that depend only on the skipped branch do not block.
        for (const edge of outEdges) {
          if (edge.type === 'conditional' || edge.type === 'personality') {
            for (const potentialTarget of outEdges.map(e => e.target)) {
              if (
                !targets.includes(potentialTarget) &&
                !completedNodes.includes(potentialTarget) &&
                !skippedNodes.includes(potentialTarget)
              ) {
                skippedNodes.push(potentialTarget);
              }
            }
          }
        }

        for (const target of targets) {
          if (target !== END) {
            const edgeType = outEdges.find(e => e.target === target)?.type ?? 'static';
            yield { type: 'edge_transition', sourceId: nodeId, targetId: target, edgeType };
          }
        }
      }
    }

    yield {
      type: 'run_end',
      runId,
      finalOutput: state.artifacts,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Resume a previously interrupted run from its latest persisted checkpoint.
   *
   * The runtime restores `GraphState` from the checkpoint and re-executes any nodes
   * that had not yet completed when the run was suspended. Nodes recorded as
   * `write`, `external`, or `human` effect-class are replayed from their stored
   * outputs to avoid duplicate side-effects; all other nodes are re-executed.
   *
   * @param graph - The same compiled graph that was originally invoked.
   * @param runId - The run identifier returned by the original `stream()` call.
   * @returns The final `GraphState.artifacts` value after resumption completes.
   * @throws {Error} When no checkpoint exists for the given `runId`.
   */
  async resume(graph: CompiledExecutionGraph, runId: string): Promise<unknown> {
    const checkpoint = await this.config.checkpointStore.latest(runId);
    if (!checkpoint) throw new Error(`No checkpoint found for run ${runId}`);

    // Reconstruct graph state from the persisted snapshot.
    const stateManager = new StateManager(graph.reducers);
    let state = stateManager.initialize(checkpoint.state.input);
    state = {
      ...state,
      scratch: checkpoint.state.scratch as GraphState['scratch'],
      artifacts: checkpoint.state.artifacts as GraphState['artifacts'],
      visitedNodes: [...checkpoint.visitedNodes],
      iteration: checkpoint.visitedNodes.length,
    };

    let finalOutput: unknown;
    for await (const event of this.continueFromCheckpoint(graph, runId, state, checkpoint)) {
      if (event.type === 'run_end') finalOutput = event.finalOutput;
    }
    return finalOutput;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Continue execution from a restored checkpoint state.
   *
   * Mirrors `stream()` but initialises `completedNodes` / `nodeResults` from the
   * checkpoint so previously-finished work is not repeated. Nodes with side-effectful
   * effect classes are replayed from stored outputs; pure / read nodes are re-executed.
   *
   * @param graph      - The compiled execution graph.
   * @param runId      - Original run identifier for checkpoint persistence.
   * @param state      - `GraphState` restored from the checkpoint.
   * @param checkpoint - Full checkpoint snapshot; provides `nodeResults` and `visitedNodes`.
   * @yields {GraphEvent} Runtime events in causal order, starting from the resume point.
   */
  private async *continueFromCheckpoint(
    graph: CompiledExecutionGraph,
    runId: string,
    state: GraphState,
    checkpoint: Checkpoint,
  ): AsyncGenerator<GraphEvent> {
    const scheduler = new NodeScheduler(graph.nodes, graph.edges);
    const stateManager = new StateManager(graph.reducers);

    const completedNodes = [...checkpoint.visitedNodes];
    const skippedNodes: string[] = [];
    const nodeResults = { ...checkpoint.nodeResults };
    const startTime = Date.now();

    yield { type: 'run_start', runId, graphId: graph.id };

    while (true) {
      const readyNodes = scheduler.getReadyNodes(completedNodes, skippedNodes);
      if (readyNodes.length === 0) break;

      for (const nodeId of readyNodes) {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (!node) {
          skippedNodes.push(nodeId);
          continue;
        }

        // Nodes with side-effects that were recorded are replayed from stored output
        // to prevent duplicate writes/calls.
        const recorded = checkpoint.nodeResults[nodeId];
        if (
          recorded &&
          (recorded.effectClass === 'write' ||
            recorded.effectClass === 'external' ||
            recorded.effectClass === 'human')
        ) {
          completedNodes.push(nodeId);
          yield { type: 'node_end', nodeId, output: recorded.output, durationMs: recorded.durationMs };
          continue;
        }

        // Re-execute the node (pure / read effects, or nodes without a stored result).
        state = stateManager.recordNodeVisit(state, nodeId);
        yield { type: 'node_start', nodeId, state: { input: state.input, scratch: state.scratch } };
        const nodeStart = Date.now();

        const result = await this.config.nodeExecutor.execute(node, state);
        const durationMs = Date.now() - nodeStart;

        nodeResults[nodeId] = { effectClass: node.effectClass, output: result.output, durationMs };

        if (result.scratchUpdate) state = stateManager.updateScratch(state, result.scratchUpdate);
        if (result.artifactsUpdate) state = stateManager.updateArtifacts(state, result.artifactsUpdate);

        yield { type: 'node_end', nodeId, output: result.output, durationMs };
        completedNodes.push(nodeId);

        // Evaluate outgoing edges for the resumed node.
        const outEdges = graph.edges.filter(e => e.source === nodeId);
        const targets = this.evaluateEdges(outEdges, state, result);

        for (const target of targets) {
          if (target !== END) {
            const edgeType = outEdges.find(e => e.target === target)?.type ?? 'static';
            yield { type: 'edge_transition', sourceId: nodeId, targetId: target, edgeType };
          }
        }
      }
    }

    yield {
      type: 'run_end',
      runId,
      finalOutput: state.artifacts,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Evaluate the outgoing edges from a just-completed node and return the list of
   * target node ids to activate next.
   *
   * Priority rule: if `result.routeTarget` is set (returned by `router` or `guardrail`
   * nodes) it overrides any edge-derived targets.
   *
   * @param edges  - All outgoing edges from the source node.
   * @param state  - Current `GraphState` passed to condition functions.
   * @param result - Execution result; `routeTarget` takes precedence when present.
   * @returns Ordered array of target node ids (may include `END`).
   */
  private evaluateEdges(
    edges: GraphEdge[],
    state: GraphState,
    result: NodeExecutionResult,
  ): string[] {
    // Router / guardrail nodes return an explicit target that takes precedence.
    if (result.routeTarget) {
      return [result.routeTarget];
    }

    const targets: string[] = [];

    for (const edge of edges) {
      switch (edge.type) {
        case 'static':
          // Always follow static edges.
          targets.push(edge.target);
          break;

        case 'conditional': {
          if (!edge.condition) break;

          let resolvedTarget: string;
          if (edge.condition.type === 'function') {
            // Call the author-provided TypeScript routing function.
            resolvedTarget = edge.condition.fn(state);
          } else {
            // Expression evaluation is a stub; returns the raw expression until the
            // DSL interpreter is implemented (tracked separately).
            resolvedTarget = edge.target;
          }

          // Only add the target if the condition resolved to this edge's target.
          if (resolvedTarget === edge.target && !targets.includes(resolvedTarget)) {
            targets.push(resolvedTarget);
          }
          break;
        }

        case 'personality':
          if (edge.personalityCondition) {
            // Stub: always route to the 'above' branch until personality integration lands.
            targets.push(edge.personalityCondition.above);
          }
          break;

        case 'discovery':
          // Stub: fall back to the declared fallback target until discovery is wired.
          if (edge.discoveryFallback) targets.push(edge.discoveryFallback);
          break;
      }
    }

    return targets;
  }

  /**
   * Serialize the current execution state into a `Checkpoint` and persist it
   * via the injected `ICheckpointStore`.
   *
   * @param graph        - The compiled graph (provides `id`).
   * @param runId        - Unique run identifier assigned at `stream()` call-time.
   * @param nodeId       - The node at whose boundary the checkpoint is being taken.
   * @param state        - Current full `GraphState`.
   * @param nodeResults  - Accumulated per-node execution results.
   * @param visitedNodes - Ordered list of completed node ids.
   */
  private async saveCheckpoint(
    graph: CompiledExecutionGraph,
    runId: string,
    nodeId: string,
    state: GraphState,
    nodeResults: Record<string, { effectClass: string; output: unknown; durationMs: number }>,
    visitedNodes: string[],
  ): Promise<void> {
    const checkpoint: Checkpoint = {
      id: `${runId}-${nodeId}-${Date.now()}`,
      graphId: graph.id,
      runId,
      nodeId,
      timestamp: Date.now(),
      state: {
        input: state.input,
        scratch: state.scratch,
        artifacts: state.artifacts,
        diagnostics: state.diagnostics,
      },
      // Cast: checkpoint type requires EffectClass but we store as string for flexibility.
      nodeResults: nodeResults as Checkpoint['nodeResults'],
      visitedNodes: [...visitedNodes],
      pendingEdges: [],
    };
    await this.config.checkpointStore.save(checkpoint);
  }
}

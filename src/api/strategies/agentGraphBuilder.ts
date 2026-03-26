/**
 * @file agentGraphBuilder.ts
 * High-level builder for agent-to-agent dependency graphs.
 *
 * Wraps the low-level CompiledExecutionGraph IR with agent-centric syntax,
 * making it easy to declare multi-agent DAGs without manually constructing
 * graph nodes and edges.
 *
 * The builder handles:
 *  - Converting agent configs into GMI nodes
 *  - Auto-generating START -> root nodes and leaf nodes -> END edges
 *  - Resolving `dependsOn` declarations into proper graph edges
 *  - Setting up appropriate state reducers for inter-agent data flow
 *  - Cycle detection via topological sort validation
 *
 * @example
 * ```ts
 * const graph = agentGraph()
 *   .agent('researcher', { instructions: 'Find sources', tools: [webSearch] })
 *   .agent('writer', { instructions: 'Write article', dependsOn: ['researcher'] })
 *   .agent('editor', { instructions: 'Review article', dependsOn: ['writer'] })
 *   .compile();
 *
 * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
 * const result = await runtime.invoke(graph, { prompt: 'Write about TypeScript' });
 * ```
 *
 * @see {@link agentGraph} -- the entry-point factory function.
 * @see {@link compileAgencyToGraph} -- the strategy-based compiler (an alternative).
 */

import type {
  CompiledExecutionGraph,
  GraphNode,
  GraphEdge,
  StateReducers,
} from '../../orchestration/ir/types.js';
import { START, END } from '../../orchestration/ir/types.js';

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Configuration for a single agent node in the graph builder.
 *
 * Extends the minimal set of fields needed to create a GMI node,
 * plus a `dependsOn` array that declares execution dependencies.
 */
export interface AgentNodeConfig {
  /** System instructions for this agent's GMI node. */
  instructions: string;

  /**
   * Names of agents that must complete before this agent can run.
   * Creates static edges from each dependency to this agent.
   * Agents with no dependencies are "root" nodes connected from START.
   *
   * @example `dependsOn: ['researcher']` -- waits for researcher to finish
   */
  dependsOn?: string[];

  /**
   * Optional tool names available to this agent.
   * Informational -- actual tool wiring happens at the NodeExecutor level.
   */
  tools?: unknown[];

  /**
   * Optional model override for this specific agent.
   * When omitted, the agent uses the graph-wide default.
   */
  model?: string;

  /**
   * Maximum ReAct iterations for this agent's GMI node.
   * Controls how many tool-call rounds the agent can perform.
   * @default 10
   */
  maxIterations?: number;

  /**
   * Sampling temperature forwarded to the LLM provider.
   * Lower values produce more deterministic output.
   */
  temperature?: number;
}

/**
 * Internal record of a registered agent within the builder.
 * Tracks the order of registration for deterministic compilation.
 */
interface AgentRegistration {
  /** The agent's unique name in the graph. */
  name: string;
  /** The agent's configuration. */
  config: AgentNodeConfig;
  /** Registration order index. */
  order: number;
}

// ---------------------------------------------------------------------------
// AgentGraphBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for constructing agent-to-agent dependency graphs.
 *
 * Usage:
 * 1. Call `.agent(name, config)` for each agent in the graph.
 * 2. Declare dependencies via `config.dependsOn`.
 * 3. Call `.compile()` to produce a `CompiledExecutionGraph`.
 *
 * The builder validates at compile time that:
 *  - All `dependsOn` references point to registered agents
 *  - The dependency graph contains no cycles
 *  - At least one agent is registered
 *
 * @example
 * ```ts
 * const graph = agentGraph()
 *   .agent('a', { instructions: 'Do A' })
 *   .agent('b', { instructions: 'Do B', dependsOn: ['a'] })
 *   .agent('c', { instructions: 'Do C', dependsOn: ['a'] })
 *   .agent('d', { instructions: 'Do D', dependsOn: ['b', 'c'] })
 *   .compile();
 * ```
 */
export class AgentGraphBuilder {
  /** Map of agent name -> registration record. Preserves insertion order. */
  private readonly agents = new Map<string, AgentRegistration>();

  /** Running counter for deterministic ordering. */
  private orderCounter = 0;

  /**
   * Registers an agent node in the graph.
   *
   * @param name - Unique name for this agent. Must not conflict with
   *   START/END sentinels or previously registered names.
   * @param config - Agent configuration including instructions and dependencies.
   * @returns `this` for fluent chaining.
   * @throws {Error} When the name is already registered or conflicts with sentinels.
   *
   * @example
   * ```ts
   * builder.agent('researcher', {
   *   instructions: 'Find sources on the given topic.',
   *   dependsOn: [],
   * });
   * ```
   */
  agent(name: string, config: AgentNodeConfig): this {
    if (this.agents.has(name)) {
      throw new Error(`Agent "${name}" is already registered in the graph builder`);
    }
    if (name === START || name === END) {
      throw new Error(`Agent name cannot be "${name}" -- reserved sentinel`);
    }

    this.agents.set(name, {
      name,
      config,
      order: this.orderCounter++,
    });

    return this;
  }

  /**
   * Compiles all registered agents into a `CompiledExecutionGraph`.
   *
   * The compilation process:
   * 1. Validates all `dependsOn` references point to registered agents.
   * 2. Detects cycles via Kahn's topological sort algorithm.
   * 3. Creates a GMI node for each agent.
   * 4. Creates START -> root nodes edges (agents with no dependencies).
   * 5. Creates dependency edges between agents.
   * 6. Creates leaf nodes -> END edges (agents with no dependents).
   * 7. Sets up state reducers for inter-agent data flow.
   *
   * @returns A fully compiled execution graph ready for GraphRuntime.
   * @throws {Error} When no agents are registered.
   * @throws {Error} When a `dependsOn` reference points to an unknown agent.
   * @throws {Error} When the dependency graph contains a cycle.
   *
   * @example
   * ```ts
   * const graph = builder.compile();
   * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
   * const result = await runtime.invoke(graph, { prompt: 'Hello' });
   * ```
   */
  compile(): CompiledExecutionGraph {
    if (this.agents.size === 0) {
      throw new Error('Cannot compile an empty agent graph -- register at least one agent');
    }

    // ------------------------------------------------------------------
    // Phase 1: Validate dependency references
    // ------------------------------------------------------------------
    for (const [name, reg] of this.agents) {
      for (const dep of reg.config.dependsOn ?? []) {
        if (!this.agents.has(dep)) {
          throw new Error(
            `Agent "${name}" depends on "${dep}" which is not registered in the graph`,
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // Phase 2: Cycle detection via Kahn's algorithm
    // ------------------------------------------------------------------
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const [name] of this.agents) {
      inDegree.set(name, 0);
      adjacency.set(name, []);
    }

    for (const [name, reg] of this.agents) {
      for (const dep of reg.config.dependsOn ?? []) {
        adjacency.get(dep)!.push(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (sorted.length < this.agents.size) {
      const stuck = [...this.agents.keys()].filter(n => !sorted.includes(n));
      throw new Error(
        `Cycle detected in agent graph. Stuck agents: ${stuck.join(', ')}`,
      );
    }

    // ------------------------------------------------------------------
    // Phase 3: Build graph nodes
    // ------------------------------------------------------------------
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let edgeId = 0;

    // Track which agents have dependents so we can identify leaf nodes.
    const hasDependents = new Set<string>();
    for (const [, reg] of this.agents) {
      for (const dep of reg.config.dependsOn ?? []) {
        hasDependents.add(dep);
      }
    }

    for (const [name, reg] of this.agents) {
      const config = reg.config;
      const depKeys = (config.dependsOn ?? []).map(d => `output_${d}`);

      // Build context instructions: tell the agent where to find
      // predecessor outputs in the scratch partition.
      const contextInstructions = depKeys.length > 0
        ? `\n\nRead the following scratch keys for context from your dependencies: ${depKeys.join(', ')}.`
        : '\n\nRead scratch.prompt for the initial task.';

      const nodeId = `agent_${name}`;
      nodes.push({
        id: nodeId,
        type: 'gmi',
        executorConfig: {
          type: 'gmi',
          instructions:
            `You are agent "${name}". ${config.instructions}${contextInstructions}` +
            `\n\nWrite your output to scratch key "output_${name}".`,
          maxInternalIterations: config.maxIterations,
          temperature: config.temperature,
        },
        executionMode: config.maxIterations && config.maxIterations > 1
          ? 'react_bounded'
          : 'single_turn',
        effectClass: 'pure',
        checkpoint: 'after',
      });

      // ------------------------------------------------------------------
      // Phase 4: Wire edges
      // ------------------------------------------------------------------

      const deps = config.dependsOn ?? [];

      if (deps.length === 0) {
        // Root node: connect from START.
        edges.push({
          id: `edge_${edgeId++}`,
          source: START,
          target: nodeId,
          type: 'static',
        });
      } else {
        // Connect from each dependency.
        for (const dep of deps) {
          edges.push({
            id: `edge_${edgeId++}`,
            source: `agent_${dep}`,
            target: nodeId,
            type: 'static',
          });
        }
      }

      // Leaf node: connect to END.
      if (!hasDependents.has(name)) {
        edges.push({
          id: `edge_${edgeId++}`,
          source: nodeId,
          target: END,
          type: 'static',
        });
      }
    }

    // ------------------------------------------------------------------
    // Phase 5: State reducers
    // ------------------------------------------------------------------
    const reducers: StateReducers = {};
    for (const [name] of this.agents) {
      // Each agent writes to its own output key.
      reducers[`scratch.output_${name}`] = 'last';
    }
    // Collected outputs for downstream synthesis.
    reducers['scratch.agentOutputs'] = 'concat';

    return {
      id: `agent-graph-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Agent Graph',
      nodes,
      edges,
      stateSchema: {
        input: { type: 'object', properties: { prompt: { type: 'string' } } },
        scratch: { type: 'object' },
        artifacts: { type: 'object' },
      },
      reducers,
      checkpointPolicy: 'explicit',
      memoryConsistency: 'live',
    };
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Creates a new AgentGraphBuilder instance.
 *
 * This is the recommended entry point for building agent dependency graphs.
 * The builder provides a fluent API for declaring agents and their dependencies,
 * then compiles to a CompiledExecutionGraph for execution by GraphRuntime.
 *
 * @returns A fresh AgentGraphBuilder ready for agent registration.
 *
 * @example
 * ```ts
 * import { agentGraph } from './agentGraphBuilder.js';
 *
 * const graph = agentGraph()
 *   .agent('researcher', { instructions: 'Find sources', tools: [webSearch] })
 *   .agent('writer', { instructions: 'Write article', dependsOn: ['researcher'] })
 *   .agent('editor', { instructions: 'Review article', dependsOn: ['writer'] })
 *   .compile();
 *
 * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
 * const result = await runtime.invoke(graph, { prompt: 'Write about TypeScript' });
 * ```
 *
 * @see {@link AgentGraphBuilder} -- the builder class.
 * @see {@link compileAgencyToGraph} -- the strategy-based compiler for agency() configs.
 */
export function agentGraph(): AgentGraphBuilder {
  return new AgentGraphBuilder();
}

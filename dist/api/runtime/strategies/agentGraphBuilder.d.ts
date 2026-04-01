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
import type { CompiledExecutionGraph } from '../../../orchestration/ir/types.js';
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
export declare class AgentGraphBuilder {
    /** Map of agent name -> registration record. Preserves insertion order. */
    private readonly agents;
    /** Running counter for deterministic ordering. */
    private orderCounter;
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
    agent(name: string, config: AgentNodeConfig): this;
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
    compile(): CompiledExecutionGraph;
}
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
export declare function agentGraph(): AgentGraphBuilder;
//# sourceMappingURL=agentGraphBuilder.d.ts.map
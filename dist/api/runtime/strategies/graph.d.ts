import type { AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compiles a graph (DAG) execution strategy.
 *
 * Agents are grouped into tiers by topological sort. Within each tier,
 * agents run concurrently. Each agent receives the original prompt plus
 * the concatenated outputs of all its `dependsOn` predecessors.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 */
export declare function compileGraph(agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
//# sourceMappingURL=graph.d.ts.map
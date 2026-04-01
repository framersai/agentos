/**
 * @file index.ts
 * Strategy compiler dispatcher for the Agency API.
 *
 * Maps an {@link AgencyStrategy} discriminant to the concrete compiler that
 * produces a {@link CompiledStrategy}. Supports sequential, parallel, debate,
 * review-loop, hierarchical, and graph strategies.
 *
 * ## Adaptive mode
 *
 * When `adaptive` mode is enabled on a non-hierarchical strategy, the dispatcher
 * wraps it with an implicit hierarchical manager that may override the default
 * strategy at runtime. This works by:
 *
 * 1. Appending strategy-awareness instructions to the manager prompt.
 * 2. Setting `adaptive: false` on the inner call to prevent infinite recursion.
 * 3. Delegating to `compileHierarchical()` which creates delegation tools.
 *
 * The adaptive wrapper is transparent to the caller -- it still receives a
 * standard {@link CompiledStrategy} with `execute` and `stream` methods.
 *
 * @see {@link compileStrategy} -- the main entry point for strategy compilation.
 * @see {@link agency} -- the factory that calls compileStrategy during construction.
 */
import type { AgencyStrategy, AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compile an orchestration strategy into an executable {@link CompiledStrategy}.
 *
 * When `agencyConfig.adaptive` is `true` and the requested strategy is not
 * already `"hierarchical"`, the compiled strategy is wrapped in an adaptive
 * hierarchical manager that may override the default strategy at runtime
 * based on task complexity signals.
 *
 * @param strategy - Strategy discriminant (e.g. `"sequential"`, `"parallel"`).
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Full agency-level configuration providing fallback values.
 * @returns A compiled strategy with `execute` and `stream` methods.
 * @throws {Error} When the requested strategy is not yet implemented (e.g. a
 *         future strategy discriminant that has been added to `AgencyStrategy`
 *         but not yet wired here).
 *
 * @example
 * ```ts
 * const strategy = compileStrategy('sequential', agents, agencyConfig);
 * const result = await strategy.execute('Summarise AI research.');
 * ```
 */
export declare function compileStrategy(strategy: AgencyStrategy, agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
export { compileSequential } from './sequential.js';
export { compileParallel } from './parallel.js';
export { compileDebate } from './debate.js';
export { compileReviewLoop } from './review-loop.js';
export { compileHierarchical } from './hierarchical.js';
export { compileGraph } from './graph.js';
export { isAgent, mergeDefaults, resolveAgent, checkBeforeAgent } from './shared.js';
export { compileAgencyToGraph, mapGraphResultToAgencyResult, mapGraphEventToAgencyEvent } from './graphCompiler.js';
export { agentGraph, AgentGraphBuilder } from './agentGraphBuilder.js';
export type { AgentNodeConfig } from './agentGraphBuilder.js';
//# sourceMappingURL=index.d.ts.map
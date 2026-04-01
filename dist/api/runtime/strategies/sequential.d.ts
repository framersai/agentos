import type { AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compiles a sequential execution strategy.
 *
 * Agents are invoked one-by-one in their declared iteration order. Each agent
 * after the first receives a prompt that includes both the original task and
 * the preceding agent's output, enabling progressive refinement chains such as
 * `researcher -> editor -> reviewer`.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 *                 Iteration order of `Object.entries()` determines execution order.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 *
 * @example
 * ```ts
 * const strategy = compileSequential(
 *   { researcher: { instructions: 'Find info.' }, writer: { instructions: 'Write summary.' } },
 *   agencyConfig,
 * );
 * const result = await strategy.execute('Summarise recent AI research.');
 * ```
 */
export declare function compileSequential(agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
//# sourceMappingURL=sequential.d.ts.map
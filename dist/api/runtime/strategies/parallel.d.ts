import type { AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compiles a parallel execution strategy.
 *
 * All agents are invoked concurrently with the same prompt via
 * `Promise.allSettled`. Once every agent has responded (or failed), a
 * synthesis agent (instantiated from the agency-level config) combines the
 * individual outputs into a single coherent response.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration; must include `model` or `provider`
 *   for the synthesis step.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When no agency-level model/provider is available
 *   for the synthesis step. The synthesis agent needs an LLM to combine the
 *   parallel outputs.
 *
 * @example
 * ```ts
 * const strategy = compileParallel(
 *   { factChecker: factAgent, writer: writeAgent },
 *   { model: 'openai:gpt-4o', agents: { factChecker: factAgent, writer: writeAgent } },
 * );
 * const result = await strategy.execute('Write a fact-checked article.');
 * ```
 */
export declare function compileParallel(agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
//# sourceMappingURL=parallel.d.ts.map
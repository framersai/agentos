import type { AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compiles a hierarchical execution strategy.
 *
 * A manager agent is instantiated from the agency-level model/provider/instructions.
 * Each sub-agent in the roster is exposed as a `delegate_to_<name>` tool that the
 * manager can invoke. When the manager calls a delegation tool, the corresponding
 * sub-agent runs the subtask and its output is returned as the tool result.
 *
 * All sub-agent call records are collected and returned alongside the manager's
 * final synthesized answer.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration; must include `model` or `provider`
 *   for the manager agent.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When no agency-level model/provider is available
 *   for the manager agent.
 *
 * @example
 * ```ts
 * const strategy = compileHierarchical(
 *   {
 *     researcher: { instructions: 'Find academic sources.' },
 *     writer: { instructions: 'Write clear prose.' },
 *   },
 *   { model: 'openai:gpt-4o', agents: { ... } },
 * );
 * const result = await strategy.execute('Write a literature review on LLMs.');
 * // The manager decided which agents to call and in what order.
 * ```
 */
export declare function compileHierarchical(agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
//# sourceMappingURL=hierarchical.d.ts.map
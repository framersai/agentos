import type { AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compiles a debate execution strategy.
 *
 * Agents are iterated in rounds. During each round, every agent receives the
 * original task plus all previously collected arguments, and contributes its
 * own perspective. After `maxRounds` complete, a synthesizer agent (using the
 * agency-level model) distils all arguments into a final answer.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 *   Must include `model` or `provider` for the synthesis step.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When no agency-level model/provider is available
 *   for the synthesis step.
 *
 * @example
 * ```ts
 * const strategy = compileDebate(
 *   { optimist: { instructions: 'Argue the positive case.' }, pessimist: { instructions: 'Argue the risks.' } },
 *   { model: 'openai:gpt-4o', maxRounds: 2, agents: { ... } },
 * );
 * const result = await strategy.execute('Should we adopt this new technology?');
 * ```
 */
export declare function compileDebate(agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
//# sourceMappingURL=debate.d.ts.map
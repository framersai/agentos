/**
 * @file index.ts
 * Strategy compiler dispatcher for the Agency API.
 *
 * Maps an {@link AgencyStrategy} discriminant to the concrete compiler that
 * produces a {@link CompiledStrategy}. Only `"sequential"` and `"parallel"`
 * are implemented in v1; other strategies will be added incrementally.
 */
import type {
  AgencyStrategy,
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
} from '../types.js';
import { compileSequential } from './sequential.js';
import { compileParallel } from './parallel.js';

/**
 * Compile an orchestration strategy into an executable {@link CompiledStrategy}.
 *
 * @param strategy - Strategy discriminant (e.g. `"sequential"`, `"parallel"`).
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Full agency-level configuration providing fallback values.
 * @returns A compiled strategy with `execute` and `stream` methods.
 * @throws {Error} When the requested strategy is not yet implemented.
 */
export function compileStrategy(
  strategy: AgencyStrategy,
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  switch (strategy) {
    case 'sequential':
      return compileSequential(agents, agencyConfig);
    case 'parallel':
      return compileParallel(agents, agencyConfig);
    default:
      throw new Error(`Strategy '${strategy}' not yet implemented`);
  }
}

/**
 * Type guard that checks whether a value is a pre-built {@link Agent} instance
 * (has a `generate` method) vs a raw {@link BaseAgentConfig} object.
 *
 * @param value - Either a config object or a running agent.
 * @returns `true` when the value is a pre-built `Agent`.
 */
export function isAgent(value: BaseAgentConfig | Agent): value is Agent {
  return typeof (value as Agent).generate === 'function';
}

export { compileSequential } from './sequential.js';
export { compileParallel } from './parallel.js';

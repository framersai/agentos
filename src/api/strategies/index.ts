/**
 * @file index.ts
 * Strategy compiler dispatcher for the Agency API.
 *
 * Maps an {@link AgencyStrategy} discriminant to the concrete compiler that
 * produces a {@link CompiledStrategy}. Supports sequential, parallel, debate,
 * review-loop, and hierarchical strategies. When `adaptive` mode is enabled
 * on a non-hierarchical strategy, the dispatcher wraps it with an implicit
 * hierarchical manager that may override the default strategy at runtime.
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
import { compileDebate } from './debate.js';
import { compileReviewLoop } from './review-loop.js';
import { compileHierarchical } from './hierarchical.js';

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
 * @throws {Error} When the requested strategy is not yet implemented.
 */
export function compileStrategy(
  strategy: AgencyStrategy,
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  /* When adaptive mode is enabled on non-hierarchical strategies, wrap with a manager. */
  if (agencyConfig.adaptive && strategy !== 'hierarchical') {
    return compileAdaptiveWrapper(strategy, agents, agencyConfig);
  }

  return compileStrategyCore(strategy, agents, agencyConfig);
}

/**
 * Core strategy compiler without adaptive wrapping.
 *
 * @param strategy - Strategy discriminant.
 * @param agents - Named agent roster.
 * @param agencyConfig - Agency-level configuration.
 * @returns A compiled strategy.
 * @internal
 */
function compileStrategyCore(
  strategy: AgencyStrategy,
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  switch (strategy) {
    case 'sequential':
      return compileSequential(agents, agencyConfig);
    case 'parallel':
      return compileParallel(agents, agencyConfig);
    case 'debate':
      return compileDebate(agents, agencyConfig);
    case 'review-loop':
      return compileReviewLoop(agents, agencyConfig);
    case 'hierarchical':
      return compileHierarchical(agents, agencyConfig);
    default:
      throw new Error(`Strategy '${strategy}' not yet implemented`);
  }
}

/**
 * Wraps a non-hierarchical strategy in an adaptive hierarchical manager.
 *
 * The manager prompt declares the default strategy and instructs the manager
 * that it may override strategy selection if the task clearly does not require
 * all agents. In practice, the manager delegates to the sub-agents via tools
 * just like the hierarchical strategy, but with the additional context of the
 * original intended strategy.
 *
 * @param defaultStrategy - The user-declared default strategy.
 * @param agents - Named agent roster.
 * @param agencyConfig - Agency-level configuration.
 * @returns A compiled hierarchical strategy with adaptive instructions.
 * @internal
 */
function compileAdaptiveWrapper(
  defaultStrategy: AgencyStrategy,
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  const adaptiveInstructions =
    (agencyConfig.instructions ? agencyConfig.instructions + '\n\n' : '') +
    `Your default strategy is "${defaultStrategy}". You may override it if the task clearly doesn't need all agents. ` +
    `Use your judgment to decide whether to engage all team members or delegate to a subset.`;

  const adaptiveConfig: AgencyOptions = {
    ...agencyConfig,
    instructions: adaptiveInstructions,
    /* Disable adaptive on the inner call to prevent infinite recursion. */
    adaptive: false,
  };

  return compileHierarchical(agents, adaptiveConfig);
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
export { compileDebate } from './debate.js';
export { compileReviewLoop } from './review-loop.js';
export { compileHierarchical } from './hierarchical.js';

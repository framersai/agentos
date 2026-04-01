import type { AgencyOptions, CompiledStrategy, Agent, BaseAgentConfig } from '../types.js';
/**
 * Compiles a review-loop execution strategy.
 *
 * The first declared agent acts as the producer, the second as the reviewer.
 * The producer generates or revises a draft, then the reviewer evaluates it.
 * If the reviewer approves (responds with `{ "approved": true }`), the loop
 * terminates early. Otherwise the reviewer's feedback is fed back into the
 * producer for revision, up to `maxRounds` iterations.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 *   At least two agents are required (producer + reviewer). The first entry
 *   is the producer, the second is the reviewer.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When fewer than two agents are provided.
 *
 * @example
 * ```ts
 * const strategy = compileReviewLoop(
 *   {
 *     writer: { instructions: 'Write a blog post.' },
 *     editor: { instructions: 'Review for clarity and accuracy.' },
 *   },
 *   { maxRounds: 3, agents: { ... } },
 * );
 * const result = await strategy.execute('Write about TypeScript generics.');
 * // result.text is the final approved draft.
 * ```
 */
export declare function compileReviewLoop(agents: Record<string, BaseAgentConfig | Agent>, agencyConfig: AgencyOptions): CompiledStrategy;
//# sourceMappingURL=review-loop.d.ts.map
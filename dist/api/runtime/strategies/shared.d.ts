import type { AgencyOptions, Agent, BaseAgentConfig, AgentCallRecord, ApprovalDecision } from '../types.js';
/**
 * Type guard that checks whether a value is a pre-built {@link Agent} instance
 * (has a `generate` method) vs a raw `BaseAgentConfig` object.
 *
 * Uses duck-typing on the `generate` method rather than `instanceof` because
 * Agent instances may come from different module copies (e.g. nested agencies
 * created in separate compilation contexts). Duck-typing is more resilient
 * to this scenario.
 *
 * @param value - Either a config object or a running agent.
 * @returns `true` when the value is a pre-built `Agent` with a callable `generate`.
 *
 * @example
 * ```ts
 * const agentOrConfig: BaseAgentConfig | Agent = getFromRoster('worker');
 * if (isAgent(agentOrConfig)) {
 *   // agentOrConfig.generate() is callable
 * } else {
 *   // agentOrConfig is a raw config, needs agent() factory
 * }
 * ```
 */
export declare function isAgent(value: BaseAgentConfig | Agent): value is Agent;
/**
 * Accumulate Anthropic prompt-cache tokens from a per-call usage snapshot
 * onto a running strategy-level totalUsage. Fills in the fields the
 * existing accumulators (promptTokens / completionTokens / totalTokens)
 * already handle — keeping cache metrics undefined on the accumulator
 * until at least one call reports a value, so callers can distinguish
 * "provider does not report cache" (undefined) from "zero hits" (0).
 *
 * Safe to call against any usage shape: missing fields are skipped
 * without throwing, and numeric zero values are still counted.
 *
 * @param totalUsage - The strategy's running usage accumulator. Mutated
 *   in place to add cacheReadTokens / cacheCreationTokens.
 * @param call - The per-call usage snapshot (typically from an Agent
 *   result or generateText-style TokenUsage). May be undefined.
 */
export declare function accumulateCacheTokens(totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
}, call: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
} | undefined): void;
/**
 * Merge agency-level defaults into an agent config.
 *
 * Agent-level values take precedence over agency-level defaults. Tools are
 * merged additively: agency tools serve as a base layer and agent tools
 * override on name collision. This lets an agency provide a shared tool
 * set while individual agents can override or extend it.
 *
 * @param agentConfig - Per-agent configuration (takes precedence).
 * @param agencyConfig - Agency-level fallback values (base layer).
 * @returns A merged config suitable for passing to `agent()`.
 *
 * @example
 * ```ts
 * const merged = mergeDefaults(
 *   { instructions: 'Write code.' },
 *   { model: 'openai:gpt-4o', tools: { search: searchTool } },
 * );
 * // merged.model === 'openai:gpt-4o' (agency default)
 * // merged.instructions === 'Write code.' (agent override)
 * // merged.tools contains `search` from agency
 * ```
 *
 * @see {@link resolveAgent} -- calls this internally before creating an agent.
 */
export declare function mergeDefaults(agentConfig: BaseAgentConfig, agencyConfig: AgencyOptions): BaseAgentConfig;
/**
 * Resolves an agent-or-config value into a usable {@link Agent} instance.
 *
 * If the value is already a pre-built Agent, it is returned as-is.
 * If it is a raw BaseAgentConfig, agency defaults are merged and a new
 * Agent is created via the `agent()` factory.
 *
 * @param agentOrConfig - Either a pre-built Agent or a raw BaseAgentConfig.
 * @param agencyConfig - Agency-level fallback values for config merging.
 * @returns A ready-to-call Agent instance.
 *
 * @example
 * ```ts
 * const agent = resolveAgent(roster['worker'], agencyConfig);
 * const result = await agent.generate('Do the task.');
 * ```
 *
 * @see {@link isAgent} -- determines whether the value needs factory creation.
 * @see {@link mergeDefaults} -- applies agency-level fallback values.
 */
export declare function resolveAgent(agentOrConfig: BaseAgentConfig | Agent, agencyConfig: AgencyOptions): Agent;
/**
 * Checks the HITL `beforeAgent` gate for a named agent.
 *
 * When the agency-level `hitl.approvals.beforeAgent` list includes the agent
 * name, this function invokes the HITL handler and returns the decision.
 * If the agent name is not in the approval list, or no handler is configured,
 * returns `null` (meaning "no gate -- proceed normally").
 *
 * ## Why return `null` instead of `{ approved: true }`?
 *
 * Returning `null` lets callers distinguish between "no gate configured"
 * (null -- proceed without any HITL overhead) and "gate evaluated, approved"
 * (`{ approved: true }` -- proceed but may carry instruction modifications
 * from the approver).
 *
 * @param name - The agent's declared name in the roster.
 * @param context - The input/context string the agent would receive.
 * @param agentCalls - Agent call records accumulated so far in this run.
 *                     Included in the approval request for context.
 * @param agencyConfig - The full agency configuration containing HITL settings.
 * @returns The approval decision, or `null` when no gate applies.
 *
 * @example
 * ```ts
 * const decision = await checkBeforeAgent('researcher', prompt, calls, config);
 * if (decision && !decision.approved) {
 *   // Agent was rejected by HITL -- skip or abort.
 *   return;
 * }
 * // Proceed with agent invocation.
 * ```
 *
 * @see {@link HitlConfig} -- defines the approval triggers and handler.
 * @see {@link ApprovalRequest} -- the shape passed to the handler.
 */
export declare function checkBeforeAgent(name: string, context: string, agentCalls: AgentCallRecord[], agencyConfig: AgencyOptions): Promise<ApprovalDecision | null>;
//# sourceMappingURL=shared.d.ts.map
/**
 * @file agency.ts
 * Multi-agent agency factory for the AgentOS high-level API.
 *
 * `agency()` accepts an {@link AgencyOptions} configuration, compiles the
 * requested orchestration strategy, wires resource controls, and returns a
 * single {@link Agent}-compatible interface that coordinates all sub-agents.
 *
 * The returned instance exposes `generate`, `stream`, `session`, `usage`, and
 * `close` — identical surface to a single `agent()` instance — so callers can
 * swap between them transparently.
 *
 * @example
 * ```ts
 * import { agency, hitl } from '@framers/agentos';
 *
 * const myAgency = agency({
 *   model: 'openai:gpt-4o',
 *   strategy: 'sequential',
 *   agents: {
 *     researcher: { instructions: 'Find relevant information.' },
 *     writer:     { instructions: 'Write a clear summary.' },
 *   },
 *   controls: { maxTotalTokens: 50_000, onLimitReached: 'warn' },
 *   hitl: { approvals: { beforeTool: ['delete'] }, handler: hitl.autoApprove() },
 * });
 *
 * const result = await myAgency.generate('Summarise recent AI research.');
 * console.log(result.text);
 * ```
 */
import type { AgencyOptions, Agent } from './types.js';
/**
 * Creates a multi-agent agency that coordinates a named roster of sub-agents
 * using the specified orchestration strategy.
 *
 * The agency validates configuration immediately and throws an
 * {@link AgencyConfigError} on any structural problem so issues surface at
 * wiring time rather than the first call.
 *
 * @param opts - Full agency configuration including the `agents` roster, optional
 *   `strategy`, `controls`, `hitl`, and `observability` settings.
 * @returns An {@link Agent} instance whose `generate` / `stream` / `session` methods
 *   invoke the compiled strategy over the configured sub-agents.
 * @throws {AgencyConfigError} When the configuration is structurally invalid
 *   (e.g. no agents defined, emergent enabled without hierarchical strategy,
 *   HITL approvals configured without a handler, parallel/debate without a
 *   synthesis model).
 */
export declare function agency(opts: AgencyOptions): Agent;
/**
 * Result of a post-approval guardrail check.
 *
 * Contains the blocking guardrail's ID and reason when the override fires.
 */
export interface GuardrailHitlOverrideResult {
    /** Whether the guardrails passed (tool call may proceed). */
    passed: boolean;
    /** The guardrail ID that triggered the block (when `passed` is `false`). */
    guardrailId?: string;
    /** Human-readable reason for the block. */
    reason?: string;
}
/**
 * Runs post-approval guardrails against tool call arguments to catch
 * destructive actions that slipped past the HITL handler.
 *
 * This is the core safety net: even when auto-approve, LLM judge, or a
 * human approves a tool call, the configured guardrails get a final say.
 * If any guardrail returns `action: 'block'`, the approval is overridden.
 *
 * @param toolName - The tool that was approved.
 * @param args - The arguments the tool would be called with.
 * @param guardrailIds - Ordered list of guardrail IDs to evaluate.
 * @param callbacks - Optional event callback map for emitting override events.
 * @returns A result indicating whether the guardrails passed.
 */
export declare function runPostApprovalGuardrails(toolName: string, args: Record<string, unknown>, guardrailIds: string[], callbacks?: AgencyOptions['on']): Promise<GuardrailHitlOverrideResult>;
//# sourceMappingURL=agency.d.ts.map
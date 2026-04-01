/**
 * @file hitl.ts
 * Human-in-the-loop (HITL) approval handler factories for the AgentOS API.
 *
 * The `hitl` object provides a set of composable handler factories that conform
 * to the `HitlHandler` function signature expected by `HitlConfig.handler`.
 * Handlers are async functions that receive an {@link ApprovalRequest} and must
 * resolve to an {@link ApprovalDecision}.
 *
 * @example
 * ```ts
 * import { agency, hitl } from '@framers/agentos';
 *
 * // Auto-approve everything (useful in tests and CI environments)
 * const testAgency = agency({
 *   agents: { worker: { model: 'openai:gpt-4o-mini' } },
 *   hitl: {
 *     approvals: { beforeTool: ['delete-file'] },
 *     handler: hitl.autoApprove(),
 *   },
 * });
 *
 * // Interactive CLI approval for local development
 * const devAgency = agency({
 *   agents: { worker: { model: 'openai:gpt-4o' } },
 *   hitl: {
 *     approvals: { beforeTool: ['delete-file'], beforeReturn: true },
 *     handler: hitl.cli(),
 *   },
 * });
 * ```
 */
import type { ApprovalRequest, ApprovalDecision } from './types.js';
/**
 * An async function that receives an {@link ApprovalRequest} and resolves to
 * an {@link ApprovalDecision}.  Assign to `HitlConfig.handler`.
 */
export type HitlHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;
/**
 * A collection of factory functions that produce {@link HitlHandler} instances
 * for common approval patterns.
 *
 * All handlers are composable: you can wrap any factory result in your own
 * function to add logging, fallback logic, or conditional routing.
 */
export declare const hitl: {
    /**
     * Returns a handler that approves every request immediately without any
     * human interaction.
     *
     * Intended for use in automated tests and CI pipelines where human review
     * is not required.
     *
     * @returns A {@link HitlHandler} that always resolves `{ approved: true }`.
     *
     * @example
     * ```ts
     * handler: hitl.autoApprove()
     * ```
     */
    autoApprove(): HitlHandler;
    /**
     * Returns a handler that rejects every request immediately without any
     * human interaction.
     *
     * Useful for dry-run or read-only execution modes where you want to confirm
     * which actions would have been triggered without actually permitting any.
     *
     * @param reason - Optional human-readable rejection reason appended to the
     *   decision.  Defaults to `"Auto-rejected"`.
     * @returns A {@link HitlHandler} that always resolves `{ approved: false, reason }`.
     *
     * @example
     * ```ts
     * handler: hitl.autoReject('dry-run mode — no side effects permitted')
     * ```
     */
    autoReject(reason?: string): HitlHandler;
    /**
     * Returns a handler that pauses execution and prompts the user interactively
     * via `stdin`/`stdout`.
     *
     * Displays the approval request summary (description, agent, action, type)
     * and waits for the user to type `y` (approve) or `n` (reject).
     *
     * **Important**: This handler reads from `process.stdin`, so it must only be
     * used in interactive terminal environments (not in CI/CD pipelines or
     * serverless functions).
     *
     * @returns A {@link HitlHandler} that waits for interactive CLI input.
     *
     * @example
     * ```ts
     * handler: hitl.cli()
     * ```
     */
    cli(): HitlHandler;
    /**
     * Returns a handler that POSTs the {@link ApprovalRequest} as JSON to the
     * provided URL and expects the server to respond with an {@link ApprovalDecision}.
     *
     * The server must respond with `Content-Type: application/json` containing an
     * object with at least an `approved: boolean` field.  Non-2xx responses are
     * treated as a rejection with the HTTP status code as the reason.
     *
     * @param url - The full URL to POST approval requests to.
     * @returns A {@link HitlHandler} that delegates decisions to an HTTP endpoint.
     *
     * @example
     * ```ts
     * handler: hitl.webhook('https://my-approval-service.example.com/approve')
     * ```
     */
    webhook(url: string): HitlHandler;
    /**
     * Returns a handler that posts a notification to a Slack channel when an
     * approval is requested.
     *
     * **v1 behaviour**: The message is sent to the configured Slack channel, then
     * the handler immediately auto-approves.  A future version will poll for
     * emoji reactions (`:white_check_mark:` / `:x:`) on the posted message before
     * resolving.
     *
     * @param opts.channel - Slack channel ID or name (e.g. `"#approvals"` or
     *   `"C0123456789"`).
     * @param opts.token - Slack Bot OAuth token with `chat:write` scope.
     * @returns A {@link HitlHandler} that posts to Slack and auto-approves for v1.
     *
     * @example
     * ```ts
     * handler: hitl.slack({ channel: '#approvals', token: process.env.SLACK_BOT_TOKEN! })
     * ```
     */
    slack(opts: {
        channel: string;
        token: string;
    }): HitlHandler;
    /**
     * Creates an HITL handler that delegates approval decisions to an LLM judge.
     *
     * The LLM evaluates the approval request against configurable criteria and
     * returns a structured approve/reject decision with reasoning. When the LLM's
     * self-reported confidence falls below `confidenceThreshold`, the decision is
     * delegated to a fallback handler (default: {@link hitl.autoReject}).
     *
     * @param config - LLM judge configuration.
     * @param config.model - LLM model to use. Defaults to `'gpt-4o-mini'`.
     * @param config.provider - LLM provider. Defaults to `'openai'`.
     * @param config.criteria - Custom evaluation criteria/rubric. Defaults to
     *   `'Evaluate whether this action is safe, relevant, and appropriate.'`.
     * @param config.confidenceThreshold - Confidence threshold in the range 0–1.
     *   Below this value the decision is escalated to the fallback handler. Defaults
     *   to `0.7`.
     * @param config.fallback - Handler invoked when confidence is below threshold or
     *   the LLM call fails. Defaults to `hitl.autoReject('LLM judge confidence too low')`.
     * @param config.apiKey - API key override forwarded to the LLM provider.
     * @returns A {@link HitlHandler} that auto-decides via LLM.
     *
     * @example
     * ```ts
     * import { agency, hitl } from '@framers/agentos';
     *
     * const guarded = agency({
     *   agents: { worker: { instructions: 'Execute tasks.' } },
     *   hitl: {
     *     approvals: { beforeTool: ['delete-file'] },
     *     handler: hitl.llmJudge({
     *       model: 'gpt-4o-mini',
     *       criteria: 'Is this action safe and non-destructive?',
     *       confidenceThreshold: 0.8,
     *       fallback: hitl.cli(), // escalate uncertain decisions to human
     *     }),
     *   },
     * });
     * ```
     */
    llmJudge(config?: {
        /** LLM model to use. @default 'gpt-4o-mini' */
        model?: string;
        /** LLM provider. @default 'openai' */
        provider?: string;
        /** Custom evaluation criteria/rubric. @default 'Evaluate whether this action is safe, relevant, and appropriate.' */
        criteria?: string;
        /** Confidence threshold — below this, escalate to fallback handler. @default 0.7 */
        confidenceThreshold?: number;
        /** Fallback handler when confidence is below threshold. @default hitl.autoReject('LLM judge confidence too low') */
        fallback?: HitlHandler;
        /** API key override. */
        apiKey?: string;
    }): HitlHandler;
};
//# sourceMappingURL=hitl.d.ts.map
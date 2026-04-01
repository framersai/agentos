/**
 * @module crossAgentGuardrailDispatcher
 *
 * Dispatcher for cross-agent guardrail evaluations.
 *
 * Enables supervisor/observer guardrails to monitor and intervene in
 * other agents' output streams within an agency.
 *
 * @example
 * ```typescript
 * // Wrap an agent's output with cross-agent guardrail supervision
 * const supervisedStream = wrapWithCrossAgentGuardrails(
 *   crossAgentGuardrails,
 *   { sourceAgentId: 'worker-1', observerAgentId: 'supervisor', agencyId: 'agency-1' },
 *   guardrailContext,
 *   workerOutputStream,
 *   { streamId: 'stream-123' }
 * );
 * ```
 */
import { AgentOSResponse } from '../../api/types/AgentOSResponse';
import { type GuardrailContext, type GuardrailEvaluationResult } from './IGuardrailService';
import { type ICrossAgentGuardrailService } from './ICrossAgentGuardrailService';
import { type GuardrailOutputOptions } from './guardrailDispatcher';
/**
 * Context for cross-agent guardrail evaluation.
 */
export interface CrossAgentGuardrailContext {
    /** The agent whose output is being observed */
    sourceAgentId: string;
    /** The agent running the cross-agent guardrails */
    observerAgentId: string;
    /** Agency ID if agents are in the same agency */
    agencyId?: string;
}
/**
 * Result of cross-agent guardrail evaluation for a chunk.
 */
export interface CrossAgentEvaluationResult {
    /** Whether the chunk should be blocked */
    blocked: boolean;
    /** Modified chunk (if sanitized) */
    modifiedChunk?: AgentOSResponse;
    /** All evaluation results from cross-agent guardrails */
    evaluations: GuardrailEvaluationResult[];
}
/**
 * Evaluate a chunk through all applicable cross-agent guardrails.
 *
 * Filters guardrails to only those observing the source agent, then
 * evaluates the chunk through each. Respects `canInterruptOthers` flag.
 *
 * @param guardrails - Cross-agent guardrails to evaluate
 * @param crossAgentContext - Source/observer agent context
 * @param guardrailContext - Standard guardrail context
 * @param chunk - The output chunk to evaluate
 * @returns Evaluation result with blocked status and any modifications
 *
 * @example
 * ```typescript
 * const result = await evaluateCrossAgentGuardrails(
 *   crossAgentGuardrails,
 *   { sourceAgentId: 'worker-1', observerAgentId: 'supervisor' },
 *   guardrailContext,
 *   textDeltaChunk
 * );
 *
 * if (result.blocked) {
 *   // Terminate the source agent's stream
 * } else if (result.modifiedChunk) {
 *   // Use the sanitized chunk
 * }
 * ```
 */
export declare function evaluateCrossAgentGuardrails(guardrails: ICrossAgentGuardrailService[], crossAgentContext: CrossAgentGuardrailContext, guardrailContext: GuardrailContext, chunk: AgentOSResponse): Promise<CrossAgentEvaluationResult>;
/**
 * Wrap an agent's output stream with cross-agent guardrail supervision.
 *
 * Creates an async generator that evaluates each chunk through applicable
 * cross-agent guardrails before yielding. If any guardrail returns BLOCK
 * (and has `canInterruptOthers: true`), the stream is terminated.
 *
 * @param guardrails - Cross-agent guardrails to apply
 * @param crossAgentContext - Source/observer agent context
 * @param guardrailContext - Standard guardrail context
 * @param stream - Source agent's output stream
 * @param options - Stream options
 * @returns Supervised stream with cross-agent guardrail filtering
 *
 * @example
 * ```typescript
 * // Supervisor monitors worker agent
 * const supervisedStream = wrapWithCrossAgentGuardrails(
 *   [qualityGate, policyEnforcer],
 *   {
 *     sourceAgentId: 'worker-analyst',
 *     observerAgentId: 'supervisor',
 *     agencyId: 'research-agency'
 *   },
 *   guardrailContext,
 *   workerStream,
 *   { streamId: 'stream-xyz' }
 * );
 *
 * for await (const chunk of supervisedStream) {
 *   // Chunk has been approved/modified by cross-agent guardrails
 *   yield chunk;
 * }
 * ```
 */
export declare function wrapWithCrossAgentGuardrails(guardrails: ICrossAgentGuardrailService[], crossAgentContext: CrossAgentGuardrailContext, guardrailContext: GuardrailContext, stream: AsyncGenerator<AgentOSResponse, void, undefined>, options: GuardrailOutputOptions): AsyncGenerator<AgentOSResponse, void, undefined>;
/**
 * Extract cross-agent guardrails from a mixed array of guardrail services.
 *
 * @param services - Array of guardrail services (may include non-cross-agent)
 * @returns Only the cross-agent guardrail services
 */
export declare function filterCrossAgentGuardrails(services: unknown[]): ICrossAgentGuardrailService[];
//# sourceMappingURL=crossAgentGuardrailDispatcher.d.ts.map
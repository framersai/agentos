/**
 * @module ICrossAgentGuardrailService
 *
 * Cross-agent guardrail interface for multi-agent supervision.
 *
 * Extends {@link IGuardrailService} to enable guardrails that observe
 * and intervene in other agents' output streams. This enables patterns like:
 * - Supervisor agents monitoring worker agents
 * - Quality gates across an agency
 * - Cross-agent policy enforcement
 *
 * @example Supervisor guardrail
 * ```typescript
 * class SupervisorGuardrail implements ICrossAgentGuardrailService {
 *   observeAgentIds = ['worker-1', 'worker-2'];
 *   canInterruptOthers = true;
 *   config = { evaluateStreamingChunks: true };
 *
 *   async evaluateCrossAgentOutput({ sourceAgentId, chunk }) {
 *     if (chunk.textDelta?.includes('CONFIDENTIAL')) {
 *       return {
 *         action: GuardrailAction.BLOCK,
 *         reason: `Agent ${sourceAgentId} attempted to leak confidential info`
 *       };
 *     }
 *     return null;
 *   }
 * }
 * ```
 */
import type { AgentOSResponse } from '../../api/types/AgentOSResponse';
import type {
  GuardrailContext,
  GuardrailEvaluationResult,
  IGuardrailService,
} from './IGuardrailService';

/**
 * Payload for cross-agent output evaluation.
 *
 * Provides information about both the source agent (producing output)
 * and the observer agent (running the guardrail).
 */
export interface CrossAgentOutputPayload {
  /**
   * The agent that produced this output chunk.
   * Use this to apply agent-specific policies.
   */
  sourceAgentId: string;

  /**
   * The agent running this guardrail (the observer/supervisor).
   */
  observerAgentId: string;

  /**
   * Agency ID if both agents belong to the same agency.
   * Useful for agency-level policy enforcement.
   */
  agencyId?: string;

  /**
   * The output chunk from the source agent.
   */
  chunk: AgentOSResponse;

  /**
   * Guardrail context for policy decisions.
   */
  context: GuardrailContext;
}

/**
 * Cross-agent guardrail service for multi-agent supervision.
 *
 * Extends {@link IGuardrailService} to enable observation and intervention
 * in other agents' output streams. Use this for:
 *
 * - **Supervisor patterns**: A supervisor agent monitors worker agents
 * - **Quality gates**: Enforce quality standards across an agency
 * - **Policy enforcement**: Apply organization-wide rules to all agents
 * - **Safety monitoring**: Detect and prevent harmful outputs from any agent
 *
 * @example Quality gate guardrail
 * ```typescript
 * class QualityGateGuardrail implements ICrossAgentGuardrailService {
 *   // Observe all agents in the agency
 *   observeAgentIds = [];
 *   canInterruptOthers = true;
 *
 *   async evaluateCrossAgentOutput({ sourceAgentId, chunk, context }) {
 *     if (chunk.type === 'FINAL_RESPONSE') {
 *       const quality = await assessQuality(chunk.finalResponseText);
 *       if (quality.score < 0.5) {
 *         return {
 *           action: GuardrailAction.BLOCK,
 *           reason: 'Response did not meet quality standards',
 *           metadata: { qualityScore: quality.score, agent: sourceAgentId }
 *         };
 *       }
 *     }
 *     return null;
 *   }
 * }
 * ```
 *
 * @example Selective agent monitoring
 * ```typescript
 * class SensitiveDataGuardrail implements ICrossAgentGuardrailService {
 *   // Only observe agents handling sensitive data
 *   observeAgentIds = ['data-analyst', 'report-generator'];
 *   canInterruptOthers = true;
 *   config = { evaluateStreamingChunks: true };
 *
 *   async evaluateCrossAgentOutput({ chunk }) {
 *     if (chunk.textDelta && containsPII(chunk.textDelta)) {
 *       return {
 *         action: GuardrailAction.SANITIZE,
 *         modifiedText: redactPII(chunk.textDelta)
 *       };
 *     }
 *     return null;
 *   }
 * }
 * ```
 */
export interface ICrossAgentGuardrailService extends IGuardrailService {
  /**
   * Agent IDs this guardrail observes.
   *
   * - Empty array `[]` or undefined: Observe all agents in the agency
   * - Specific IDs: Only observe listed agents
   *
   * @example
   * ```typescript
   * // Observe specific workers
   * observeAgentIds = ['worker-1', 'worker-2'];
   *
   * // Observe all agents
   * observeAgentIds = [];
   * ```
   */
  observeAgentIds?: string[];

  /**
   * Whether this guardrail can interrupt other agents' streams.
   *
   * When `true`:
   * - {@link GuardrailAction.BLOCK} terminates the observed agent's stream
   * - {@link GuardrailAction.SANITIZE} modifies the observed agent's output
   *
   * When `false` (default):
   * - Guardrail can only observe and log (FLAG action)
   * - BLOCK/SANITIZE actions are downgraded to FLAG
   *
   * @default false
   */
  canInterruptOthers?: boolean;

  /**
   * Evaluate output from an observed agent.
   *
   * Called when an observed agent (per {@link observeAgentIds}) emits a chunk.
   * The evaluation timing depends on {@link IGuardrailService.config}:
   * - `evaluateStreamingChunks: true`: Called for each TEXT_DELTA
   * - `evaluateStreamingChunks: false`: Called only for FINAL_RESPONSE
   *
   * @param payload - Cross-agent context and chunk to evaluate
   * @returns Evaluation result, or `null` to allow without action
   *
   * @remarks
   * - Only effective when {@link canInterruptOthers} is `true`
   * - Falls back to this guardrail's own stream for logging/metadata
   */
  evaluateCrossAgentOutput?(
    payload: CrossAgentOutputPayload,
  ): Promise<GuardrailEvaluationResult | null>;
}

/**
 * Type guard to check if a guardrail service is a cross-agent guardrail.
 *
 * @param service - Guardrail service to check
 * @returns `true` if the service implements cross-agent evaluation
 */
export function isCrossAgentGuardrail(
  service: IGuardrailService,
): service is ICrossAgentGuardrailService {
  return (
    'observeAgentIds' in service ||
    'canInterruptOthers' in service ||
    typeof (service as ICrossAgentGuardrailService).evaluateCrossAgentOutput === 'function'
  );
}

/**
 * Check if a cross-agent guardrail should observe a specific agent.
 *
 * @param guardrail - The cross-agent guardrail
 * @param agentId - The agent ID to check
 * @returns `true` if the guardrail should observe this agent
 */
export function shouldObserveAgent(
  guardrail: ICrossAgentGuardrailService,
  agentId: string,
): boolean {
  // If observeAgentIds is undefined or empty, observe all agents
  if (!guardrail.observeAgentIds || guardrail.observeAgentIds.length === 0) {
    return true;
  }
  return guardrail.observeAgentIds.includes(agentId);
}

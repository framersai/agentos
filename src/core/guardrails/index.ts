/**
 * @module guardrails
 *
 * Guardrails system for content safety and policy enforcement.
 *
 * Guardrails intercept content at two points:
 * 1. **Input** - Before user messages enter the orchestration pipeline
 * 2. **Output** - Before agent responses are streamed to the client
 *
 * @example Basic guardrail
 * ```typescript
 * import {
 *   IGuardrailService,
 *   GuardrailAction,
 *   type GuardrailInputPayload
 * } from '@framers/agentos/core/guardrails';
 *
 * class ContentFilter implements IGuardrailService {
 *   async evaluateInput({ input }: GuardrailInputPayload) {
 *     if (containsProhibitedContent(input.textInput)) {
 *       return {
 *         action: GuardrailAction.BLOCK,
 *         reason: 'Content policy violation'
 *       };
 *     }
 *     return null;
 *   }
 * }
 * ```
 *
 * @example Cross-agent supervision
 * ```typescript
 * import {
 *   ICrossAgentGuardrailService,
 *   GuardrailAction
 * } from '@framers/agentos/core/guardrails';
 *
 * class SupervisorGuardrail implements ICrossAgentGuardrailService {
 *   observeAgentIds = ['worker-1', 'worker-2'];
 *   canInterruptOthers = true;
 *
 *   async evaluateCrossAgentOutput({ sourceAgentId, chunk }) {
 *     // Supervise worker agents' outputs
 *   }
 * }
 * ```
 */

// Core guardrail interface and types
export {
  GuardrailAction,
  type GuardrailConfig,
  type GuardrailContext,
  type GuardrailEvaluationResult,
  type GuardrailInputPayload,
  type GuardrailOutputPayload,
  type IGuardrailService,
} from './IGuardrailService';

// Guardrail dispatcher functions
export {
  createGuardrailBlockedStream,
  evaluateInputGuardrails,
  type GuardrailInputOutcome,
  type GuardrailOutputOptions,
  wrapOutputGuardrails,
} from './guardrailDispatcher';

// Cross-agent guardrail interface and types
export {
  type CrossAgentOutputPayload,
  type ICrossAgentGuardrailService,
  isCrossAgentGuardrail,
  shouldObserveAgent,
} from './ICrossAgentGuardrailService';

// Cross-agent guardrail dispatcher
export {
  type CrossAgentEvaluationResult,
  type CrossAgentGuardrailContext,
  evaluateCrossAgentGuardrails,
  filterCrossAgentGuardrails,
  wrapWithCrossAgentGuardrails,
} from './crossAgentGuardrailDispatcher';

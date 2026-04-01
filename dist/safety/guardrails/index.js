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
 * } from '../../safety/guardrails/index.js';
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
 * } from '../../safety/guardrails/index.js';
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
export { GuardrailAction, } from './IGuardrailService.js';
// Guardrail dispatcher functions
export { createGuardrailBlockedStream, evaluateInputGuardrails, wrapOutputGuardrails, } from './guardrailDispatcher.js';
// Two-phase parallel guardrail dispatcher
export { ParallelGuardrailDispatcher } from './ParallelGuardrailDispatcher.js';
// Cross-agent guardrail interface and types
export { isCrossAgentGuardrail, shouldObserveAgent, } from './ICrossAgentGuardrailService.js';
// Sentence boundary buffer for streaming evaluation
export { SentenceBoundaryBuffer } from './SentenceBoundaryBuffer.js';
// Cross-agent guardrail dispatcher
export { evaluateCrossAgentGuardrails, filterCrossAgentGuardrails, wrapWithCrossAgentGuardrails, } from './crossAgentGuardrailDispatcher.js';
//# sourceMappingURL=index.js.map
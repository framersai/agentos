/**
 * High-level outcome emitted by a guardrail evaluation.
 *
 * The action instructs AgentOS how to handle evaluated content:
 * - {@link GuardrailAction.ALLOW} - Pass through unchanged
 * - {@link GuardrailAction.FLAG} - Pass through but record metadata
 * - {@link GuardrailAction.SANITIZE} - Replace content with modified version
 * - {@link GuardrailAction.BLOCK} - Reject/terminate the interaction
 *
 * @example
 * ```typescript
 * // Allow content to pass
 * return { action: GuardrailAction.ALLOW };
 *
 * // Block harmful content
 * return {
 *   action: GuardrailAction.BLOCK,
 *   reason: 'Content violates policy',
 *   reasonCode: 'POLICY_VIOLATION'
 * };
 *
 * // Redact sensitive information
 * return {
 *   action: GuardrailAction.SANITIZE,
 *   modifiedText: text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]')
 * };
 * ```
 */
export var GuardrailAction;
(function (GuardrailAction) {
    /**
     * Allow the content to pass through unchanged.
     * Use when content passes all policy checks.
     */
    GuardrailAction["ALLOW"] = "allow";
    /**
     * Allow the request/response but record metadata for analytics or audit.
     * Content passes through, but the evaluation is logged for review.
     */
    GuardrailAction["FLAG"] = "flag";
    /**
     * Continue processing after replacing content with a sanitized version.
     * Use for PII redaction, profanity filtering, or content modification.
     * Requires {@link GuardrailEvaluationResult.modifiedText} to be set.
     */
    GuardrailAction["SANITIZE"] = "sanitize";
    /**
     * Block the interaction entirely and return an error to the host.
     * Use for policy violations, harmful content, or security threats.
     * Terminates the stream immediately when used in output evaluation.
     */
    GuardrailAction["BLOCK"] = "block";
})(GuardrailAction || (GuardrailAction = {}));
//# sourceMappingURL=IGuardrailService.js.map
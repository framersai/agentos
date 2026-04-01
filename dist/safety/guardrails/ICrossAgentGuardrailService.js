/**
 * Type guard to check if a guardrail service is a cross-agent guardrail.
 *
 * @param service - Guardrail service to check
 * @returns `true` if the service implements cross-agent evaluation
 */
export function isCrossAgentGuardrail(service) {
    return ('observeAgentIds' in service ||
        'canInterruptOthers' in service ||
        typeof service.evaluateCrossAgentOutput === 'function');
}
/**
 * Check if a cross-agent guardrail should observe a specific agent.
 *
 * @param guardrail - The cross-agent guardrail
 * @param agentId - The agent ID to check
 * @returns `true` if the guardrail should observe this agent
 */
export function shouldObserveAgent(guardrail, agentId) {
    // If observeAgentIds is undefined or empty, observe all agents
    if (!guardrail.observeAgentIds || guardrail.observeAgentIds.length === 0) {
        return true;
    }
    return guardrail.observeAgentIds.includes(agentId);
}
//# sourceMappingURL=ICrossAgentGuardrailService.js.map
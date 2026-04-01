/**
 * @file IHumanInteractionManager.ts
 * @description Interface for Human-in-the-Loop (HITL) interactions in AgentOS.
 * Enables agents to request human approval, input, and collaboration at key decision points.
 *
 * HITL is critical for:
 * - High-stakes decisions requiring human judgment
 * - Ambiguous situations needing clarification
 * - Quality assurance and output review
 * - Learning from human corrections
 *
 * @module AgentOS/HITL
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const hitlManager = new HumanInteractionManager(config);
 *
 * // Request approval before critical action
 * const approval = await hitlManager.requestApproval({
 *   actionId: 'delete-all-records',
 *   description: 'Delete all customer records from database',
 *   severity: 'critical',
 *   context: { recordCount: 50000 },
 * });
 *
 * if (approval.approved) {
 *   await executeAction();
 * }
 * ```
 */
export {};
//# sourceMappingURL=IHumanInteractionManager.js.map
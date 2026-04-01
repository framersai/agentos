/**
 * Exports for the AgentOS Planning Engine module.
 *
 * The Planning Engine provides autonomous goal pursuit, task decomposition,
 * and self-correcting execution plans using cognitive patterns like ReAct.
 *
 * @module AgentOS/Planning
 *
 * @example
 * ```typescript
 * import {
 *   PlanningEngine,
 *   type IPlanningEngine,
 *   type ExecutionPlan,
 *   type PlanStep,
 * } from '@framers/agentos/planning/planner';
 *
 * const engine = new PlanningEngine({ llmProvider, logger });
 * const plan = await engine.generatePlan('Analyze customer data');
 * ```
 */
// Implementation
export { PlanningEngine } from './PlanningEngine.js';
//# sourceMappingURL=index.js.map
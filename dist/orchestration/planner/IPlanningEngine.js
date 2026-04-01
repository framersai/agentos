/**
 * @file IPlanningEngine.ts
 * @description Interface for the AgentOS Planning Engine - enables autonomous goal pursuit,
 * task decomposition, and self-correcting execution plans.
 *
 * The Planning Engine implements cognitive patterns like ReAct (Reasoning + Acting),
 * Chain-of-Thought, and Tree-of-Thought for sophisticated multi-step reasoning.
 *
 * @module AgentOS/Planning
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const planningEngine = new PlanningEngine(llmProvider, logger);
 *
 * // Generate a plan from a high-level goal
 * const plan = await planningEngine.generatePlan(
 *   'Research and summarize the latest AI safety papers',
 *   { maxSteps: 10, allowToolUse: true }
 * );
 *
 * // Execute with autonomous loop
 * for await (const step of planningEngine.runAutonomousLoop(goal, options)) {
 *   console.log(`Step ${step.index}: ${step.action}`);
 *   if (step.requiresHumanApproval) {
 *     // Handle HITL checkpoint
 *   }
 * }
 * ```
 */
export {};
//# sourceMappingURL=IPlanningEngine.js.map
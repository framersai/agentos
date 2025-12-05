/**
 * @file Planning Module Index
 * @description Exports for the AgentOS Planning Engine module.
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
 * } from '@framers/agentos/core/planning';
 *
 * const engine = new PlanningEngine({ llmProvider, logger });
 * const plan = await engine.generatePlan('Analyze customer data');
 * ```
 */

// Interfaces
export type {
  IPlanningEngine,
  ExecutionPlan,
  PlanStep,
  PlanStepResult,
  PlanStepStatus,
  PlanAction,
  PlanActionType,
  PlanningOptions,
  PlanningContext,
  PlanningStrategy,
  TaskDecomposition,
  SubTask,
  ExecutionFeedback,
  FeedbackType,
  AutonomousLoopOptions,
  LoopProgress,
  ApprovalRequest,
  PlanValidationResult,
  PlanValidationIssue,
  ReflectionResult,
  PlanAdjustment,
  ExecutionState,
  StepExecutionContext,
  ExecutionSummary,
  PlanMetadata,
} from './IPlanningEngine';

// Implementation
export { PlanningEngine, type PlanningEngineConfig } from './PlanningEngine';


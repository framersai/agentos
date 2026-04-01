/**
 * @file PlanningEngine.ts
 * @description Implementation of the AgentOS Planning Engine.
 * Provides autonomous goal pursuit, task decomposition, and self-correcting plans
 * using ReAct (Reasoning + Acting) and other cognitive patterns.
 *
 * @module AgentOS/Planning
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * import { PlanningEngine } from '@framers/agentos/planning/planner';
 *
 * const engine = new PlanningEngine({
 *   llmProvider: aiModelProviderManager,
 *   defaultModelId: 'gpt-4-turbo',
 * });
 *
 * const plan = await engine.generatePlan('Build a web scraper', {
 *   strategy: 'react',
 *   maxSteps: 10,
 * });
 * ```
 */
import type { ILogger } from '../../logging/ILogger';
import type { AIModelProviderManager } from '../../core/llm/providers/AIModelProviderManager';
import type { IPlanningEngine, ExecutionPlan, PlanStep, PlanStepResult, PlanningOptions, PlanningContext, TaskDecomposition, ExecutionFeedback, AutonomousLoopOptions, LoopProgress, PlanValidationResult, ReflectionResult, ExecutionState, StepExecutionContext, ExecutionSummary } from './IPlanningEngine';
/**
 * Configuration for the PlanningEngine.
 */
export interface PlanningEngineConfig {
    /** LLM provider manager for generating plans */
    llmProvider: AIModelProviderManager;
    /** Default model ID for planning */
    defaultModelId?: string;
    /** Default provider ID */
    defaultProviderId?: string;
    /** Logger instance */
    logger?: ILogger;
    /** Default planning options */
    defaultOptions?: Partial<PlanningOptions>;
}
/**
 * Implementation of the AgentOS Planning Engine.
 *
 * Features:
 * - ReAct (Reasoning + Acting) pattern for interleaved planning and execution
 * - Plan-and-Execute for upfront planning
 * - Tree-of-Thought for exploring multiple reasoning paths
 * - Self-reflection and plan refinement
 * - Checkpoint and rollback support
 * - Human-in-the-loop integration points
 *
 * @implements {IPlanningEngine}
 */
export declare class PlanningEngine implements IPlanningEngine {
    private readonly llmProvider;
    private readonly defaultModelId;
    private readonly defaultProviderId?;
    private readonly logger?;
    private readonly defaultOptions;
    /** Active execution states keyed by planId */
    private readonly executionStates;
    /** Saved checkpoints keyed by checkpointId */
    private readonly checkpoints;
    /**
     * Creates a new PlanningEngine instance.
     *
     * @param config - Engine configuration
     */
    constructor(config: PlanningEngineConfig);
    /**
     * Generates a multi-step execution plan from a high-level goal.
     *
     * @param goal - The high-level goal to achieve
     * @param context - Additional context for planning
     * @param options - Planning configuration options
     * @returns Generated execution plan
     */
    generatePlan(goal: string, context?: PlanningContext, options?: PlanningOptions): Promise<ExecutionPlan>;
    /**
     * Decomposes a complex task into simpler subtasks.
     *
     * @param task - The task description to decompose
     * @param depth - Maximum decomposition depth
     * @returns Task decomposition result
     */
    decomposeTask(task: string, depth?: number): Promise<TaskDecomposition>;
    /**
     * Validates a plan for feasibility and completeness.
     *
     * @param plan - Plan to validate
     * @returns Validation result with any issues found
     */
    validatePlan(plan: ExecutionPlan): Promise<PlanValidationResult>;
    /**
     * Refines an existing plan based on execution feedback.
     *
     * @param plan - Original plan to refine
     * @param feedback - Feedback from execution
     * @returns Refined execution plan
     */
    refinePlan(plan: ExecutionPlan, feedback: ExecutionFeedback): Promise<ExecutionPlan>;
    /**
     * Performs self-reflection on plan execution state.
     *
     * @param plan - Current plan
     * @param executionState - Current execution state
     * @returns Reflection insights and suggested adjustments
     */
    reflect(plan: ExecutionPlan, executionState: ExecutionState): Promise<ReflectionResult>;
    /**
     * Executes a single plan step.
     *
     * @param step - Step to execute
     * @param context - Execution context
     * @returns Step execution result
     */
    executeStep(step: PlanStep, context?: StepExecutionContext): Promise<PlanStepResult>;
    /**
     * Runs an autonomous goal pursuit loop.
     *
     * @param goal - Goal to pursue
     * @param options - Loop configuration
     * @yields Progress updates
     * @returns Final execution summary
     */
    runAutonomousLoop(goal: string, options?: AutonomousLoopOptions): AsyncGenerator<LoopProgress, ExecutionSummary, undefined>;
    /**
     * Saves current execution state for checkpointing.
     *
     * @param plan - Plan being executed
     * @param state - Current execution state
     * @returns Checkpoint identifier
     */
    saveCheckpoint(plan: ExecutionPlan, state: ExecutionState): Promise<string>;
    /**
     * Restores execution state from a checkpoint.
     *
     * @param checkpointId - Checkpoint to restore
     * @returns Restored plan and state
     */
    restoreCheckpoint(checkpointId: string): Promise<{
        plan: ExecutionPlan;
        state: ExecutionState;
    }>;
    /**
     * Gets the current execution state for a plan.
     *
     * @param planId - Plan identifier
     * @returns Current execution state or null
     */
    getExecutionState(planId: string): ExecutionState | null;
    private buildPlanningPrompt;
    private buildExecutionPlan;
    private createInitialState;
    private getNextReadyStep;
    private applyAdjustment;
    private callLLM;
}
//# sourceMappingURL=PlanningEngine.d.ts.map
/**
 * @file MissionPlanner.ts
 * @description Tree of Thought mission planner.
 *
 * Three-phase planning pipeline:
 *   Phase 1 — Divergent Exploration: generate N candidate graphs (Yao et al. 2023)
 *   Phase 2 — Evaluation and Selection: score and pick the best (Xie et al. 2023)
 *   Phase 3 — Refinement / Reflexion: fix gaps before execution (Shinn et al. 2023)
 *
 * Each phase uses a separate prompt template loaded from `prompts/`.
 */
import type { PlannerConfig, PlanResult } from './types.js';
/** Contextual information passed to the planner. */
export interface PlanContext {
    tools: Array<{
        name: string;
        description: string;
    }>;
    providers: string[];
}
/**
 * Tree of Thought mission planner.
 *
 * Generates N candidate execution graphs, evaluates them on four dimensions,
 * selects the best (or synthesizes a hybrid), and refines it before
 * compiling to `CompiledExecutionGraph`.
 */
export declare class MissionPlanner {
    private readonly config;
    private readonly decompositionPrompt;
    private readonly evaluationPrompt;
    private readonly refinementPrompt;
    /** LLM caller used for planning phases. Falls back to config.llmCaller. */
    private readonly planLlm;
    constructor(config: PlannerConfig);
    /**
     * Run the full planning pipeline: explore → evaluate → refine.
     *
     * @param goal - Natural language mission goal.
     * @param context - Available tools and providers.
     * @param onEvent - Optional callback for streaming planning progress events.
     */
    plan(goal: string, context: PlanContext, onEvent?: (event: {
        type: string;
        [k: string]: unknown;
    }) => void): Promise<PlanResult>;
    private generateBranches;
    private evaluateBranches;
    private refineBranch;
    private assignProviders;
    private compileToIR;
    private normalizeNodes;
    private normalizeNode;
    private normalizeEdges;
    private normalizeEdge;
    private applyProviderAssignment;
    private estimateComplexity;
}
//# sourceMappingURL=MissionPlanner.d.ts.map
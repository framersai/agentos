/**
 * @fileoverview EmergentCapabilityEngine — orchestrates runtime tool creation.
 * @module @framers/agentos/emergent/EmergentCapabilityEngine
 *
 * Provides the top-level pipeline that ties the forge subsystem together:
 *
 *   forge request → build tool → run tests → judge review → register
 *
 * Supports two creation modes:
 * - **Compose**: chains existing tools via {@link ComposableToolBuilder} (safe by construction).
 * - **Sandbox**: runs agent-written code via {@link SandboxedToolForge} (judge-gated).
 *
 * After registration the engine tracks usage and auto-promotes tools that
 * meet the configured `EmergentConfig.promotionThreshold` criteria.
 */
import type { EmergentConfig, ForgeToolRequest, ForgeResult, PromotionResult, EmergentTool } from './types.js';
import type { ITool, ToolExecutionContext } from '../core/tools/ITool.js';
import type { PersonalityMutationStore } from './PersonalityMutationStore.js';
import { ComposableToolBuilder } from './ComposableToolBuilder.js';
import { SandboxedToolForge } from './SandboxedToolForge.js';
import { EmergentJudge } from './EmergentJudge.js';
import { EmergentToolRegistry } from './EmergentToolRegistry.js';
/**
 * Dependencies required to construct the four self-improvement tools.
 *
 * Callers provide runtime hooks for personality access, skill management,
 * tool execution, and optional memory storage. The engine uses these to
 * wire each tool without hard-coupling to specific service implementations.
 */
export interface SelfImprovementToolDeps {
    /** Returns the current HEXACO personality trait values as a trait→value map. */
    getPersonality: () => Record<string, number>;
    /** Sets a single HEXACO personality trait to the given value (already clamped). */
    setPersonality: (trait: string, value: number) => void;
    /** Durable store for personality mutations (used by AdaptPersonalityTool for persistence). */
    mutationStore?: PersonalityMutationStore;
    /** Returns the agent's currently active skills. */
    getActiveSkills: (context?: ToolExecutionContext) => Array<{
        skillId: string;
        name: string;
        category: string;
    }>;
    /** Returns skill IDs that may not be disabled (core skills). */
    getLockedSkills: () => string[];
    /** Dynamically loads a skill by ID and returns its metadata. */
    loadSkill: (id: string, context?: ToolExecutionContext) => Promise<{
        skillId: string;
        name: string;
        category: string;
    }>;
    /** Unloads (disables) a previously loaded skill. */
    unloadSkill: (id: string, context?: ToolExecutionContext) => void;
    /** Searches the skill registry by query string, returning matching skill metadata. */
    searchSkills: (query: string, context?: ToolExecutionContext) => Array<{
        skillId: string;
        name: string;
        category: string;
        description: string;
    }>;
    /** Executes a registered tool by name with the given arguments. */
    executeTool: (name: string, args: unknown, context?: ToolExecutionContext) => Promise<unknown>;
    /** Returns the names of all currently registered tools. */
    listTools: () => string[];
    /** Optional callback for persisting self-improvement trace memories. */
    storeMemory?: (trace: {
        type: string;
        scope: string;
        content: string;
        tags: string[];
    }) => Promise<void>;
    /** Optional host-level getter for session-scoped runtime params such as temperature. */
    getSessionParam?: (param: string, context: ToolExecutionContext) => unknown;
    /** Optional host-level setter for session-scoped runtime params such as temperature. */
    setSessionParam?: (param: string, value: unknown, context: ToolExecutionContext) => void;
}
/**
 * Dependencies injected into the {@link EmergentCapabilityEngine} constructor.
 *
 * All collaborators are provided externally so the engine is trivially testable
 * with mocks — no real LLM calls, no real sandbox execution.
 */
export interface EmergentCapabilityEngineDeps {
    /** Resolved emergent capability configuration. */
    config: EmergentConfig;
    /** Builder for composable (tool-chaining) implementations. */
    composableBuilder: ComposableToolBuilder;
    /** Sandboxed code executor for arbitrary-code implementations. */
    sandboxForge: SandboxedToolForge;
    /** LLM-as-judge evaluator for creation and promotion reviews. */
    judge: EmergentJudge;
    /** Tiered registry for storing and querying emergent tools. */
    registry: EmergentToolRegistry;
    /** Optional callback used to activate a newly forged tool immediately. */
    onToolForged?: (tool: EmergentTool, executable: ITool) => Promise<void>;
    /** Optional callback used when a tool is promoted to a persisted tier. */
    onToolPromoted?: (tool: EmergentTool) => Promise<void>;
    /** Optional callback used when a tool is removed from the live runtime. */
    onToolRemoved?: (tool: EmergentTool) => Promise<void>;
}
/**
 * Orchestrates runtime tool creation for agents with emergent capabilities.
 *
 * Pipeline: forge request → build tool → run tests → judge review → register.
 *
 * Supports two creation modes:
 * - **Compose**: chains existing tools via {@link ComposableToolBuilder} (safe by construction).
 * - **Sandbox**: runs agent-written code via {@link SandboxedToolForge} (judge-gated).
 *
 * @example
 * ```ts
 * const engine = new EmergentCapabilityEngine({
 *   config: { ...DEFAULT_EMERGENT_CONFIG, enabled: true },
 *   composableBuilder,
 *   sandboxForge,
 *   judge,
 *   registry,
 * });
 *
 * const result = await engine.forge(request, { agentId: 'gmi-1', sessionId: 'sess-1' });
 * if (result.success) {
 *   console.log('Registered tool:', result.toolId);
 * }
 * ```
 */
export declare class EmergentCapabilityEngine {
    /** Injected dependencies. */
    private readonly config;
    private readonly composableBuilder;
    private readonly sandboxForge;
    private readonly judge;
    private readonly registry;
    private readonly onToolForged?;
    private readonly onToolPromoted?;
    private readonly onToolRemoved?;
    /** Internal index for fast session/agent → tool lookups. */
    private readonly index;
    /**
     * Create a new EmergentCapabilityEngine.
     *
     * @param deps - All collaborator dependencies. See {@link EmergentCapabilityEngineDeps}.
     */
    constructor(deps: EmergentCapabilityEngineDeps);
    /**
     * Forge a new tool from a request.
     *
     * Runs test cases, submits the candidate to the LLM judge, and registers the
     * tool at the `'session'` tier if approved. Returns a {@link ForgeResult} with
     * the tool ID on success, or an error / rejection verdict on failure.
     *
     * Pipeline:
     * 1. Generate unique tool ID.
     * 2. Build or validate implementation (compose vs. sandbox).
     * 3. Execute all declared test cases and collect results.
     * 4. Submit candidate to the judge for creation review.
     * 5. If approved: create {@link EmergentTool}, register at session tier, index.
     * 6. If rejected: return failure with the judge's reasoning.
     *
     * @param request - The forge request describing the desired tool.
     * @param context - Caller context containing the agent and session IDs.
     * @returns A {@link ForgeResult} indicating success or failure.
     */
    forge(request: ForgeToolRequest, context: {
        agentId: string;
        sessionId: string;
    }): Promise<ForgeResult>;
    /**
     * Check if a tool is eligible for promotion and auto-promote if the threshold
     * is met.
     *
     * A tool qualifies for promotion when:
     * 1. It is at the `'session'` tier.
     * 2. Its usage stats meet `EmergentConfig.promotionThreshold`:
     *    - `totalUses >= threshold.uses`
     *    - `confidenceScore >= threshold.confidence`
     *
     * When eligible, the engine submits the tool to the judge's promotion panel.
     * If both reviewers approve, the tool is promoted to `'agent'` tier.
     *
     * @param toolId - The ID of the tool to check.
     * @returns A {@link PromotionResult} if promotion was attempted, or `null` if
     *   the tool is not eligible or does not exist.
     */
    checkPromotion(toolId: string): Promise<PromotionResult | null>;
    /**
     * Get all session-scoped tools for a given session ID.
     *
     * @param sessionId - The session identifier.
     * @returns An array of {@link EmergentTool} objects belonging to the session.
     */
    getSessionTools(sessionId: string): EmergentTool[];
    /**
     * Get all agent-tier tools for a given agent ID.
     *
     * @param agentId - The agent identifier.
     * @returns An array of {@link EmergentTool} objects created by the agent.
     */
    getAgentTools(agentId: string): EmergentTool[];
    /**
     * Clean up all session tools for a given session.
     *
     * Delegates to the registry's `EmergentToolRegistry.cleanupSession()`
     * method and clears the local session index.
     *
     * @param sessionId - The session identifier to clean up.
     */
    cleanupSession(sessionId: string): EmergentTool[];
    /**
     * Hydrate a persisted tool back into a live runtime and make it executable.
     *
     * This is used by backend/admin control planes to sync shared tools from
     * durable storage into a running ToolOrchestrator after promotion or restart.
     */
    syncPersistedTool(tool: EmergentTool): Promise<void>;
    /**
     * Remove a previously synced tool from the live runtime and registry.
     */
    removeTool(toolId: string): Promise<EmergentTool | undefined>;
    /**
     * Factory method that creates the four self-improvement tools when
     * `config.selfImprovement?.enabled` is `true`.
     *
     * Returns an array containing:
     * 1. **AdaptPersonalityTool** — bounded HEXACO trait mutation.
     * 2. **ManageSkillsTool** — runtime skill enable/disable/search.
     * 3. **CreateWorkflowTool** — multi-step tool composition.
     * 4. **SelfEvaluateTool** — self-scoring with parameter adjustment.
     *
     * Returns an empty array when self-improvement is disabled or the
     * config is absent. Uses dynamic imports to avoid hard compile-time
     * coupling to tool modules that may not yet exist.
     *
     * @param deps - Runtime hooks for personality, skills, tools, and memory.
     * @returns Array of 0 or 4 {@link ITool} instances.
     */
    createSelfImprovementTools(deps: SelfImprovementToolDeps): Promise<ITool[]>;
    /**
     * Create an executable ITool wrapper for a forged emergent tool.
     *
     * The wrapper performs runtime output validation, usage tracking, and
     * promotion checks after each successful execution.
     */
    createExecutableTool(tool: EmergentTool): ITool<Record<string, unknown>, unknown>;
    /**
     * Add a tool ID to the session and agent indexes for fast future lookup.
     *
     * @param toolId - The tool ID to index.
     * @param agentId - The agent that created the tool.
     * @param sessionId - The session in which the tool was created.
     */
    private indexTool;
    private removeIndexedTool;
    private removeIndexedToolEverywhere;
    private extractSessionId;
    private buildSandboxExecutable;
}
//# sourceMappingURL=EmergentCapabilityEngine.d.ts.map
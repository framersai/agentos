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
 * meet the configured {@link EmergentConfig.promotionThreshold} criteria.
 */

import type {
  EmergentConfig,
  ForgeToolRequest,
  ForgeResult,
  PromotionResult,
  EmergentTool,
  ToolUsageStats,
} from './types.js';
import type { ToolCandidate } from './EmergentJudge.js';
import type {
  ITool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../core/tools/ITool.js';
import { ComposableToolBuilder } from './ComposableToolBuilder.js';
import { SandboxedToolForge } from './SandboxedToolForge.js';
import { EmergentJudge } from './EmergentJudge.js';
import { EmergentToolRegistry } from './EmergentToolRegistry.js';

// ============================================================================
// DEPENDENCY BUNDLE
// ============================================================================

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
}

// ============================================================================
// SESSION / AGENT TOOL INDEX
// ============================================================================

/**
 * Internal index mapping session IDs and agent IDs to their associated
 * emergent tool IDs, enabling fast lookup for {@link getSessionTools},
 * {@link getAgentTools}, and {@link cleanupSession}.
 */
interface ToolIndex {
  /** Session ID → set of tool IDs created in that session. */
  bySession: Map<string, Set<string>>;
  /** Agent ID → set of tool IDs created by that agent. */
  byAgent: Map<string, Set<string>>;
}

// ============================================================================
// ENGINE
// ============================================================================

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
export class EmergentCapabilityEngine {
  /** Injected dependencies. */
  private readonly config: EmergentConfig;
  private readonly composableBuilder: ComposableToolBuilder;
  private readonly sandboxForge: SandboxedToolForge;
  private readonly judge: EmergentJudge;
  private readonly registry: EmergentToolRegistry;
  private readonly onToolForged?: (tool: EmergentTool, executable: ITool) => Promise<void>;
  private readonly onToolPromoted?: (tool: EmergentTool) => Promise<void>;

  /** Internal index for fast session/agent → tool lookups. */
  private readonly index: ToolIndex = {
    bySession: new Map(),
    byAgent: new Map(),
  };

  /**
   * Create a new EmergentCapabilityEngine.
   *
   * @param deps - All collaborator dependencies. See {@link EmergentCapabilityEngineDeps}.
   */
  constructor(deps: EmergentCapabilityEngineDeps) {
    this.config = deps.config;
    this.composableBuilder = deps.composableBuilder;
    this.sandboxForge = deps.sandboxForge;
    this.judge = deps.judge;
    this.registry = deps.registry;
    this.onToolForged = deps.onToolForged;
    this.onToolPromoted = deps.onToolPromoted;
  }

  // --------------------------------------------------------------------------
  // PUBLIC: forge
  // --------------------------------------------------------------------------

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
  async forge(
    request: ForgeToolRequest,
    context: { agentId: string; sessionId: string },
  ): Promise<ForgeResult> {
    // Guard: engine must be enabled.
    if (!this.config.enabled) {
      return { success: false, error: 'Emergent capabilities are disabled.' };
    }

    // Step 1: Generate a unique tool ID.
    const toolId = `emergent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Step 2 & 3: Build implementation and run test cases.
    const testResults: ToolCandidate['testResults'] = [];
    let source: string;

    if (request.implementation.mode === 'compose') {
      // ---- COMPOSE MODE ----
      source = JSON.stringify(request.implementation);

      // Build the composable tool so we can execute test cases against it.
      const composedTool = this.composableBuilder.build(
        request.name,
        request.description,
        request.inputSchema,
        request.implementation,
      );

      // Run every declared test case.
      const mockContext: ToolExecutionContext = {
        gmiId: context.agentId,
        personaId: 'emergent-forge',
        userContext: { userId: 'system' } as any,
        correlationId: context.sessionId,
      };

      for (const tc of request.testCases) {
        try {
          const result = await composedTool.execute(
            tc.input as Record<string, unknown>,
            mockContext,
          );
          testResults.push({
            input: tc.input,
            output: result.output,
            success: result.success,
            error: result.error,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          testResults.push({
            input: tc.input,
            output: undefined,
            success: false,
            error: message,
          });
        }
      }
    } else {
      // ---- SANDBOX MODE ----
      source = request.implementation.code;

      // Step 2a: Static code validation before any execution.
      const validation = this.sandboxForge.validateCode(
        request.implementation.code,
        request.implementation.allowlist,
      );

      if (!validation.valid) {
        return {
          success: false,
          error: `Code validation failed: ${validation.violations.join('; ')}`,
        };
      }

      // Step 3: Execute test cases in the sandbox.
      for (const tc of request.testCases) {
        const sandboxResult = await this.sandboxForge.execute({
          code: request.implementation.code,
          input: tc.input,
          allowlist: request.implementation.allowlist,
          memoryMB: this.config.sandboxMemoryMB,
          timeoutMs: this.config.sandboxTimeoutMs,
        });

        testResults.push({
          input: tc.input,
          output: sandboxResult.output,
          success: sandboxResult.success,
          error: sandboxResult.error,
        });
      }
    }

    // Step 4: Build candidate and submit to judge.
    const candidate: ToolCandidate = {
      name: request.name,
      description: request.description,
      inputSchema: request.inputSchema,
      outputSchema: request.outputSchema,
      source,
      implementationMode: request.implementation.mode,
      allowlist:
        request.implementation.mode === 'sandbox'
          ? request.implementation.allowlist
          : undefined,
      testResults,
    };

    const verdict = await this.judge.reviewCreation(candidate);

    // Step 5: Register if approved.
    if (verdict.approved) {
      const now = new Date().toISOString();

      const usageStats: ToolUsageStats = {
        totalUses: 0,
        successCount: 0,
        failureCount: 0,
        avgExecutionTimeMs: 0,
        lastUsedAt: null,
        confidenceScore: verdict.confidence,
      };

      const tool: EmergentTool = {
        id: toolId,
        name: request.name,
        description: request.description,
        inputSchema: request.inputSchema,
        outputSchema: request.outputSchema,
        implementation: request.implementation,
        tier: 'session',
        createdBy: context.agentId,
        createdAt: now,
        judgeVerdicts: [verdict],
        usageStats,
        source: `forged by agent ${context.agentId} during session ${context.sessionId}`,
      };

      this.registry.register(tool, 'session');
      this.indexTool(toolId, context.agentId, context.sessionId);

      if (this.onToolForged) {
        try {
          await this.onToolForged(tool, this.createExecutableTool(tool));
        } catch (error: unknown) {
          this.registry.remove(toolId);
          this.removeIndexedTool(toolId, context.agentId, context.sessionId);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to activate forged tool.',
          };
        }
      }

      return {
        success: true,
        toolId,
        tool,
        verdict,
      };
    }

    // Step 6: Rejected.
    return {
      success: false,
      verdict,
      error: verdict.reasoning,
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: checkPromotion
  // --------------------------------------------------------------------------

  /**
   * Check if a tool is eligible for promotion and auto-promote if the threshold
   * is met.
   *
   * A tool qualifies for promotion when:
   * 1. It is at the `'session'` tier.
   * 2. Its usage stats meet {@link EmergentConfig.promotionThreshold}:
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
  async checkPromotion(toolId: string): Promise<PromotionResult | null> {
    const tool = this.registry.get(toolId);

    if (!tool) {
      return null;
    }

    // Only session-tier tools are eligible for auto-promotion.
    if (tool.tier !== 'session') {
      return null;
    }

    // Check thresholds.
    const { uses, confidence } = this.config.promotionThreshold;

    if (
      tool.usageStats.totalUses < uses ||
      tool.usageStats.confidenceScore < confidence
    ) {
      return null;
    }

    // Submit to the promotion panel.
    const promotionVerdict = await this.judge.reviewPromotion(tool);
    tool.judgeVerdicts.push(promotionVerdict);

    if (promotionVerdict.approved) {
      await this.registry.promote(toolId, 'agent');
      const promotedTool = this.registry.get(toolId);
      if (promotedTool && this.onToolPromoted) {
        await this.onToolPromoted(promotedTool);
      }

      return {
        success: true,
        verdict: promotionVerdict,
      };
    }

    return {
      success: false,
      verdict: promotionVerdict,
      error: 'Promotion panel rejected the tool.',
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: getSessionTools
  // --------------------------------------------------------------------------

  /**
   * Get all session-scoped tools for a given session ID.
   *
   * @param sessionId - The session identifier.
   * @returns An array of {@link EmergentTool} objects belonging to the session.
   */
  getSessionTools(sessionId: string): EmergentTool[] {
    const toolIds = this.index.bySession.get(sessionId);
    if (!toolIds) {
      return [];
    }

    const tools: EmergentTool[] = [];
    for (const id of toolIds) {
      const tool = this.registry.get(id);
      if (tool) {
        tools.push(tool);
      }
    }
    return tools;
  }

  // --------------------------------------------------------------------------
  // PUBLIC: getAgentTools
  // --------------------------------------------------------------------------

  /**
   * Get all agent-tier tools for a given agent ID.
   *
   * @param agentId - The agent identifier.
   * @returns An array of {@link EmergentTool} objects created by the agent.
   */
  getAgentTools(agentId: string): EmergentTool[] {
    return this.registry.getByTier('agent', { agentId });
  }

  // --------------------------------------------------------------------------
  // PUBLIC: cleanupSession
  // --------------------------------------------------------------------------

  /**
   * Clean up all session tools for a given session.
   *
   * Delegates to the registry's {@link EmergentToolRegistry.cleanupSession}
   * method and clears the local session index.
   *
   * @param sessionId - The session identifier to clean up.
   */
  cleanupSession(sessionId: string): EmergentTool[] {
    const removedTools = this.getSessionTools(sessionId);
    this.registry.cleanupSession(sessionId);
    this.index.bySession.delete(sessionId);
    return removedTools;
  }

  /**
   * Create an executable ITool wrapper for a forged emergent tool.
   *
   * The wrapper performs runtime output validation, usage tracking, and
   * promotion checks after each successful execution.
   */
  createExecutableTool(tool: EmergentTool): ITool<Record<string, unknown>, unknown> {
    const baseTool =
      tool.implementation.mode === 'compose'
        ? this.composableBuilder.build(
            tool.name,
            tool.description,
            tool.inputSchema,
            tool.implementation,
          )
        : this.buildSandboxExecutable(tool);

    return {
      id: `emergent-tool:${tool.id}`,
      name: tool.name,
      displayName: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      category: 'emergent',
      hasSideEffects: tool.implementation.mode === 'sandbox',
      execute: async (
        args: Record<string, unknown>,
        context: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
        const startTime = performance.now();
        const result = await baseTool.execute(args, context);
        const executionTimeMs = Math.round(performance.now() - startTime);

        let success = result.success;
        let error = result.error;

        if (success) {
          const reuseVerdict = this.judge.validateReuse(
            tool.id,
            result.output,
            tool.outputSchema,
          );
          if (!reuseVerdict.valid) {
            success = false;
            error = `Output schema validation failed: ${reuseVerdict.schemaErrors.join('; ')}`;
          }
        }

        this.registry.recordUse(
          tool.id,
          args,
          result.output,
          success,
          executionTimeMs,
        );

        if (success) {
          await this.checkPromotion(tool.id);
        }

        return success
          ? result
          : {
              success: false,
              output: result.output,
              error: error ?? 'Emergent tool execution failed.',
            };
      },
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE: indexTool
  // --------------------------------------------------------------------------

  /**
   * Add a tool ID to the session and agent indexes for fast future lookup.
   *
   * @param toolId - The tool ID to index.
   * @param agentId - The agent that created the tool.
   * @param sessionId - The session in which the tool was created.
   */
  private indexTool(
    toolId: string,
    agentId: string,
    sessionId: string,
  ): void {
    // Session index.
    if (!this.index.bySession.has(sessionId)) {
      this.index.bySession.set(sessionId, new Set());
    }
    this.index.bySession.get(sessionId)!.add(toolId);

    // Agent index.
    if (!this.index.byAgent.has(agentId)) {
      this.index.byAgent.set(agentId, new Set());
    }
    this.index.byAgent.get(agentId)!.add(toolId);
  }

  private removeIndexedTool(
    toolId: string,
    agentId: string,
    sessionId: string,
  ): void {
    this.index.bySession.get(sessionId)?.delete(toolId);
    this.index.byAgent.get(agentId)?.delete(toolId);
  }

  private buildSandboxExecutable(tool: EmergentTool): ITool<Record<string, unknown>, unknown> {
    return {
      id: `sandboxed:${tool.id}`,
      name: tool.name,
      displayName: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      category: 'emergent',
      hasSideEffects: true,
      execute: async (
        args: Record<string, unknown>,
      ): Promise<ToolExecutionResult> => {
        if (tool.implementation.mode !== 'sandbox') {
          return {
            success: false,
            error: 'Sandbox executor received a non-sandbox emergent tool.',
          };
        }

        const sandboxResult = await this.sandboxForge.execute({
          code: tool.implementation.code,
          input: args,
          allowlist: tool.implementation.allowlist,
          memoryMB: this.config.sandboxMemoryMB,
          timeoutMs: this.config.sandboxTimeoutMs,
        });

        return sandboxResult.success
          ? { success: true, output: sandboxResult.output }
          : { success: false, error: sandboxResult.error };
      },
    };
  }
}

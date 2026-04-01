/**
 * @fileoverview Core types for the Emergent Capability Engine.
 * @module @framers/agentos/emergent/types
 *
 * Provides all type definitions for the runtime tool creation system, enabling
 * agents to forge new tools via composition or sandboxed code execution, subject
 * to LLM-as-judge verification and tiered promotion.
 *
 * Key concepts:
 * - ToolTier: Lifecycle scope of an emergent tool (session → agent → shared)
 * - ComposableToolSpec: Pipeline of existing tool calls with input mapping
 * - SandboxedToolSpec: Arbitrary code execution in a memory/time-bounded sandbox
 * - CreationVerdict: LLM judge evaluation of a newly forged tool
 * - PromotionVerdict: Multi-reviewer gate before tier promotion
 * - EmergentTool: Unified shape for any runtime-created tool
 */
/**
 * Default configuration for the Emergent Capability Engine.
 *
 * Note: `enabled` defaults to `false` — emergent capabilities must be explicitly
 * opted-in via the agent's configuration to prevent accidental runtime tool creation.
 */
export const DEFAULT_EMERGENT_CONFIG = {
    enabled: false,
    maxSessionTools: 10,
    maxAgentTools: 50,
    allowSandboxTools: false,
    persistSandboxSource: false,
    sandboxMemoryMB: 128,
    sandboxTimeoutMs: 5000,
    promotionThreshold: {
        uses: 5,
        confidence: 0.8,
    },
    judgeModel: 'gpt-4o-mini',
    promotionJudgeModel: 'gpt-4o',
};
//# sourceMappingURL=types.js.map
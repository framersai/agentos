/**
 * Domain-organized barrel for all core subsystems.
 *
 * Modules that remain in core/:
 *   llm/, tools/, conversation/, orchestration/, streaming/, storage/, utils/
 *
 * Modules that have been relocated to top-level domains are re-exported here
 * for backward compatibility:
 *
 * INTELLIGENCE — LLM providers, structured outputs, AI utilities, planning, prompt routing
 * SAFETY       — Guardrails, safety primitives (circuit breaker, cost guard), HITL, sandbox
 * AGENTS       — Agent runtime, multi-agent agency, orchestration, conversation
 * TOOLS        — Tool interface, orchestrator, executor, permissions
 * AUTOMATION   — Workflow engine, runtime, storage
 * PERSISTENCE  — Storage adapters, knowledge graph, provenance
 * PLATFORM     — Audio, language, observability, evaluation, marketplace
 */

// ============================================================================
// INTELLIGENCE — LLM + reasoning capabilities
// ============================================================================
export * from './llm/IPromptEngine.js';
export { PromptEngine } from './llm/PromptEngine.js';
export * from './llm/providers/AIModelProviderManager.js';
export * from '../structured/output/index.js';
export * from '../nlp/ai_utilities/index.js';
export * from '../planning/planner/index.js';
export * from '../structured/prompting/PromptProfileRouter.js';

// ============================================================================
// SAFETY — Safety + human oversight
// ============================================================================
export * from '../safety/guardrails/index.js';
export * from '../safety/runtime/index.js';
export * from '../planning/hitl/index.js';
export * from '../sandbox/executor/index.js';

// ============================================================================
// AGENTS — Agent runtime + multi-agent orchestration
// ============================================================================
export * from '../agents/definitions/index.js';
export * from '../agents/agency/index.js';
export * from './orchestration/index.js';
export * from './conversation/index.js';
export * from './streaming/index.js';

// ============================================================================
// TOOLS — Tool system
// ============================================================================
export * from './tools/index.js';

// ============================================================================
// AUTOMATION — Workflow engine
// ============================================================================
export * from '../planning/workflows/IWorkflowEngine.js';
export { WorkflowEngine } from '../planning/workflows/WorkflowEngine.js';
export * from '../planning/workflows/WorkflowTypes.js';
export * from '../planning/workflows/storage/IWorkflowStore.js';
export { InMemoryWorkflowStore } from '../planning/workflows/storage/InMemoryWorkflowStore.js';

// ============================================================================
// PERSISTENCE — Data + audit
// ============================================================================
export * from './storage/index.js';
export * from '../knowledge/index.js';
export * from '../provenance/index.js';

// ============================================================================
// PLATFORM — Cross-cutting infrastructure
// ============================================================================
export * from '../media/audio/index.js';
export * from '../nlp/language/index.js';
export * from '../evaluation/observability/index.js';
export * from '../evaluation/index.js';
export * from '../marketplace/store/index.js';
export * from '../marketplace/workspace/index.js';

/**
 * @fileoverview Domain-organized barrel for all core subsystems.
 *
 * Subsystems are grouped into 7 domains for navigability:
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
export * from './structured/index.js';
export * from './ai_utilities/index.js';
export * from './planning/index.js';
export * from './prompting/PromptProfileRouter.js';

// ============================================================================
// SAFETY — Safety + human oversight
// ============================================================================
export * from './guardrails/index.js';
export * from './safety/index.js';
export * from './hitl/index.js';
export * from './sandbox/index.js';

// ============================================================================
// AGENTS — Agent runtime + multi-agent orchestration
// ============================================================================
export * from './agents/index.js';
export * from './agency/index.js';
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
export * from './workflows/IWorkflowEngine.js';
export { WorkflowEngine } from './workflows/WorkflowEngine.js';
export * from './workflows/WorkflowTypes.js';
export * from './workflows/storage/IWorkflowStore.js';
export { InMemoryWorkflowStore } from './workflows/storage/InMemoryWorkflowStore.js';

// ============================================================================
// PERSISTENCE — Data + audit
// ============================================================================
export * from './storage/index.js';
export * from './knowledge/index.js';
export * from './provenance/index.js';

// ============================================================================
// PLATFORM — Cross-cutting infrastructure
// ============================================================================
export * from './audio/index.js';
export * from './language/index.js';
export * from './observability/index.js';
export * from './evaluation/index.js';
export * from './marketplace/index.js';
export * from './workspace/index.js';

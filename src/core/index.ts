/**
 * Core infrastructure barrel — foundational subsystems only.
 *
 * Modules: llm, tools, conversation, streaming, storage,
 * embeddings, vector-store, safety, guardrails, utils, rate-limiting.
 *
 * For non-core modules, import from their own barrels:
 *   @framers/agentos/orchestration
 *   @framers/agentos/memory
 *   @framers/agentos/rag
 *   @framers/agentos/knowledge
 *   @framers/agentos/provenance
 *   etc.
 */

// ============================================================================
// LLM — Provider management, prompt engine, routing
// ============================================================================
export * from './llm/IPromptEngine.js';
export { PromptEngine } from './llm/PromptEngine.js';
export * from './llm/providers/AIModelProviderManager.js';
export * from './llm/routing/index.js';

// ============================================================================
// TOOLS — ITool, executor, permissions, orchestrator
// ============================================================================
export * from './tools/index.js';

// ============================================================================
// CONVERSATION — Manager, rolling summary, long-term memory retriever
// ============================================================================
export * from './conversation/index.js';

// ============================================================================
// STREAMING — StreamingManager
// ============================================================================
export * from './streaming/index.js';

// ============================================================================
// STORAGE — Adapters
// ============================================================================
export * from './storage/index.js';

// ============================================================================
// EMBEDDINGS — IEmbeddingManager interface
// ============================================================================
export * from './embeddings/index.js';

// ============================================================================
// VECTOR STORE — IVectorStore interface
// ============================================================================
export * from './vector-store/index.js';

// ============================================================================
// SAFETY — CircuitBreaker, CostGuard, StuckDetector, ActionDeduplicator
// ============================================================================
export * from '../safety/runtime/index.js';

// ============================================================================
// GUARDRAILS — IGuardrailService
// ============================================================================
export * from '../safety/guardrails/index.js';

// ============================================================================
// UTILITIES
// ============================================================================
export * from './utils/index.js';

// ============================================================================
// RATE LIMITING
// ============================================================================
export * from './rate-limiting/index.js';

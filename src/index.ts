/**
 * Barrel exports for the subset of AgentOS modules that external consumers
 * should generally import. Internal modules can still be reached via
 * `@framers/agentos/<path>` thanks to the workspace exports map.
 */

export * from './api/AgentOS.js';
export * from './api/AgentOSOrchestrator';
export * from './api/types/AgentOSInput';
export * from './api/types/AgentOSResponse';
export * from './cognitive_substrate/IGMI';
export * from './cognitive_substrate/GMIManager';
export type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from './core/tools/ITool';
export * from './core/llm/IPromptEngine';
export * from './config/ToolOrchestratorConfig';
export * from './core/tools/permissions/IToolPermissionManager';
export * from './core/conversation/ConversationManager';
export * from './core/conversation/IRollingSummaryMemorySink';
export * from './core/conversation/ILongTermMemoryRetriever';
export * from './core/conversation/LongTermMemoryPolicy';
export * from './core/streaming/StreamingManager';
export * from './core/llm/providers/AIModelProviderManager';
export * from './core/workflows/WorkflowTypes';
export * from './core/workflows/IWorkflowEngine';
export * from './core/workflows/storage/IWorkflowStore';
export { WorkflowEngine } from './core/workflows/WorkflowEngine';
export { InMemoryWorkflowStore } from './core/workflows/storage/InMemoryWorkflowStore';
// Agency (Multi-Agent Collectives)
export * from './core/agency/AgencyTypes';
export { AgencyRegistry } from './core/agency/AgencyRegistry';
export { AgencyMemoryManager } from './core/agency/AgencyMemoryManager';
export type {
  AgencyMemoryIngestInput,
  AgencyMemoryChunk,
  AgencyMemoryQueryResult,
  AgencyMemoryStats,
} from './core/agency/AgencyMemoryManager';
export { AgentCommunicationBus } from './core/agency/AgentCommunicationBus';
export type {
  IAgentCommunicationBus,
  AgentMessage,
  AgentMessageType,
  AgentRequest,
  AgentResponse,
  HandoffContext,
  HandoffResult,
} from './core/agency/IAgentCommunicationBus';
// Planning Engine
export * from './core/planning';
// Human-in-the-Loop (HITL)
export * from './core/hitl';
// Structured Outputs (JSON Schema, Function Calling)
export * from './core/structured';
// Code Execution Sandbox
export * from './core/sandbox';
// Observability & Tracing
export * from './core/observability';
// Evaluation Framework
export * from './core/evaluation';
// Knowledge Graph
export * from './core/knowledge';
// Agent Marketplace
export * from './core/marketplace';
// Per-agent workspace helpers
export * from './core/workspace';
export * from './cognitive_substrate/personas/definitions';
export * from './cognitive_substrate/personas/IPersonaDefinition';
export * from './cognitive_substrate/persona_overlays/PersonaOverlayTypes';
export { PersonaOverlayManager } from './cognitive_substrate/persona_overlays/PersonaOverlayManager';
// Guardrails
export * from './core/guardrails';
export * from './extensions';
// Messaging Channels (external platform adapters)
export * from './channels';
// Voice Calls (telephony providers)
export * from './voice';
// Skills (SKILL.md prompt modules)
export * from './skills';
// Multilingual exports
export * from './core/language/interfaces';
export * from './core/language/LanguageService';
export type { ILogger } from './logging/ILogger';
export { createLogger, setLoggerFactory, resetLoggerFactory } from './logging/loggerFactory';
// Rate limit types
export * from './types/rateLimitTypes';
// Storage adapters
export * from './core/storage';
// RAG (Retrieval Augmented Generation)
export * from './rag';
// Provenance, Audit & Immutability
export * from './core/provenance';
// Safety Primitives (circuit breaker, dedup, cost guard, stuck detection)
export * from './core/safety';
// Extension Secrets Catalog
export {
  EXTENSION_SECRET_DEFINITIONS,
  type ExtensionSecretDefinition,
  getSecretDefinition,
  resolveSecretForProvider,
} from './config/extensionSecrets.js';

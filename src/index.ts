/**
 * Barrel exports for the subset of AgentOS modules that external consumers
 * should generally import. Internal modules can still be reached via
 * `@framers/agentos/<path>` thanks to the workspace exports map.
 */

export * from './api/AgentOS.js';
export * from './api/runtime/AgentOSOrchestrator';
export * from './api/types/AgentOSInput';
export * from './api/types/AgentOSResponse';
export * from './api/types/AgentOSExternalToolRequest';
export * from './api/types/AgentOSToolResult';
export * from './cognitive_substrate/IGMI';
export * from './cognitive_substrate/GMIManager';
export type {
  ITool,
  ToolExecutionResult,
  ToolExecutionContext,
  JSONSchemaObject,
} from './core/tools/ITool';
export * from './core/llm/IPromptEngine';
export * from './config/ToolOrchestratorConfig';
export * from './core/tools/permissions/IToolPermissionManager';
export * from './core/conversation/ConversationManager';
export * from './core/conversation/IRollingSummaryMemorySink';
export * from './core/conversation/ILongTermMemoryRetriever';
export * from './core/conversation/LongTermMemoryPolicy';
export * from './core/streaming/StreamingManager';
export * from './core/llm/providers/AIModelProviderManager';
export * from './orchestration/turn-planner/TurnPlanner';
export * from './orchestration/turn-planner/SqlTaskOutcomeTelemetryStore';
export * from './planning/workflows/WorkflowTypes';
export * from './planning/workflows/IWorkflowEngine';
export * from './planning/workflows/storage/IWorkflowStore';
export { WorkflowEngine } from './planning/workflows/WorkflowEngine';
export { InMemoryWorkflowStore } from './planning/workflows/storage/InMemoryWorkflowStore';
// Agency (Multi-Agent Collectives)
export * from './agents/agency/AgencyTypes';
export { AgencyRegistry } from './agents/agency/AgencyRegistry';
export { AgencyMemoryManager } from './agents/agency/AgencyMemoryManager';
export type {
  AgencyMemoryIngestInput,
  AgencyMemoryChunk,
  AgencyMemoryQueryResult,
  AgencyMemoryStats,
} from './agents/agency/AgencyMemoryManager';
export { AgentCommunicationBus } from './agents/agency/AgentCommunicationBus';
export type {
  IAgentCommunicationBus,
  AgentMessage,
  AgentMessageType,
  AgentRequest,
  AgentResponse,
  HandoffContext,
  HandoffResult,
} from './agents/agency/IAgentCommunicationBus';
// Planning Engine
export * from './planning/planner';
// Human-in-the-Loop (HITL)
export * from './planning/hitl';
// Structured Outputs (JSON Schema, Function Calling)
export * from './structured/output';
// Code Execution Sandbox
export * from './sandbox/executor';
// Observability & Tracing
export * from './evaluation/observability';
// Evaluation Framework
export * from './evaluation';
// Knowledge Graph
export * from './knowledge';
// Agent Marketplace
export * from './marketplace/store';
// Per-agent workspace helpers
export * from './marketplace/workspace';
export * from './cognitive_substrate/personas/definitions';
export * from './cognitive_substrate/personas/IPersonaDefinition';
export * from './cognitive_substrate/persona_overlays/PersonaOverlayTypes';
export { PersonaOverlayManager } from './cognitive_substrate/persona_overlays/PersonaOverlayManager';
// Guardrails
export * from './safety/guardrails';
export * from './extensions';
// Messaging Channels (external platform adapters)
export * from './channels';
// Voice Calls (telephony providers)
export * from './telephony';
// Unified speech runtime (STT/TTS/VAD/wake-word)
export * from './speech';
// Unified image generation providers
export * from './media/images';
// Unified video generation, analysis, and scene detection
export * from './media/video/index.js';
// Unified audio generation (music + SFX) and provider registry
export * from './media/audio/index.js';
// Hearing module (audio processing + STT/VAD providers)
export * from './hearing';
// Media provider preference resolver (shared across image/video/audio)
export * from './media/ProviderPreferences.js';
// Unified vision pipeline (OCR + handwriting + document AI + CLIP + cloud)
export { VisionPipeline, createVisionPipeline, LLMVisionProvider, PipelineVisionProvider } from './vision/index.js';
export type {
  VisionPipelineConfig,
  VisionResult,
  VisionStrategy,
  VisionTier,
  ContentCategory as VisionContentCategory,
  TierResult as VisionTierResult,
  TextRegion as VisionTextRegion,
  DocumentLayout,
  DocumentPage,
  LayoutBlock,
  VisionPreprocessingConfig,
} from './vision/types.js';
export type { LLMVisionProviderConfig } from './vision/providers/LLMVisionProvider.js';
// Skills (SKILL.md prompt modules)
export * from './skills';
// Multilingual exports
export * from './nlp/language/interfaces';
export * from './nlp/language/LanguageService';
export type { ILogger } from './logging/ILogger';
export { createLogger, setLoggerFactory, resetLoggerFactory } from './logging/loggerFactory';
// Rate limit types
export * from './core/rate-limiting/types';
// Storage adapters
export * from './core/storage';
// Usage & cost accounting
export * from './core/utils/usage/UsageLedger';
// RAG (Retrieval Augmented Generation)
export * from './rag';
// Cognitive Memory System
export * from './memory';
// Query Router (classification, retrieval dispatch, grounded answer generation)
export {
  QueryClassifier,
  QueryDispatcher,
  QueryGenerator,
  QueryRouter,
  TopicExtractor,
  KeywordFallback,
} from './query-router/index.js';
export type {
  QueryTier,
  ClassificationResult,
  RetrievedChunk,
  SourceCitation,
  RetrievalResult,
  ConversationMessage,
  QueryRouterConfig,
  ClassifyStartEvent,
  ClassifyCompleteEvent,
  ClassifyErrorEvent,
  RetrieveStartEvent,
  RetrieveVectorEvent,
  RetrieveGraphEvent,
  RetrieveRerankEvent,
  RetrieveCompleteEvent,
  RetrieveFallbackEvent,
  ResearchStartEvent,
  ResearchPhaseEvent,
  ResearchCompleteEvent,
  GenerateStartEvent,
  GenerateCompleteEvent,
  RouteCompleteEvent,
  QueryRouterEventUnion,
  CorpusChunk,
  TopicEntry,
  QueryResult as QueryRouterResult,
  QueryRouterEmbeddingStatus,
  QueryRouterRetrievalMode,
  QueryRouterRuntimeMode,
  QueryRouterToggleableRuntimeMode,
  QueryRouterCorpusStats,
} from './query-router/types.js';
// Orchestration Layer (IR, Events, Checkpoint, Runtime)
export * from './orchestration/index.js';
// Provenance, Audit & Immutability
export * from './provenance';
// Safety Primitives (circuit breaker, dedup, cost guard, stuck detection)
export * from './safety/runtime';
// Emergent Capability Engine (runtime tool creation)
export * from './emergent/index.js';
// Extension Secrets Catalog
export {
  EXTENSION_SECRET_DEFINITIONS,
  type ExtensionSecretDefinition,
  getSecretDefinition,
  resolveSecretForProvider,
} from './config/extensionSecrets.js';

// --- High-Level API (AI SDK style) ---
export { generateText } from './api/generateText.js';
export type {
  GenerateTextOptions,
  GenerateTextResult,
  Message,
  ToolCallRecord,
  TokenUsage,
} from './api/generateText.js';
export { streamText } from './api/streamText.js';
export type { StreamTextResult, StreamPart } from './api/streamText.js';
export { agent } from './api/agent.js';
export type { Agent, AgentSession, AgentOptions } from './api/agent.js';
export { agency } from './api/agency.js';
export {
  exportAgentConfig,
  exportAgentConfigJSON,
  exportAgentConfigYAML,
  importAgent,
  importAgentFromJSON,
  importAgentFromYAML,
  validateAgentExport,
} from './api/agentExport.js';
export type { AgentExportConfig } from './api/agentExport.js';
export { hitl } from './api/hitl.js';
export type { HitlHandler } from './api/hitl.js';
export * from './api/runtime/processRequestWithExternalTools.js';
export * from './api/runtime/externalToolRegistry.js';
export * from './api/runtime/processRequestWithRegisteredTools.js';
export * from './api/runtime/resumeExternalToolRequestWithRegisteredTools.js';
export type {
  AgencyOptions,
  AgencyStrategy,
  AgencyConfigError as AgencyConfigErrorType,
  AgencyCallbacks,
  AgencyStreamResult,
  AgencyStreamPart,
  AgencyTraceEvent,
  AgentCallRecord,
  ApprovalRequest,
  ApprovalDecision,
  ResourceControls,
  HitlConfig,
  CompiledStrategy,
  CompiledStrategyStreamResult,
  Agency,
} from './api/types.js';
export { AgencyConfigError } from './api/types.js';
export { generateImage } from './api/generateImage.js';
export type { GenerateImageOptions, GenerateImageResult } from './api/generateImage.js';
export { editImage } from './api/editImage.js';
export type { EditImageOptions, EditImageResult } from './api/editImage.js';
export { upscaleImage } from './api/upscaleImage.js';
export type { UpscaleImageOptions, UpscaleImageResult } from './api/upscaleImage.js';
export { variateImage } from './api/variateImage.js';
export type { VariateImageOptions, VariateImageResult } from './api/variateImage.js';
export { generateVideo } from './api/generateVideo.js';
export type { GenerateVideoOptions, GenerateVideoResult } from './api/generateVideo.js';
export { generateMusic } from './api/generateMusic.js';
export type { GenerateMusicOptions, GenerateMusicResult } from './api/generateMusic.js';
export { generateSFX } from './api/generateSFX.js';
export type { GenerateSFXOptions, GenerateSFXResult } from './api/generateSFX.js';
export { analyzeVideo } from './api/analyzeVideo.js';
export type { AnalyzeVideoOptions, AnalyzeVideoResult } from './api/analyzeVideo.js';
export { detectScenes } from './api/detectScenes.js';
export type { DetectScenesOptions } from './api/detectScenes.js';
export { performOCR } from './api/performOCR.js';
export type { PerformOCROptions, OCRResult } from './api/performOCR.js';
export { generateObject, ObjectGenerationError } from './api/generateObject.js';
export type { GenerateObjectOptions, GenerateObjectResult } from './api/generateObject.js';
export { streamObject } from './api/streamObject.js';
export type { StreamObjectOptions, StreamObjectResult, DeepPartial } from './api/streamObject.js';
export { embedText } from './api/embedText.js';
export type { EmbedTextOptions, EmbedTextResult } from './api/embedText.js';
export { parseModelString, resolveProvider, resolveModelOption } from './api/model.js';
export { PROVIDER_DEFAULTS, autoDetectProvider } from './api/runtime/provider-defaults.js';
export type { ProviderDefaults } from './api/runtime/provider-defaults.js';
export type { TaskType, ModelOption } from './api/model.js';
export { adaptTools, adaptToolsToMap, mergeAdaptableTools } from './api/runtime/toolAdapter.js';
export type { AdaptableToolInput, ToolDefinitionMap } from './api/runtime/toolAdapter.js';
export {
  getDefaultAgentOSUsageLedgerPath,
  resolveAgentOSUsageLedgerPath,
  readRecordedAgentOSUsageEvents,
  recordAgentOSUsage,
  getRecordedAgentOSUsage,
  clearRecordedAgentOSUsage,
} from './api/runtime/usageLedger.js';
export type {
  AgentOSUsageLedgerOptions,
  AgentOSUsageEvent,
  AgentOSUsageRecordInput,
  AgentOSUsageAggregate,
} from './api/runtime/usageLedger.js';

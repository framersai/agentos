/**
 * Barrel exports for the Cognitive Memory System.
 *
 * @module agentos/memory
 */

// --- Core types ---
export type {
  MemoryType,
  MemoryScope,
  MemorySourceType,
  MemoryProvenance,
  EmotionalContext,
  ContentFeatures,
  MemoryTrace,
  WorkingMemorySlot,
  EncodingWeights,
  EncodingResult,
  CognitiveRetrievalOptions,
  ScoredMemoryTrace,
  PartiallyRetrievedTrace,
  CognitiveRetrievalResult,
  MemoryBudgetAllocation,
  AssembledMemoryContext,
  MemoryHealthReport,
} from './types.js';

// --- Configuration ---
export type {
  CognitiveMemoryConfig,
  CognitiveMemoryPersonaConfig,
  PADState,
  HexacoTraits,
  EncodingConfig,
  DecayConfig,
  ObserverConfig,
  ReflectorConfig,
  MemoryGraphConfig,
  ConsolidationConfig,
} from './config.js';
export {
  DEFAULT_ENCODING_CONFIG,
  DEFAULT_DECAY_CONFIG,
  DEFAULT_BUDGET_ALLOCATION,
} from './config.js';

// --- Encoding ---
export {
  computeEncodingWeights,
  computeEncodingStrength,
  computeAttentionMultiplier,
  yerksDodson,
  moodCongruenceBoost,
  isFlashbulbMemory,
  buildEmotionalContext,
} from './encoding/EncodingModel.js';
export {
  createFeatureDetector,
  KeywordFeatureDetector,
  LlmFeatureDetector,
  HybridFeatureDetector,
} from './encoding/ContentFeatureDetector.js';
export type { IContentFeatureDetector } from './encoding/ContentFeatureDetector.js';

// --- Decay ---
export {
  computeCurrentStrength,
  updateOnRetrieval,
  computeInterference,
  findPrunableTraces,
} from './decay/DecayModel.js';
export type { RetrievalUpdateResult, InterferenceResult, InterferenceVictim } from './decay/DecayModel.js';
export {
  scoreAndRankTraces,
  detectPartiallyRetrieved,
  computeRecencyBoost,
  computeEmotionalCongruence,
  DEFAULT_SCORING_WEIGHTS,
} from './decay/RetrievalPriorityScorer.js';
export type { ScoringWeights, ScoringContext, CandidateTrace } from './decay/RetrievalPriorityScorer.js';

// --- Working Memory ---
export { CognitiveWorkingMemory } from './working/CognitiveWorkingMemory.js';
export type { CognitiveWorkingMemoryConfig } from './working/CognitiveWorkingMemory.js';

// --- Store ---
export { MemoryStore } from './store/MemoryStore.js';
export type { MemoryStoreConfig } from './store/MemoryStore.js';

// --- Prompt Assembly ---
export { assembleMemoryContext } from './prompt/MemoryPromptAssembler.js';
export type { MemoryAssemblerInput } from './prompt/MemoryPromptAssembler.js';
export { formatMemoryTrace, formatMemoryTraces } from './prompt/MemoryFormatters.js';
export type { FormattingStyle } from './prompt/MemoryFormatters.js';

// --- High-level facade ---
export { AgentMemory } from './AgentMemory.js';
export type { RecallResult, RememberResult, SearchOptions } from './AgentMemory.js';

// --- Orchestrator (advanced) ---
export { CognitiveMemoryManager } from './CognitiveMemoryManager.js';
export type { ICognitiveMemoryManager } from './CognitiveMemoryManager.js';

// --- Extension ---
export { createCognitiveMemoryDescriptor } from './extension/CognitiveMemoryExtension.js';
export { createStandaloneMemoryDescriptor } from './extension/StandaloneMemoryExtension.js';
export {
  createMemoryToolDescriptors,
  createMemoryToolsPack,
} from './extension/MemoryToolsExtension.js';
export type {
  MemoryToolsExtensionOptions,
} from './extension/MemoryToolsExtension.js';
export type {
  StandaloneMemoryDescriptorOptions,
} from './extension/StandaloneMemoryExtension.js';

// --- Standalone Memory Bridges ---
export {
  buildStandaloneMemoryPersonaScopeId,
  createStandaloneMemoryLongTermRetriever,
  createStandaloneMemoryRollingSummarySink,
} from './integration/StandaloneMemoryBridge.js';
export type {
  StandaloneMemoryLongTermRetrieverOptions,
  StandaloneMemoryRollingSummarySinkOptions,
} from './integration/StandaloneMemoryBridge.js';

// --- Memory Graph (Batch 2) ---
export type {
  IMemoryGraph,
  MemoryGraphNodeMeta,
  MemoryEdge,
  MemoryEdgeType,
  SpreadingActivationConfig,
  ActivatedNode,
  MemoryCluster,
} from './graph/IMemoryGraph.js';
export { GraphologyMemoryGraph } from './graph/GraphologyMemoryGraph.js';
export { KnowledgeGraphMemoryGraph } from './graph/KnowledgeGraphMemoryGraph.js';
export { spreadActivation } from './graph/SpreadingActivation.js';
export type { SpreadingActivationInput } from './graph/SpreadingActivation.js';

// --- Observation System (Batch 2) ---
export { ObservationBuffer } from './observation/ObservationBuffer.js';
export type { BufferedMessage, ObservationBufferConfig } from './observation/ObservationBuffer.js';
export { MemoryObserver } from './observation/MemoryObserver.js';
export type { ObservationNote } from './observation/MemoryObserver.js';
export { MemoryReflector } from './observation/MemoryReflector.js';
export type { MemoryReflectionResult } from './observation/MemoryReflector.js';

// --- Prospective Memory (Batch 2) ---
export { ProspectiveMemoryManager } from './prospective/ProspectiveMemoryManager.js';
export type { ProspectiveMemoryItem, ProspectiveTriggerType } from './prospective/ProspectiveMemoryManager.js';

// --- Consolidation Pipeline (Batch 2) ---
export { ConsolidationPipeline } from './consolidation/ConsolidationPipeline.js';
export type { ConsolidationResult, ConsolidationPipelineConfig } from './consolidation/ConsolidationPipeline.js';

// --- Infinite Context Window (Batch 3) ---
export { ContextWindowManager } from './context/ContextWindowManager.js';
export type { ContextWindowManagerConfig, ContextWindowStats } from './context/ContextWindowManager.js';
export { CompactionEngine } from './context/CompactionEngine.js';
export { CompactionLog } from './context/CompactionLog.js';
export type { CompactionLogStats } from './context/CompactionLog.js';
export { RollingSummaryChain } from './context/RollingSummaryChain.js';
export { SlidingSummaryStrategy } from './context/strategies/SlidingSummaryStrategy.js';
export { HierarchicalStrategy } from './context/strategies/HierarchicalStrategy.js';
export { HybridStrategy } from './context/strategies/HybridStrategy.js';
export type {
  InfiniteContextConfig,
  CompactionStrategy,
  TransparencyLevel,
  ContextMessage,
  CompactionEntry,
  SummaryChainNode,
  CompactionInput,
  CompactionResult,
  ICompactionStrategy,
} from './context/types.js';
export { DEFAULT_INFINITE_CONTEXT_CONFIG } from './context/types.js';

// --- Persistent Markdown Working Memory ---
export { MarkdownWorkingMemory } from './working/MarkdownWorkingMemory.js';
export type { WriteResult } from './working/MarkdownWorkingMemory.js';
export { UpdateWorkingMemoryTool } from './working/UpdateWorkingMemoryTool.js';
export { ReadWorkingMemoryTool } from './working/ReadWorkingMemoryTool.js';

// --- Memory Facade (Phase 1: Ingestion + Self-Improving Graph) ---
export { Memory } from './facade/index.js';
export type { ScoredTrace } from './facade/index.js';
// Note: ConsolidationResult from the facade is aliased to MemoryConsolidationResult
// to avoid collision with the existing ConsolidationResult from ConsolidationPipeline.
export type {
  MemoryConfig,
  EmbeddingConfig,
  ExtendedConsolidationConfig,
  IngestionConfig,
  RememberOptions,
  RecallOptions,
  IngestOptions,
  IngestResult,
  ExportOptions,
  ImportOptions,
  ImportResult,
  ConsolidationResult as MemoryConsolidationResult,
  MemoryHealth,
  LoadOptions,
  LoadedDocument,
  DocumentMetadata,
  DocumentChunk,
  ExtractedImage,
  ExtractedTable,
} from './facade/index.js';

// --- Document Ingestion ---
export type { IDocumentLoader } from './ingestion/IDocumentLoader.js';
export { TextLoader } from './ingestion/TextLoader.js';
export { MarkdownLoader } from './ingestion/MarkdownLoader.js';
export { HtmlLoader } from './ingestion/HtmlLoader.js';
export { PdfLoader } from './ingestion/PdfLoader.js';
export { DocxLoader } from './ingestion/DocxLoader.js';
export { LoaderRegistry } from './ingestion/LoaderRegistry.js';
export { FolderScanner } from './ingestion/FolderScanner.js';
export { ChunkingEngine } from './ingestion/ChunkingEngine.js';
export { MultimodalAggregator } from './ingestion/MultimodalAggregator.js';
export { UrlLoader } from './ingestion/UrlLoader.js';

// --- Retrieval Feedback ---
export { RetrievalFeedbackSignal } from './feedback/index.js';
export type { RetrievalFeedback } from './feedback/index.js';

// --- Self-Improving Consolidation ---
export { ConsolidationLoop } from './consolidation/index.js';

// --- Import/Export ---
export {
  JsonExporter,
  JsonImporter,
  MarkdownExporter,
  MarkdownImporter,
  ObsidianExporter,
  ObsidianImporter,
  SqliteExporter,
  SqliteImporter,
  ChatGptImporter,
  CsvImporter,
} from './io/index.js';

// --- SQLite Storage ---
export { SqliteBrain } from './store/SqliteBrain.js';
export { SqliteKnowledgeGraph } from './store/SqliteKnowledgeGraph.js';
export { SqliteMemoryGraph } from './store/SqliteMemoryGraph.js';

// --- Agent Memory Tools ---
export {
  MemoryAddTool,
  MemoryUpdateTool,
  MemoryDeleteTool,
  MemoryMergeTool,
  MemorySearchTool,
  MemoryReflectTool,
} from './tools/index.js';

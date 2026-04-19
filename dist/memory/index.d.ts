/**
 * Barrel exports for the Cognitive Memory System.
 *
 * Organized into four tiers:
 * - **core/**: foundational types, config, encoding, decay, working memory, prompts
 * - **retrieval/**: store, graph, prospective memory, feedback
 * - **pipeline/**: consolidation, observation, context window management
 * - **io/**: ingestion, import/export, facade, tools, extensions, integration
 * - **mechanisms/**: optional cognitive mechanisms (reconsolidation, RIF, etc.)
 *
 * @module agentos/memory
 */
export type { MemoryType, MemoryScope, MemorySourceType, MemoryProvenance, EmotionalContext, ContentFeatures, MemoryTrace, WorkingMemorySlot, EncodingWeights, EncodingResult, CognitiveRetrievalOptions, ScoredMemoryTrace, PartiallyRetrievedTrace, CognitiveRetrievalResult, MemoryBudgetAllocation, AssembledMemoryContext, MemoryHealthReport, } from './core/types.js';
export type { CognitiveMemoryConfig, CognitiveMemoryPersonaConfig, PADState, HexacoTraits, EncodingConfig, DecayConfig, ObserverConfig, ReflectorConfig, MemoryGraphConfig, ConsolidationConfig, } from './core/config.js';
export { DEFAULT_ENCODING_CONFIG, DEFAULT_DECAY_CONFIG, DEFAULT_BUDGET_ALLOCATION, } from './core/config.js';
export { computeEncodingWeights, computeEncodingStrength, computeAttentionMultiplier, yerksDodson, moodCongruenceBoost, isFlashbulbMemory, buildEmotionalContext, } from './core/encoding/EncodingModel.js';
export { createFeatureDetector, KeywordFeatureDetector, LlmFeatureDetector, HybridFeatureDetector, } from './core/encoding/ContentFeatureDetector.js';
export type { IContentFeatureDetector } from './core/encoding/ContentFeatureDetector.js';
export { computeCurrentStrength, updateOnRetrieval, computeInterference, findPrunableTraces, } from './core/decay/DecayModel.js';
export type { RetrievalUpdateResult, InterferenceResult, InterferenceVictim, } from './core/decay/DecayModel.js';
export { scoreAndRankTraces, detectPartiallyRetrieved, computeRecencyBoost, computeEmotionalCongruence, DEFAULT_SCORING_WEIGHTS, } from './core/decay/RetrievalPriorityScorer.js';
export type { ScoringWeights, ScoringContext, CandidateTrace, SignalName, } from './core/decay/RetrievalPriorityScorer.js';
export { CognitiveWorkingMemory } from './core/working/CognitiveWorkingMemory.js';
export type { CognitiveWorkingMemoryConfig } from './core/working/CognitiveWorkingMemory.js';
export { assembleMemoryContext } from './core/prompt/MemoryPromptAssembler.js';
export type { MemoryAssemblerInput } from './core/prompt/MemoryPromptAssembler.js';
export { formatMemoryTrace, formatMemoryTraces } from './core/prompt/MemoryFormatters.js';
export type { FormattingStyle } from './core/prompt/MemoryFormatters.js';
export { MarkdownWorkingMemory } from './core/working/MarkdownWorkingMemory.js';
export type { WriteResult } from './core/working/MarkdownWorkingMemory.js';
export { UpdateWorkingMemoryTool } from './core/working/UpdateWorkingMemoryTool.js';
export { ReadWorkingMemoryTool } from './core/working/ReadWorkingMemoryTool.js';
export { MemoryStore } from './retrieval/store/MemoryStore.js';
export type { MemoryStoreConfig } from './retrieval/store/MemoryStore.js';
export { SqliteBrain } from './retrieval/store/SqliteBrain.js';
export { SqliteKnowledgeGraph } from './retrieval/store/SqliteKnowledgeGraph.js';
export { HnswSidecar, type HnswSidecarConfig, type HnswQueryResult } from './retrieval/store/HnswSidecar.js';
export { SqliteMemoryGraph } from './retrieval/store/SqliteMemoryGraph.js';
export type { IMemoryGraph, MemoryGraphNodeMeta, MemoryEdge, MemoryEdgeType, SpreadingActivationConfig, ActivatedNode, MemoryCluster, } from './retrieval/graph/IMemoryGraph.js';
export { GraphologyMemoryGraph } from './retrieval/graph/GraphologyMemoryGraph.js';
export { KnowledgeGraphMemoryGraph } from './retrieval/graph/KnowledgeGraphMemoryGraph.js';
export { spreadActivation } from './retrieval/graph/SpreadingActivation.js';
export type { SpreadingActivationInput } from './retrieval/graph/SpreadingActivation.js';
export { ProspectiveMemoryManager } from './retrieval/prospective/ProspectiveMemoryManager.js';
export type { ProspectiveMemoryItem, ProspectiveTriggerType, } from './retrieval/prospective/ProspectiveMemoryManager.js';
export { RetrievalFeedbackSignal } from './retrieval/feedback/index.js';
export type { RetrievalFeedback } from './retrieval/feedback/index.js';
export { ObservationBuffer } from './pipeline/observation/ObservationBuffer.js';
export type { BufferedMessage, ObservationBufferConfig } from './pipeline/observation/ObservationBuffer.js';
export { MemoryObserver } from './pipeline/observation/MemoryObserver.js';
export type { ObservationNote } from './pipeline/observation/MemoryObserver.js';
export { MemoryReflector } from './pipeline/observation/MemoryReflector.js';
export type { MemoryReflectionResult } from './pipeline/observation/MemoryReflector.js';
export { ObservationCompressor } from './pipeline/observation/ObservationCompressor.js';
export type { CompressedObservation, CompressionPriority, } from './pipeline/observation/ObservationCompressor.js';
export { ObservationReflector } from './pipeline/observation/ObservationReflector.js';
export type { Reflection, ReflectionPatternType } from './pipeline/observation/ObservationReflector.js';
export { relativeTimeLabel } from './pipeline/observation/temporal.js';
export type { TemporalMetadata } from './pipeline/observation/temporal.js';
export { ConsolidationPipeline } from './pipeline/consolidation/ConsolidationPipeline.js';
export type { ConsolidationResult, ConsolidationPipelineConfig, } from './pipeline/consolidation/ConsolidationPipeline.js';
export { ConsolidationLoop } from './pipeline/consolidation/index.js';
export { ContextWindowManager } from './pipeline/context/ContextWindowManager.js';
export type { ContextWindowManagerConfig, ContextWindowStats, } from './pipeline/context/ContextWindowManager.js';
export { CompactionEngine } from './pipeline/context/CompactionEngine.js';
export { CompactionLog } from './pipeline/context/CompactionLog.js';
export type { CompactionLogStats } from './pipeline/context/CompactionLog.js';
export { RollingSummaryChain } from './pipeline/context/RollingSummaryChain.js';
export { SlidingSummaryStrategy } from './pipeline/context/strategies/SlidingSummaryStrategy.js';
export { HierarchicalStrategy } from './pipeline/context/strategies/HierarchicalStrategy.js';
export { HybridStrategy } from './pipeline/context/strategies/HybridStrategy.js';
export type { InfiniteContextConfig, CompactionStrategy, TransparencyLevel, ContextMessage, CompactionEntry, SummaryChainNode, CompactionInput, CompactionResult, ICompactionStrategy, } from './pipeline/context/types.js';
export { DEFAULT_INFINITE_CONTEXT_CONFIG } from './pipeline/context/types.js';
export { AgentMemory } from './AgentMemory.js';
export type { RecallResult, RememberResult, SearchOptions } from './AgentMemory.js';
export { Memory } from './io/facade/index.js';
export type { ScoredTrace } from './io/facade/index.js';
export { createOcrPdfLoader } from './io/ingestion/OcrPdfLoader.js';
export { createDoclingLoader } from './io/ingestion/DoclingLoader.js';
export type { MemoryConfig, EmbeddingConfig, ExtendedConsolidationConfig, IngestionConfig, RememberOptions, RecallOptions, IngestOptions, IngestResult, ExportOptions, ImportOptions, ImportResult, ConsolidationResult as MemoryConsolidationResult, MemoryHealth, LoadOptions, LoadedDocument, DocumentMetadata, DocumentChunk, ExtractedImage, ExtractedTable, } from './io/facade/index.js';
export type { IDocumentLoader } from './io/ingestion/IDocumentLoader.js';
export { TextLoader } from './io/ingestion/TextLoader.js';
export { MarkdownLoader } from './io/ingestion/MarkdownLoader.js';
export { HtmlLoader } from './io/ingestion/HtmlLoader.js';
export { PdfLoader } from './io/ingestion/PdfLoader.js';
export { DocxLoader } from './io/ingestion/DocxLoader.js';
export { LoaderRegistry } from './io/ingestion/LoaderRegistry.js';
export { FolderScanner } from './io/ingestion/FolderScanner.js';
export { ChunkingEngine } from './io/ingestion/ChunkingEngine.js';
export { MultimodalAggregator } from './io/ingestion/MultimodalAggregator.js';
export { UrlLoader } from './io/ingestion/UrlLoader.js';
export { MemoryAddTool, MemoryUpdateTool, MemoryDeleteTool, MemoryMergeTool, MemorySearchTool, MemoryReflectTool, } from './io/tools/index.js';
export { createCognitiveMemoryDescriptor } from './io/extension/CognitiveMemoryExtension.js';
export { createStandaloneMemoryDescriptor } from './io/extension/StandaloneMemoryExtension.js';
export { createMemoryToolDescriptors, createMemoryToolsPack, } from './io/extension/MemoryToolsExtension.js';
export type { MemoryToolsExtensionOptions } from './io/extension/MemoryToolsExtension.js';
export type { StandaloneMemoryDescriptorOptions } from './io/extension/StandaloneMemoryExtension.js';
export { buildStandaloneMemoryPersonaScopeId, createStandaloneMemoryLongTermRetriever, createStandaloneMemoryRollingSummarySink, } from './io/integration/StandaloneMemoryBridge.js';
export type { StandaloneMemoryLongTermRetrieverOptions, StandaloneMemoryRollingSummarySinkOptions, } from './io/integration/StandaloneMemoryBridge.js';
export { JsonExporter, JsonImporter, MarkdownExporter, MarkdownImporter, ObsidianExporter, ObsidianImporter, ChatGptImporter, CsvImporter, } from './io/index.js';
export { CognitiveMemoryManager } from './CognitiveMemoryManager.js';
export type { ICognitiveMemoryManager } from './CognitiveMemoryManager.js';
export { CognitiveMechanismsEngine, DEFAULT_MECHANISMS_CONFIG } from './mechanisms/index.js';
export { resolveConfig as resolveMechanismsConfig } from './mechanisms/index.js';
export type { CognitiveMechanismsConfig, ResolvedMechanismsConfig, MetacognitiveSignal, MechanismMetadata, DriftEvent, } from './mechanisms/index.js';
export { analyzePersonaDrift, DEFAULT_PERSONA_DRIFT_CONFIG, } from './mechanisms/PersonaDriftMechanism.js';
export type { PersonaDriftConfig, PersonalityDriftProposal, RelationshipDriftInput, HEXACOTrait, } from './mechanisms/PersonaDriftMechanism.js';
//# sourceMappingURL=index.d.ts.map
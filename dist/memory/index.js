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
export { DEFAULT_ENCODING_CONFIG, DEFAULT_DECAY_CONFIG, DEFAULT_BUDGET_ALLOCATION, } from './core/config.js';
// --- Encoding ---
export { computeEncodingWeights, computeEncodingStrength, computeAttentionMultiplier, yerksDodson, moodCongruenceBoost, isFlashbulbMemory, buildEmotionalContext, } from './core/encoding/EncodingModel.js';
export { createFeatureDetector, KeywordFeatureDetector, LlmFeatureDetector, HybridFeatureDetector, } from './core/encoding/ContentFeatureDetector.js';
// --- Decay ---
export { computeCurrentStrength, updateOnRetrieval, computeInterference, findPrunableTraces, } from './core/decay/DecayModel.js';
export { scoreAndRankTraces, detectPartiallyRetrieved, computeRecencyBoost, computeEmotionalCongruence, DEFAULT_SCORING_WEIGHTS, } from './core/decay/RetrievalPriorityScorer.js';
// --- Working Memory ---
export { CognitiveWorkingMemory } from './core/working/CognitiveWorkingMemory.js';
// --- Prompt Assembly ---
export { assembleMemoryContext } from './core/prompt/MemoryPromptAssembler.js';
export { formatMemoryTrace, formatMemoryTraces } from './core/prompt/MemoryFormatters.js';
// --- Persistent Markdown Working Memory ---
export { MarkdownWorkingMemory } from './core/working/MarkdownWorkingMemory.js';
export { UpdateWorkingMemoryTool } from './core/working/UpdateWorkingMemoryTool.js';
export { ReadWorkingMemoryTool } from './core/working/ReadWorkingMemoryTool.js';
// ---------------------------------------------------------------------------
// Retrieval Tier — store, graph, prospective memory, feedback
// ---------------------------------------------------------------------------
// --- Store ---
export { MemoryStore } from './retrieval/store/MemoryStore.js';
// --- SQLite Storage ---
export { SqliteBrain } from './retrieval/store/SqliteBrain.js';
export { SqliteKnowledgeGraph } from './retrieval/store/SqliteKnowledgeGraph.js';
export { HnswSidecar } from './retrieval/store/HnswSidecar.js';
export { SqliteMemoryGraph } from './retrieval/store/SqliteMemoryGraph.js';
export { GraphologyMemoryGraph } from './retrieval/graph/GraphologyMemoryGraph.js';
export { KnowledgeGraphMemoryGraph } from './retrieval/graph/KnowledgeGraphMemoryGraph.js';
export { spreadActivation } from './retrieval/graph/SpreadingActivation.js';
// --- Prospective Memory ---
export { ProspectiveMemoryManager } from './retrieval/prospective/ProspectiveMemoryManager.js';
// --- Retrieval Feedback ---
export { RetrievalFeedbackSignal } from './retrieval/feedback/index.js';
// ---------------------------------------------------------------------------
// Pipeline Tier — consolidation, observation, context
// ---------------------------------------------------------------------------
// --- Observation System ---
export { ObservationBuffer } from './pipeline/observation/ObservationBuffer.js';
export { MemoryObserver } from './pipeline/observation/MemoryObserver.js';
export { MemoryReflector } from './pipeline/observation/MemoryReflector.js';
// --- Observation Compression & Reflection ---
export { ObservationCompressor } from './pipeline/observation/ObservationCompressor.js';
export { ObservationReflector } from './pipeline/observation/ObservationReflector.js';
// --- Temporal Reasoning ---
export { relativeTimeLabel } from './pipeline/observation/temporal.js';
// --- Consolidation Pipeline ---
export { ConsolidationPipeline } from './pipeline/consolidation/ConsolidationPipeline.js';
// --- Self-Improving Consolidation ---
export { ConsolidationLoop } from './pipeline/consolidation/index.js';
// --- Infinite Context Window ---
export { ContextWindowManager } from './pipeline/context/ContextWindowManager.js';
export { CompactionEngine } from './pipeline/context/CompactionEngine.js';
export { CompactionLog } from './pipeline/context/CompactionLog.js';
export { RollingSummaryChain } from './pipeline/context/RollingSummaryChain.js';
export { SlidingSummaryStrategy } from './pipeline/context/strategies/SlidingSummaryStrategy.js';
export { HierarchicalStrategy } from './pipeline/context/strategies/HierarchicalStrategy.js';
export { HybridStrategy } from './pipeline/context/strategies/HybridStrategy.js';
export { DEFAULT_INFINITE_CONTEXT_CONFIG } from './pipeline/context/types.js';
// ---------------------------------------------------------------------------
// IO Tier — ingestion, import/export, facade, tools, extensions, integration
// ---------------------------------------------------------------------------
// --- High-level facade ---
export { AgentMemory } from './AgentMemory.js';
// --- Memory Facade (Phase 1: Ingestion + Self-Improving Graph) ---
export { Memory } from './io/facade/index.js';
export { createOcrPdfLoader } from './io/ingestion/OcrPdfLoader.js';
export { createDoclingLoader } from './io/ingestion/DoclingLoader.js';
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
// --- Agent Memory Tools ---
export { MemoryAddTool, MemoryUpdateTool, MemoryDeleteTool, MemoryMergeTool, MemorySearchTool, MemoryReflectTool, } from './io/tools/index.js';
// --- Extension ---
export { createCognitiveMemoryDescriptor } from './io/extension/CognitiveMemoryExtension.js';
export { createStandaloneMemoryDescriptor } from './io/extension/StandaloneMemoryExtension.js';
export { createMemoryToolDescriptors, createMemoryToolsPack, } from './io/extension/MemoryToolsExtension.js';
// --- Standalone Memory Bridges ---
export { buildStandaloneMemoryPersonaScopeId, createStandaloneMemoryLongTermRetriever, createStandaloneMemoryRollingSummarySink, } from './io/integration/StandaloneMemoryBridge.js';
// --- Import/Export ---
export { JsonExporter, JsonImporter, MarkdownExporter, MarkdownImporter, ObsidianExporter, ObsidianImporter, 
// SqliteExporter and SqliteImporter omitted — require 'better-sqlite3' native module.
// Import directly: await import('./io/SqliteImporter.js')
ChatGptImporter, CsvImporter, } from './io/index.js';
// ---------------------------------------------------------------------------
// Orchestrator (root level)
// ---------------------------------------------------------------------------
export { CognitiveMemoryManager } from './CognitiveMemoryManager.js';
// ---------------------------------------------------------------------------
// Cognitive Mechanisms (optional)
// ---------------------------------------------------------------------------
export { CognitiveMechanismsEngine, DEFAULT_MECHANISMS_CONFIG } from './mechanisms/index.js';
export { resolveConfig as resolveMechanismsConfig } from './mechanisms/index.js';
//# sourceMappingURL=index.js.map
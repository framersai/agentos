/**
 * AgentOS IngestRouter Module
 *
 * Input-stage LLM-as-judge orchestrator for memory ingest. Sibling of
 * {@link MemoryRouter} (recall-stage) and {@link QueryRouter} (Q&A-stage).
 * IngestRouter is the first stage in the agentos Cognitive Pipeline
 * pattern; output-stage guardrails remain a separate downstream concern.
 *
 * Where MemoryRouter picks the recall architecture for a query,
 * IngestRouter picks the storage architecture for incoming content. The
 * choice affects what's STORED, which downstream MemoryRouter then queries.
 *
 * **Architecture Overview:**
 * ```
 *   Content stream
 *         │
 *         ▼
 *  ┌────────────────────────────────────────────────┐
 *  │              IngestRouter                      │
 *  │  classify content → pick strategy → store      │
 *  └────────────────────────────────────────────────┘
 *         │             │              │
 *         ▼             ▼              ▼
 *   raw-chunks      summarized    observational
 *   fact-graph      hybrid        skip
 * ```
 *
 * @module @framers/agentos/ingest-router
 */

export type {
  IngestContentKind,
  IngestStrategyId,
  IngestRouterPreset,
  IngestRoutingTable,
} from './routing-tables.js';
export { INGEST_CONTENT_KINDS } from './routing-tables.js';

export type { IngestStrategyCostPoint } from './costs.js';

export type {
  IngestBudgetMode,
  IngestRouterConfig,
  IngestRoutingDecision,
} from './select-strategy.js';

export type {
  IIngestClassifier,
  IIngestClassifierLLM,
  IngestClassifierLLMRequest,
  IngestClassifierLLMResponse,
  IngestClassifierClassifyOptions,
  IngestClassifierResult,
  LLMIngestClassifierOptions,
} from './classifier.js';

export type {
  IIngestDispatcher,
  IngestDispatchArgs,
  IngestDispatchResult,
  IngestStrategyExecutor,
  IngestStrategyRegistry,
} from './dispatcher.js';

export type {
  IngestBudgetPolicy,
  IngestRouterOptions,
  IngestRouterDecideOptions,
  IngestRouterDecision,
  IngestRouterDispatchedResult,
} from './IngestRouter.js';

export {
  RAW_CHUNKS_TABLE,
  SUMMARIZED_TABLE,
  OBSERVATIONAL_TABLE,
  HYBRID_TABLE,
  PRESET_INGEST_TABLES,
} from './routing-tables.js';

export {
  RAW_CHUNKS_COST,
  SUMMARIZED_COST,
  OBSERVATIONAL_COST,
  FACT_GRAPH_COST,
  HYBRID_COST,
  SKIP_COST,
  DEFAULT_INGEST_COSTS,
} from './costs.js';

export {
  selectIngestStrategy,
  IngestRouterUnknownKindError,
  IngestRouterBudgetExceededError,
} from './select-strategy.js';

export {
  INGEST_CLASSIFIER_SYSTEM_PROMPT,
  INGEST_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT,
  SAFE_INGEST_FALLBACK_KIND,
  LLMIngestClassifier,
  normalizeIngestClassifierOutput,
  parseIngestClassifierOutput,
} from './classifier.js';

export {
  FunctionIngestDispatcher,
  UnsupportedIngestStrategyError,
} from './dispatcher.js';

export {
  IngestRouter,
  IngestRouterDispatcherMissingError,
} from './IngestRouter.js';

// --- Reference executors ---
// Reference executors ship in agentos core so the IngestRouter strategy
// IDs work out of the box. See ./executors/ for the source.
//
// SummarizedIngestExecutor wraps the existing SessionSummarizer from
// `@framers/agentos/memory` so the production summarization primitive is
// the single source of truth across the bench and the IngestRouter
// dispatcher path.
//
// Strategy ID coverage today: summarized (Stage L), raw-chunks, skip.
// Observational + fact-graph + hybrid executors land in later phases;
// consumers can register their own closures via FunctionIngestDispatcher
// in the meantime.
export {
  SummarizedIngestExecutor,
  RawChunksIngestExecutor,
  SkipIngestExecutor,
  EntityExtractor,
  EntityLinkingIngestExecutor,
  createSummarizedIngestExecutor,
  createRawChunksIngestExecutor,
  createSkipIngestExecutor,
  createEntityLinkingIngestExecutor,
} from './executors/index.js';
export type {
  IngestOutcome,
  IngestPayload,
  RawChunksOutcome,
  EntityLinkingOutcome,
  EntityKind,
  ExtractedEntity,
  EntityExtractionResult,
  EntityLinkingOptions,
} from './executors/index.js';

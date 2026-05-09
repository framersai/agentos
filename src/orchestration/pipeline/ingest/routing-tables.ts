/**
 * @file routing-tables.ts
 * @description Preset routing tables for {@link IngestRouter}.
 *
 * IngestRouter is the input-stage sibling of MemoryRouter. Where MemoryRouter
 * picks the recall architecture for a query, IngestRouter picks the storage
 * architecture for incoming content. The choice affects what's STORED, which
 * downstream MemoryRouter then queries.
 *
 * Four shipping presets express different cost-vs-recall priorities:
 *
 * - {@link RAW_CHUNKS_TABLE}: stores everything as raw chunks. Cheapest at
 *   ingest time. Pushes all complexity to retrieval. Default for cost-
 *   sensitive workloads.
 * - {@link SUMMARIZED_TABLE}: applies session/article summarization on long
 *   content. Anthropic-style "contextual retrieval" — every chunk gets a
 *   dense session-summary prefix before embedding.
 * - {@link OBSERVATIONAL_TABLE}: extracts observation logs (Mastra-style)
 *   from long conversational content. Most expensive at ingest, best for
 *   multi-session synthesis recall.
 * - {@link HYBRID_TABLE}: applies multiple ingest strategies in parallel
 *   for long content (raw chunks + summary + observations). Highest cost,
 *   highest recall flexibility — every retrieval strategy has its substrate.
 *
 * @module @framers/agentos/ingest-router/routing-tables
 */

// ============================================================================
// Types
// ============================================================================

/**
 * The six content kinds the LLM-as-judge ingest classifier can emit.
 * Coarse taxonomy chosen to map cleanly onto distinct ingest strategies —
 * extending the taxonomy means extending the routing tables consistently.
 */
export const INGEST_CONTENT_KINDS = [
  'short-conversation',
  'long-conversation',
  'long-article',
  'code',
  'structured-data',
  'multimodal',
] as const;

export type IngestContentKind = (typeof INGEST_CONTENT_KINDS)[number];

/**
 * The six storage strategies an IngestDispatcher can execute.
 *
 * - `raw-chunks`: standard turn-by-turn (or semantic) chunking, no LLM at
 *   ingest. The Memory.remember() default.
 * - `summarized`: every chunk prepended with a dense session/document
 *   summary before embedding (Anthropic Sep 2024 "contextual retrieval").
 *   One LLM summarize call per session/document at ingest time.
 * - `observational`: extract a structured observation log from the content
 *   (Mastra Observational Memory pattern). Multiple LLM extraction calls
 *   per session at ingest time. Recalled traces are observations rather
 *   than raw turns.
 * - `fact-graph`: extract atomic fact triples from the content (Mem0-style).
 *   LLM-triple-extraction at ingest. Recall queries the fact graph.
 * - `hybrid`: apply multiple strategies in parallel (e.g., raw-chunks +
 *   summarized + observational). Most expensive at ingest. Highest recall
 *   flexibility.
 * - `skip`: do not ingest the content. For low-value session noise that
 *   wastes recall slots and inflates retrieval cost.
 */
export type IngestStrategyId =
  | 'raw-chunks'
  | 'summarized'
  | 'observational'
  | 'fact-graph'
  | 'hybrid'
  | 'skip';

/**
 * The shipping preset names. Each names a cost-vs-recall point.
 */
export type IngestRouterPreset =
  | 'raw-chunks'
  | 'summarized'
  | 'observational'
  | 'hybrid';

/**
 * A routing table maps every {@link IngestContentKind} to its preferred
 * {@link IngestStrategyId}. Tables are frozen so consumers cannot mutate
 * the routing surface from outside the module.
 */
export interface IngestRoutingTable {
  readonly preset: IngestRouterPreset;
  readonly defaultMapping: Readonly<
    Record<IngestContentKind, IngestStrategyId>
  >;
}

// ============================================================================
// Preset tables
// ============================================================================

/**
 * Preset: raw-chunks (default for cost-sensitive workloads).
 *
 * Stores everything as raw chunks regardless of content kind. Zero LLM
 * cost at ingest time. All complexity is pushed to retrieval where the
 * MemoryRouter can compose hybrid retrieval over the raw chunks.
 *
 * Recommended when: ingest volume is high, retrieval-side compute is
 * cheap, and you trust the retrieval stage to do the heavy lifting.
 */
export const RAW_CHUNKS_TABLE: IngestRoutingTable = Object.freeze({
  preset: 'raw-chunks' as const,
  defaultMapping: Object.freeze({
    'short-conversation': 'raw-chunks',
    'long-conversation': 'raw-chunks',
    'long-article': 'raw-chunks',
    code: 'raw-chunks',
    'structured-data': 'raw-chunks',
    multimodal: 'raw-chunks',
  }),
}) as IngestRoutingTable;

/**
 * Preset: summarized (contextual retrieval for long content).
 *
 * Long content (long-conversation, long-article) gets a session/document
 * summary prepended to every chunk before embedding. Short content stays
 * as raw chunks. Code and structured data are summarized for the
 * cross-file context. Multimodal stays raw — embedding modality is
 * orthogonal to summarization.
 *
 * Recommended when: documents and conversations have meaningful global
 * context that improves retrieval recall.
 */
export const SUMMARIZED_TABLE: IngestRoutingTable = Object.freeze({
  preset: 'summarized' as const,
  defaultMapping: Object.freeze({
    'short-conversation': 'raw-chunks',
    'long-conversation': 'summarized',
    'long-article': 'summarized',
    code: 'summarized',
    'structured-data': 'raw-chunks',
    multimodal: 'raw-chunks',
  }),
}) as IngestRoutingTable;

/**
 * Preset: observational (Mastra-style for multi-session synthesis).
 *
 * Long conversational content (long-conversation) becomes a structured
 * observation log via LLM extraction at ingest. Long articles get the
 * cheaper summarized treatment. Short content, code, structured, and
 * multimodal stay raw.
 *
 * Recommended when: workload is conversational and includes many
 * multi-session synthesis questions ("what have we agreed to so far",
 * "across our chats, what topics recur").
 */
export const OBSERVATIONAL_TABLE: IngestRoutingTable = Object.freeze({
  preset: 'observational' as const,
  defaultMapping: Object.freeze({
    'short-conversation': 'raw-chunks',
    'long-conversation': 'observational',
    'long-article': 'summarized',
    code: 'raw-chunks',
    'structured-data': 'raw-chunks',
    multimodal: 'raw-chunks',
  }),
}) as IngestRoutingTable;

/**
 * Preset: hybrid (maximum-recall workloads).
 *
 * Applies multiple ingest strategies in parallel for long content. Every
 * downstream retrieval architecture has its substrate (raw chunks for
 * canonical hybrid, summary prefix for contextual retrieval, observation
 * log for OM-style synthesis). Highest cost at ingest; highest flexibility
 * at retrieval.
 *
 * Recommended when: cost-per-ingest is acceptable AND retrieval workload
 * is heterogeneous enough that no single strategy dominates.
 */
export const HYBRID_TABLE: IngestRoutingTable = Object.freeze({
  preset: 'hybrid' as const,
  defaultMapping: Object.freeze({
    'short-conversation': 'raw-chunks',
    'long-conversation': 'hybrid',
    'long-article': 'hybrid',
    code: 'summarized',
    'structured-data': 'raw-chunks',
    multimodal: 'raw-chunks',
  }),
}) as IngestRoutingTable;

/**
 * Preset registry keyed by name.
 */
export const PRESET_INGEST_TABLES: Readonly<
  Record<IngestRouterPreset, IngestRoutingTable>
> = Object.freeze({
  'raw-chunks': RAW_CHUNKS_TABLE,
  summarized: SUMMARIZED_TABLE,
  observational: OBSERVATIONAL_TABLE,
  hybrid: HYBRID_TABLE,
});

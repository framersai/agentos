/**
 * @file types.ts
 * @description Public types for the IngestRouter reference executors.
 *
 * Stage L (Anthropic Contextual Retrieval): one LLM summarize call per
 * session, summary prepended to every chunk in that session before
 * embedding. See the verbatim recipe at:
 * platform.claude.com/cookbook/capabilities-contextual-embeddings-guide.
 *
 * Stage I (Mem0 v3 entity-linking) types are added in a separate task
 * but live in this same file so consumers of `@framers/agentos/ingest-router`
 * find every executor type in one place.
 *
 * @module @framers/agentos/ingest-router/executors/types
 */

/**
 * Single conversational session passed to the summarizer.
 */
export interface SessionContent {
  /** Stable session identifier; used as the cache key. */
  sessionId: string;
  /** Full session text (turn list, document body, etc.). */
  text: string;
}

/**
 * Provider-agnostic LLM adapter for the summarize call. Implementations
 * wrap an OpenAI / Anthropic / local-model client. Single-OpenAI-key
 * reproducibility means the shipping configuration uses gpt-5-mini.
 */
export interface SummarizerLLM {
  invoke(req: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<{
    text: string;
    tokensIn: number;
    tokensOut: number;
    model: string;
  }>;
}

/**
 * Constructor options for {@link SummarizedIngestExecutor}.
 */
export interface SummarizedIngestOptions {
  /** LLM adapter used for the per-session summarize call. */
  llm: SummarizerLLM;
  /**
   * Override the default 100-token summary cap. Anthropic's recipe
   * targets 50-100 tokens of context per chunk; override to tune the
   * cost / context-density trade-off.
   */
  maxSummaryTokens?: number;
  /**
   * Override the default cache key (sessionId). Useful when sessions
   * share semantic identity across rebrandings (e.g., user renames).
   */
  cacheKey?: (session: SessionContent) => string;
}

/**
 * One emitted trace from the summarized executor. Each chunk in a
 * session becomes one trace; all traces in the session share the same
 * summary prefix.
 */
export interface SummarizedTrace {
  sessionId: string;
  chunkIndex: number;
  /** Text passed to the embedder: `${summary}\n\n${rawText}`. */
  embedText: string;
  /** Original chunk content, before summary prepend. */
  rawText: string;
  /** Per-session summary, shared across every chunk in the session. */
  summary: string;
}

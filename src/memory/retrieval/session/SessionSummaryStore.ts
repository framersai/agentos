/**
 * @file SessionSummaryStore.ts
 * @description Vector store for session-level summaries, used by
 * {@link SessionRetriever} to select top-K relevant sessions at
 * retrieval time before drilling into chunk-level results.
 *
 * ## What this does
 *
 * Maintains a per-scope vector collection
 * `<collectionPrefix>_<scope>_<scopeId>` (default prefix
 * `cogmem_sessions`) with one vector per unique session. Each vector
 * is the embedding of that session's {@link SessionSummarizer}
 * output: a 50-100 token dense fact-laden summary.
 *
 * ## Why a dedicated collection
 *
 * Session summaries are a structurally different retrieval target
 * than individual memory traces: there's one per conversation thread,
 * they live longer, and they want to be searched in their own metric
 * space without dilution from per-chunk vectors. A dedicated
 * collection also lets {@link SessionRetriever} do Stage 1 session
 * selection with a single cheap vector search, independent of the
 * chunk-level trace store.
 *
 * ## Relation to Anthropic contextual retrieval
 *
 * `SessionSummarizer` implements the Anthropic Sep-2024
 * contextual-retrieval pattern at session granularity: it prepends
 * a summary to every chunk before embedding. This store is the
 * retrieval-time counterpart. It lets callers search the summaries
 * directly rather than relying on the prepended-summary chunks to
 * surface via their own query embeddings. Together they form the
 * `SessionRetriever` two-stage flow documented in the Step 2 design
 * spec.
 *
 * @module agentos/memory/retrieval/session/SessionSummaryStore
 */

import type {
  IVectorStore,
  VectorDocument,
} from '../../../core/vector-store/IVectorStore.js';
import type { IEmbeddingManager } from '../../../core/embeddings/IEmbeddingManager.js';
import type { MemoryScope } from '../../core/types.js';

/**
 * Options for constructing a {@link SessionSummaryStore}.
 */
export interface SessionSummaryStoreOptions {
  /** Vector store to use for the summary collection. */
  vectorStore: IVectorStore;
  /** Embedding manager shared with the rest of the memory stack (reuse for cache hits). */
  embeddingManager: IEmbeddingManager;
  /**
   * Collection-name prefix. Final collection is
   * `<prefix>_<scope>_<scopeId>`.
   * @default 'cogmem_sessions'
   */
  collectionPrefix?: string;
}

/**
 * Input for {@link SessionSummaryStore.indexSession}.
 */
export interface IndexSessionInput {
  scope: MemoryScope;
  scopeId: string;
  sessionId: string;
  /** The summary text produced by `SessionSummarizer`. Must be non-empty. */
  summary: string;
  /** Optional ISO date for the session. Stored for future temporal filtering. */
  sessionDate?: string;
}

/**
 * One row from {@link SessionSummaryStore.querySessions}.
 */
export interface QueriedSession {
  sessionId: string;
  /** Similarity in the vector store's configured metric (cosine by default, range [-1, 1]). */
  similarityScore: number;
}

/**
 * Dedicated vector store wrapper for session-level summaries.
 *
 * @example
 * ```ts
 * const store = new SessionSummaryStore({ vectorStore, embeddingManager });
 * await store.indexSession({
 *   scope: 'user', scopeId: 'u42', sessionId: 's-7',
 *   summary: 'User discussed adopting a rescue dog from Portland shelter...',
 * });
 * const hits = await store.querySessions('rescue dog adoption', {
 *   scope: 'user', scopeId: 'u42', topK: 5,
 * });
 * ```
 */
export class SessionSummaryStore {
  private readonly vectorStore: IVectorStore;
  private readonly embeddingManager: IEmbeddingManager;
  private readonly collectionPrefix: string;

  constructor(opts: SessionSummaryStoreOptions) {
    this.vectorStore = opts.vectorStore;
    this.embeddingManager = opts.embeddingManager;
    this.collectionPrefix = opts.collectionPrefix ?? 'cogmem_sessions';
  }

  /**
   * Embed the summary and upsert into the scope-specific collection.
   * Upsert is idempotent: re-indexing the same `sessionId` replaces
   * the prior vector rather than appending a duplicate.
   */
  async indexSession(input: IndexSessionInput): Promise<void> {
    if (!input.summary || input.summary.trim().length === 0) return;
    const collection = this.collectionName(input.scope, input.scopeId);
    const { embeddings } = await this.embeddingManager.generateEmbeddings({
      texts: input.summary,
    });
    const embedding = embeddings[0];
    await this.ensureCollection(collection, embedding.length);
    const doc: VectorDocument = {
      id: input.sessionId,
      textContent: input.summary,
      embedding,
      metadata: {
        sessionId: input.sessionId,
        scopeId: input.scopeId,
        createdAt: Date.now(),
        ...(input.sessionDate ? { sessionDate: input.sessionDate } : {}),
      },
    };
    await this.vectorStore.upsert(collection, [doc]);
  }

  /**
   * Embed the query and return the top-K sessions for the given
   * scope, ordered by descending similarity. Returns `[]` when the
   * collection does not yet exist (cold scope).
   */
  async querySessions(
    query: string,
    options: { scope: MemoryScope; scopeId: string; topK: number },
  ): Promise<QueriedSession[]> {
    const collection = this.collectionName(options.scope, options.scopeId);
    const exists = this.vectorStore.collectionExists
      ? await this.vectorStore.collectionExists(collection)
      : true;
    if (!exists) return [];
    const { embeddings } = await this.embeddingManager.generateEmbeddings({ texts: query });
    const queryEmbedding = embeddings[0];
    try {
      const results = await this.vectorStore.query(collection, queryEmbedding, {
        topK: options.topK,
        includeMetadata: true,
      });
      return results.documents.map((d) => ({
        sessionId: (d.metadata?.sessionId as string | undefined) ?? d.id,
        similarityScore: d.similarityScore ?? 0,
      }));
    } catch {
      // Collection may have been dropped between the existence check
      // and the query. Degrade to empty rather than throwing.
      return [];
    }
  }

  /** Compose the per-scope collection name. */
  private collectionName(scope: MemoryScope, scopeId: string): string {
    return `${this.collectionPrefix}_${scope}_${scopeId}`;
  }

  /**
   * Lazily create the collection with the embedding dimension from
   * the first indexed vector. Idempotent on the `InMemoryVectorStore`
   * implementation; other providers' `createCollection` variants
   * honour `overwriteIfExists: false`.
   */
  private async ensureCollection(collection: string, dim: number): Promise<void> {
    try {
      const exists = this.vectorStore.collectionExists
        ? await this.vectorStore.collectionExists(collection)
        : true;
      if (!exists) {
        await this.vectorStore.createCollection?.(collection, dim, {
          overwriteIfExists: false,
        });
      }
    } catch {
      // Some providers auto-create on first upsert — swallow here.
    }
  }
}

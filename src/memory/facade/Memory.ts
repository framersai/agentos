/**
 * @fileoverview Memory facade -- unified public API for the complete memory system.
 *
 * The `Memory` class wires together every subsystem built in Tasks 1-12:
 * - SqliteBrain (unified SQLite connection with WAL, full schema)
 * - SqliteKnowledgeGraph (IKnowledgeGraph backed by SQLite)
 * - SqliteMemoryGraph (IMemoryGraph with spreading activation)
 * - LoaderRegistry (document loaders: text, md, html, pdf, docx)
 * - FolderScanner (recursive directory scanning)
 * - ChunkingEngine (4 chunking strategies)
 * - RetrievalFeedbackSignal (used/ignored detection)
 * - ConsolidationLoop (6-step self-improvement)
 * - I/O exporters and importers (JSON, Markdown, Obsidian, SQLite, ChatGPT)
 *
 * Consumers only need to import this single class to interact with the entire
 * memory subsystem.
 *
 * @module memory/facade/Memory
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { MemoryTrace } from '../types.js';
import type { ITool } from '../../core/tools/ITool.js';
import type {
  MemoryConfig,
  RememberOptions,
  RecallOptions,
  IngestOptions,
  IngestResult,
  ExportOptions,
  ImportOptions,
  ImportResult,
  ConsolidationResult,
  MemoryHealth,
  LoadedDocument,
} from './types.js';
import type {
  IKnowledgeGraph,
  KnowledgeEntity,
  KnowledgeRelation,
} from '../../core/knowledge/IKnowledgeGraph.js';

import { SqliteBrain } from '../store/SqliteBrain.js';
import {
  buildNaturalLanguageFtsQuery,
  buildInitialTraceMetadata,
  parseTraceMetadata,
  readPersistedDecayState,
  withPersistedDecayState,
} from '../store/tracePersistence.js';
import { SqliteKnowledgeGraph } from '../store/SqliteKnowledgeGraph.js';
import { SqliteMemoryGraph } from '../store/SqliteMemoryGraph.js';
import { LoaderRegistry } from '../ingestion/LoaderRegistry.js';
import { FolderScanner } from '../ingestion/FolderScanner.js';
import { ChunkingEngine } from '../ingestion/ChunkingEngine.js';
import { UrlLoader } from '../ingestion/UrlLoader.js';
import { RetrievalFeedbackSignal } from '../feedback/RetrievalFeedbackSignal.js';
import { ConsolidationLoop } from '../consolidation/ConsolidationLoop.js';
import { penalizeUnused, updateOnRetrieval } from '../decay/DecayModel.js';
import {
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
} from '../io/index.js';
import {
  MemoryAddTool,
  MemoryUpdateTool,
  MemoryDeleteTool,
  MemoryMergeTool,
  MemorySearchTool,
  MemoryReflectTool,
} from '../tools/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A memory trace paired with its retrieval relevance score.
 *
 * Returned by {@link Memory.recall} as a ranked list of matches.
 */
export interface ScoredTrace {
  /** The full memory trace envelope. */
  trace: MemoryTrace;
  /** Composite relevance score; higher is better. */
  score: number;
}

// ---------------------------------------------------------------------------
// Internal row types (matched to SqliteBrain DDL)
// ---------------------------------------------------------------------------

/** Raw row shape from the `memory_traces` table. */
interface TraceRow {
  id: string;
  type: string;
  scope: string;
  content: string;
  embedding: Buffer | null;
  strength: number;
  created_at: number;
  last_accessed: number | null;
  retrieval_count: number;
  tags: string;
  emotions: string;
  metadata: string;
  deleted: number;
}

/** Shape returned by FTS5 ranked join query. */
interface FtsJoinRow extends TraceRow {
  rank: number;
}

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

/**
 * Generate a globally unique, collision-free trace ID using crypto.randomUUID().
 * Previous implementation used a monotonic counter (`mt_{timestamp}_{counter}`)
 * which could collide across multiple processes or rapid restarts.
 */
function nextTraceId(): string {
  return `mt_${crypto.randomUUID()}`;
}

/**
 * Compute SHA-256 hex digest of a string.
 */
function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Memory facade
// ---------------------------------------------------------------------------

/**
 * Unified public API for the AgentOS memory system.
 *
 * One `Memory` instance manages the full lifecycle of an agent's memories:
 * storing, retrieving, ingesting documents, building a knowledge graph,
 * self-improving through consolidation, and importing/exporting data.
 *
 * ## Quick start
 * ```ts
 * const mem = await Memory.create({ store: 'sqlite', path: './brain.sqlite' });
 *
 * await mem.remember('The user prefers dark mode');
 * const results = await mem.recall('dark mode preference');
 * console.log(results[0].trace.content);
 *
 * await mem.close();
 * ```
 */
export class Memory {
  // ---- Internal subsystem handles ----
  private readonly _brain: SqliteBrain;
  private readonly _knowledgeGraph: SqliteKnowledgeGraph;
  private readonly _memoryGraph: SqliteMemoryGraph;
  private readonly _loaderRegistry: LoaderRegistry;
  private readonly _folderScanner: FolderScanner;
  private readonly _chunkingEngine: ChunkingEngine;
  private readonly _feedbackSignal: RetrievalFeedbackSignal | null;
  private readonly _consolidationLoop: ConsolidationLoop | null;
  private readonly _config: Required<Pick<MemoryConfig, 'store' | 'path' | 'graph' | 'selfImprove' | 'decay'>> & MemoryConfig;
  private _initPromise: Promise<void>;

  /** HNSW sidecar index for O(log n) vector search alongside SQLite. */
  private _hnswSidecar: import('../store/HnswSidecar.js').HnswSidecar | null = null;

  /** Optional embedding function for vector search (set via config.embed). */
  private readonly _embed: ((text: string) => Promise<number[]>) | null;

  // -------------------------------------------------------------------
  // Constructor (private — use Memory.create() instead)
  // -------------------------------------------------------------------

  /**
   * Private constructor. Receives an already-opened SqliteBrain and
   * pre-computed configuration. Use {@link Memory.create} to instantiate.
   */
  private constructor(
    brain: SqliteBrain,
    config: Required<Pick<MemoryConfig, 'store' | 'path' | 'graph' | 'selfImprove' | 'decay'>> & MemoryConfig,
  ) {
    this._brain = brain;
    this._config = config;

    // Store the optional embedding function for vector search.
    this._embed = config.embed ?? null;

    // Create SqliteKnowledgeGraph.
    this._knowledgeGraph = new SqliteKnowledgeGraph(this._brain);

    // Create SqliteMemoryGraph and initialize.
    this._memoryGraph = new SqliteMemoryGraph(this._brain);
    this._initPromise = this._memoryGraph.initialize();

    // Create LoaderRegistry.
    this._loaderRegistry = new LoaderRegistry();

    // Create FolderScanner.
    this._folderScanner = new FolderScanner(this._loaderRegistry);

    // Create ChunkingEngine.
    this._chunkingEngine = new ChunkingEngine();

    // Self-improvement subsystems.
    if (this._config.selfImprove) {
      this._feedbackSignal = new RetrievalFeedbackSignal(this._brain);
      this._consolidationLoop = new ConsolidationLoop(this._brain, this._memoryGraph);
    } else {
      this._feedbackSignal = null;
      this._consolidationLoop = null;
    }

    // HNSW sidecar index (O(log n) ANN alongside SQLite).
    // Loads existing index from disk if present; auto-builds when trace count
    // exceeds 1000 and embeddings are available. Falls back to FTS5-only
    // recall if hnswlib-node is not installed or no embeddings exist.
    this._initPromise = this._initPromise.then(async () => {
      try {
        const { HnswSidecar } = await import('../store/HnswSidecar.js');
        const dims = this._config.embeddings?.dimensions ?? 1536;
        this._hnswSidecar = new HnswSidecar({
          sqlitePath: this._config.path!,
          dimensions: dims,
        });
        await this._hnswSidecar.init();
      } catch {
        // hnswlib-node not installed or init failed — HNSW stays null.
        // Recall will use FTS5 only (still works, just O(n) for vectors).
        this._hnswSidecar = null;
      }
    });
  }

  // -------------------------------------------------------------------
  // Async factory
  // -------------------------------------------------------------------

  /**
   * Create a new Memory instance and wire together all subsystems.
   *
   * Initialization sequence:
   * 1. Merge `config` with defaults (store='sqlite', path=tmpdir, graph=true,
   *    selfImprove=true, decay=true).
   * 2. Await `SqliteBrain.open(config.path)`.
   * 3. Check embedding dimension compatibility (warn on mismatch).
   * 4. Create `SqliteKnowledgeGraph(brain)`.
   * 5. Create `SqliteMemoryGraph(brain)` and call `.initialize()`.
   * 6. Create `LoaderRegistry()` (pre-registers all built-in loaders).
   * 7. Create `FolderScanner(registry)`.
   * 8. Create `ChunkingEngine()`.
   * 9. If `selfImprove`: create `RetrievalFeedbackSignal(brain)` and
   *    `ConsolidationLoop(brain, memoryGraph)`.
   *
   * @param config - Optional configuration; see {@link MemoryConfig}.
   * @returns A fully initialised Memory instance.
   */
  static async create(config?: MemoryConfig): Promise<Memory> {
    // Step 1: merge with defaults.
    const randomSuffix = Math.random().toString(36).slice(2, 10);
    const merged = {
      store: 'sqlite' as const,
      path: path.join(os.tmpdir(), `brain-${randomSuffix}.sqlite`),
      graph: true,
      selfImprove: true,
      decay: true,
      ...config,
    };

    if (merged.store !== 'sqlite') {
      throw new Error(
        `Memory currently supports only the SQLite-backed facade at runtime. ` +
        `Received store="${merged.store}".`,
      );
    }

    // Step 2: create SqliteBrain (async).
    const brain = await SqliteBrain.open(merged.path!);

    // Step 3: check embedding dimension compatibility.
    const dimensions = merged.embeddings?.dimensions ?? 1536;
    const compatible = await brain.checkEmbeddingCompat(dimensions);
    if (!compatible) {
      console.warn(
        `[Memory] Embedding dimension mismatch: expected ${dimensions} but brain ` +
        `was previously configured with a different dimension. Vector similarity ` +
        `searches may produce incorrect results.`,
      );
    }

    return new Memory(brain, merged);
  }

  // =========================================================================
  // Core memory operations
  // =========================================================================

  /**
   * Store a new memory trace.
   *
   * Creates a trace in the `memory_traces` table with a unique ID, content
   * hash for deduplication, and optional type/scope/tags metadata. If the
   * memory graph is available the trace is also added as a graph node.
   *
   * @param content - The text content to remember.
   * @param options - Optional metadata (type, scope, tags, importance, etc.).
   * @returns The created MemoryTrace-like object.
   */
  async remember(content: string, options?: RememberOptions): Promise<MemoryTrace> {
    await this._initPromise;

    const contentHash = sha256(content);
    const type = options?.type ?? 'episodic';
    const scope = options?.scope ?? 'user';
    const scopeId = options?.scopeId ?? '';
    const existing = await this._findExistingTraceByHash(contentHash, type, scope, scopeId);
    if (existing) {
      return this._buildTrace(existing);
    }

    const id = nextTraceId();
    const now = Date.now();
    const tags = options?.tags ?? [];
    const entities = options?.entities ?? [];
    const importance = options?.importance ?? 1.0;

    // Generate embedding if embed function is available.
    let embeddingBlob: Buffer | null = null;
    if (this._embed) {
      try {
        const vec = await this._embed(content);
        const { embeddingToBlob: toBlob } = await import('../../rag/utils/vectorMath.js');
        embeddingBlob = toBlob(vec);
      } catch {
        // Embedding generation failed — continue without vector.
        embeddingBlob = null;
      }
    }

    // Insert into memory_traces.
    await this._brain.run(
      `INSERT INTO memory_traces
         (id, type, scope, content, embedding, strength, created_at,
          last_accessed, retrieval_count, tags, emotions, metadata, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 0)`,
      [
        id,
        type,
        scope,
        content,
        embeddingBlob, // Binary blob or null
        importance,
        now,
        JSON.stringify(tags),
        JSON.stringify({}),
        JSON.stringify(buildInitialTraceMetadata({}, { contentHash, entities, scopeId })),
      ],
    );

    // Sync FTS5 index. The external-content FTS5 table needs explicit insert.
    await this._brain.run(
      `INSERT INTO memory_traces_fts (rowid, content, tags)
       VALUES (
         (SELECT rowid FROM memory_traces WHERE id = ?),
         ?,
         ?
       )`,
      [id, content, JSON.stringify(tags)],
    );

    // Add to memory graph if available.
    if (this._config.graph) {
      await this._memoryGraph.addNode(id, {
        type: type as 'episodic' | 'semantic' | 'procedural',
        scope: scope as 'session' | 'user' | 'global',
        scopeId,
        strength: importance,
        createdAt: now,
      });
    }

    // Add to HNSW sidecar if embeddings exist for this trace.
    // The embedding is stored in the memory_traces table; if it's non-null,
    // also index it in the HNSW sidecar for fast ANN recall.
    if (this._hnswSidecar) {
      const row = await this._brain.get<{ embedding: Buffer | null }>(
        'SELECT embedding FROM memory_traces WHERE id = ?',
        [id],
      );
      if (row?.embedding && row.embedding.length > 0) {
        const { blobToEmbedding, isLegacyJsonBlob } = await import('../../rag/utils/vectorMath.js');
        const vec = isLegacyJsonBlob(row.embedding)
          ? JSON.parse(row.embedding as unknown as string) as number[]
          : blobToEmbedding(row.embedding);
        const countRow = await this._brain.get<{ c: number }>(
          'SELECT COUNT(*) as c FROM memory_traces WHERE deleted = 0',
        );
        const count = countRow?.c ?? 0;

        if (!this._hnswSidecar.isActive && count >= 1000) {
          // Threshold crossed — rebuild full index from all embeddings.
          const allRows = await this._brain.all<{ id: string; embedding: Buffer }>(
            'SELECT id, embedding FROM memory_traces WHERE deleted = 0 AND embedding IS NOT NULL',
          );
          const data = allRows
            .filter(r => r.embedding && r.embedding.length > 0)
            .map(r => ({
              id: r.id,
              embedding: isLegacyJsonBlob(r.embedding)
                ? JSON.parse(r.embedding as unknown as string) as number[]
                : blobToEmbedding(r.embedding),
            }));
          await this._hnswSidecar.rebuildFromData(data);
        } else {
          await this._hnswSidecar.add(id, vec, count);
        }
      }
    }

    // Build a MemoryTrace-shaped return value.
    return this._buildTrace({
      id,
      type,
      scope,
      content,
      embedding: null,
      strength: importance,
      created_at: now,
      last_accessed: null,
      retrieval_count: 0,
      tags: JSON.stringify(tags),
      emotions: JSON.stringify({}),
      metadata: JSON.stringify(buildInitialTraceMetadata({}, { contentHash, entities, scopeId })),
      deleted: 0,
    });
  }

  /**
   * Search for memory traces matching a natural-language query.
   *
   * Uses FTS5 full-text search with the Porter tokenizer. Results are ranked
   * by `strength * abs(fts_rank)` and filtered by optional type/scope/strength
   * criteria.
   *
   * @param query   - Natural-language search query.
   * @param options - Optional filters (limit, type, scope, minStrength).
   * @returns Ranked array of {@link ScoredTrace} results.
   */
  async recall(query: string, options?: RecallOptions): Promise<ScoredTrace[]> {
    await this._initPromise;

    const ftsQuery = buildNaturalLanguageFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const limit = options?.limit ?? 10;
    const minStrength = options?.minStrength ?? 0;

    // Build WHERE clause fragments for optional filters.
    const conditions: string[] = ['t.deleted = 0'];
    const params: unknown[] = [];

    if (options?.type) {
      conditions.push('t.type = ?');
      params.push(options.type);
    }
    if (options?.scope) {
      conditions.push('t.scope = ?');
      params.push(options.scope);
    }
    if (options?.scopeId) {
      conditions.push(`json_extract(t.metadata, '$.scopeId') = ?`);
      params.push(options.scopeId);
    }
    if (minStrength > 0) {
      conditions.push('t.strength >= ?');
      params.push(minStrength);
    }
    if (options?.after != null) {
      conditions.push('t.created_at > ?');
      params.push(options.after);
    }
    if (options?.before != null) {
      conditions.push('t.created_at < ?');
      params.push(options.before);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // ── Path A: HNSW + FTS5 hybrid (if sidecar is active) ──
    // Uses HNSW for dense vector candidates, FTS5 for lexical candidates,
    // then merges via reciprocal rank fusion (RRF). This is the fast path
    // when embeddings exist and the sidecar has been built.
    if (this._hnswSidecar?.isActive && this._embed) {
      // Generate query embedding for HNSW vector search.
      let queryEmbedding: number[] = [];
      try {
        queryEmbedding = await this._embed(query);
      } catch {
        // Embedding failed — fall through to FTS5-only path.
      }

      // Get vector candidates from HNSW (3x over-fetch for fusion).
      const hnswCandidates = queryEmbedding.length > 0
        ? this._hnswSidecar.query(queryEmbedding, limit * 3)
        : [];

      // If HNSW returned candidates, merge with FTS5 via RRF.
      if (hnswCandidates.length > 0) {
        const hnswIds = new Set(hnswCandidates.map(c => c.id));
        const hnswRank = new Map(hnswCandidates.map((c, i) => [c.id, i + 1]));

        // Get FTS5 candidates.
        const ftsSql = `
          SELECT t.*, fts.rank
          FROM memory_traces_fts fts
          JOIN memory_traces t ON t.rowid = fts.rowid
          ${whereClause}
          AND memory_traces_fts MATCH ?
          ORDER BY abs(fts.rank) DESC
          LIMIT ?
        `;
        const ftsRows = await this._brain.all<FtsJoinRow>(
          ftsSql,
          [...params, ftsQuery, limit * 3],
        );

        const ftsRank = new Map(ftsRows.map((r, i) => [r.id, i + 1]));

        // Merge all candidate IDs.
        const allIds = new Set([...hnswIds, ...ftsRows.map(r => r.id)]);
        const rrfK = 60; // Standard RRF constant.

        // Compute RRF score for each candidate.
        const scored: { id: string; rrfScore: number }[] = [];
        for (const id of allIds) {
          const denseRank = hnswRank.get(id) ?? 10000;
          const lexRank = ftsRank.get(id) ?? 10000;
          const rrfScore = 1 / (rrfK + denseRank) + 1 / (rrfK + lexRank);
          scored.push({ id, rrfScore });
        }

        // Sort by RRF score descending, take top limit.
        scored.sort((a, b) => b.rrfScore - a.rrfScore);
        const topIds = scored.slice(0, limit).map(s => s.id);

        // Fetch full rows for the top candidates.
        if (topIds.length > 0) {
          const placeholders = topIds.map(() => '?').join(',');
          const fullRows = await this._brain.all<FtsJoinRow>(
            `SELECT t.*, 0.0 as rank FROM memory_traces t WHERE t.id IN (${placeholders}) AND t.deleted = 0`,
            topIds,
          );

          const updatedRows = await this._applyRecallAccessUpdates(fullRows);
          const rrfMap = new Map(scored.map(s => [s.id, s.rrfScore]));

          return updatedRows.map((row) => ({
            trace: this._buildTrace(row),
            score: rrfMap.get(row.id) ?? 0,
          })).sort((a, b) => b.score - a.score);
        }
      }
    }

    // ── Path B: FTS5-only (fallback when HNSW is inactive) ──
    // This is the original behavior — pure text search ranked by
    // strength * abs(fts_rank). Works without any embeddings.
    const sql = `
      SELECT t.*, fts.rank
      FROM memory_traces_fts fts
      JOIN memory_traces t ON t.rowid = fts.rowid
      ${whereClause}
      AND memory_traces_fts MATCH ?
      ORDER BY (t.strength * abs(fts.rank)) DESC
      LIMIT ?
    `;

    params.push(ftsQuery, limit);

    const rows = await this._brain.all<FtsJoinRow>(sql, params);

    const updatedRows = await this._applyRecallAccessUpdates(rows);

    return updatedRows.map((row) => ({
      trace: this._buildTrace(row),
      score: row.strength * Math.abs(row.rank),
    }));
  }

  /**
   * Soft-delete a memory trace by setting `deleted = 1`.
   *
   * The trace remains in the database for audit/recovery purposes but is
   * excluded from all recall queries and health reports.
   *
   * @param traceId - The ID of the trace to forget.
   */
  async forget(traceId: string): Promise<void> {
    await this._initPromise;

    await this._brain.run(
      'UPDATE memory_traces SET deleted = 1 WHERE id = ?',
      [traceId],
    );
  }

  // =========================================================================
  // Document ingestion
  // =========================================================================

  /**
   * Ingest documents from a file, directory, or URL.
   *
   * Workflow:
   * 1. Detect source type (file, directory, or URL).
   * 2. Load document(s) using the appropriate loader.
   * 3. Chunk each document using the configured strategy.
   * 4. For each chunk: insert into `document_chunks`, create a memory trace.
   * 5. Record the document in the `documents` table.
   *
   * @param source  - File path, directory path, or URL.
   * @param options - Optional ingestion settings (recursive, include/exclude globs).
   * @returns Summary of the ingestion run.
   */
  async ingest(source: string, options?: IngestOptions): Promise<IngestResult> {
    await this._initPromise;

    const result: IngestResult = {
      succeeded: [],
      failed: [],
      chunksCreated: 0,
      tracesCreated: 0,
    };

    const chunking = {
      strategy: (this._config.ingestion?.chunkStrategy ?? 'semantic') as 'fixed' | 'semantic' | 'hierarchical' | 'layout',
      chunkSize: this._config.ingestion?.chunkSize ?? 512,
      chunkOverlap: this._config.ingestion?.chunkOverlap ?? 64,
    };
    const urlLoader = new UrlLoader(this._loaderRegistry);

    try {
      // Detect source type.
      const stat = await fs.stat(source).catch(() => null);

      if (stat?.isDirectory()) {
        // Directory scan.
        const scanResult = await this._folderScanner.scan(source, {
          recursive: options?.recursive ?? true,
          include: options?.include,
          exclude: options?.exclude,
          onProgress: options?.onProgress
            ? (file, index, total) => options.onProgress!(index, total, file)
            : undefined,
        });

        result.succeeded.push(...scanResult.succeeded);
        result.failed.push(...scanResult.failed);

        // Chunk and store each loaded document.
        for (const doc of scanResult.documents) {
          try {
            await this._ingestLoadedDocument(doc.metadata.source ?? source, doc, chunking, result);
          } catch (err) {
            result.failed.push({
              path: doc.metadata.source ?? source,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else if (stat?.isFile()) {
        // Single file.
        try {
          const doc = await this._loaderRegistry.loadFile(source);
          result.succeeded.push(source);
          await this._ingestLoadedDocument(source, doc, chunking, result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.failed.push({ path: source, error: message });
        }
      } else if (urlLoader.canLoad(source)) {
        try {
          const doc = await urlLoader.load(source);
          result.succeeded.push(source);
          await this._ingestLoadedDocument(source, doc, chunking, result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.failed.push({ path: source, error: message });
        }
      } else {
        // Unknown source.
        result.failed.push({
          path: source,
          error: `Source "${source}" is not a file, directory, or supported URL.`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed.push({ path: source, error: message });
    }

    return result;
  }

  // =========================================================================
  // Knowledge graph
  // =========================================================================

  /**
   * Add or update an entity in the knowledge graph.
   *
   * Delegates to `SqliteKnowledgeGraph.upsertEntity()`. Accepts a partial
   * entity; `id`, `createdAt`, and `updatedAt` are auto-generated when omitted.
   *
   * @param entity - Partial entity descriptor.
   * @returns The complete, persisted entity.
   */
  async addEntity(
    entity: Partial<KnowledgeEntity>,
  ): Promise<KnowledgeEntity> {
    await this._initPromise;

    return this._knowledgeGraph.upsertEntity({
      type: entity.type ?? 'concept',
      label: entity.label ?? '',
      properties: entity.properties ?? {},
      confidence: entity.confidence ?? 1.0,
      source: entity.source ?? {
        type: 'system',
        timestamp: new Date().toISOString(),
      },
      embedding: entity.embedding,
      ownerId: entity.ownerId,
      tags: entity.tags,
      metadata: entity.metadata,
      ...(entity.id ? { id: entity.id } : {}),
    });
  }

  /**
   * Add or update a relation (edge) in the knowledge graph.
   *
   * Delegates to `SqliteKnowledgeGraph.upsertRelation()`. Accepts a partial
   * relation; `id` and `createdAt` are auto-generated when omitted.
   *
   * @param relation - Partial relation descriptor.
   * @returns The complete, persisted relation.
   */
  async addRelation(
    relation: Partial<KnowledgeRelation>,
  ): Promise<KnowledgeRelation> {
    await this._initPromise;

    return this._knowledgeGraph.upsertRelation({
      sourceId: relation.sourceId ?? '',
      targetId: relation.targetId ?? '',
      type: relation.type ?? 'related_to',
      label: relation.label ?? '',
      weight: relation.weight ?? 1.0,
      bidirectional: relation.bidirectional ?? false,
      confidence: relation.confidence ?? 1.0,
      source: relation.source ?? {
        type: 'system',
        timestamp: new Date().toISOString(),
      },
      properties: relation.properties,
      validFrom: relation.validFrom,
      validTo: relation.validTo,
      ...(relation.id ? { id: relation.id } : {}),
    });
  }

  /**
   * Access the underlying IKnowledgeGraph implementation.
   *
   * Useful for advanced queries (traversal, semantic search, neighbourhood
   * lookups) that are not exposed on the facade directly.
   */
  get graph(): IKnowledgeGraph {
    return this._knowledgeGraph;
  }

  // =========================================================================
  // Self-improvement
  // =========================================================================

  /**
   * Run one consolidation cycle (prune, merge, strengthen, derive, compact,
   * re-index).
   *
   * @param options - Optional topic filter (reserved for future use).
   * @returns Statistics from the consolidation run.
   * @throws {Error} When `selfImprove` was set to `false` in the config.
   */
  async consolidate(options?: { topic?: string }): Promise<ConsolidationResult> {
    await this._initPromise;

    if (!this._consolidationLoop) {
      throw new Error(
        'Memory.consolidate(): self-improvement is disabled. ' +
        'Set selfImprove: true in the MemoryConfig to enable consolidation.',
      );
    }

    return this._consolidationLoop.run(this._config.consolidation);
  }

  /**
   * Record retrieval feedback for a memory trace.
   *
   * The feedback is persisted asynchronously. This method returns a Promise
   * that resolves once the feedback has been written.
   *
   * @param traceId - The ID of the trace being evaluated.
   * @param signal  - Whether the trace was `'used'` or `'ignored'` by the LLM.
   */
  async feedback(traceId: string, signal: 'used' | 'ignored'): Promise<void> {
    if (!this._feedbackSignal) return;

    try {
      const now = Date.now();
      const row = await this._brain.get<TraceRow>(
        `SELECT id, type, scope, content, embedding, strength, created_at,
                last_accessed, retrieval_count, tags, emotions, metadata, deleted
         FROM memory_traces
         WHERE id = ?
         LIMIT 1`,
        [traceId],
      );

      await this._brain.run(
        `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at)
         VALUES (?, ?, NULL, ?)`,
        [traceId, signal, now],
      );

      if (!row) return;

      if (signal === 'used') {
        const update = updateOnRetrieval(this._buildTrace(row), now);
        const metadata = JSON.stringify(
          withPersistedDecayState(parseTraceMetadata(row.metadata), {
            stability: update.stability,
            accessCount: update.accessCount,
            reinforcementInterval: update.reinforcementInterval,
            nextReinforcementAt: update.nextReinforcementAt,
          }),
        );
        await this._brain.run(
          `UPDATE memory_traces
           SET strength = ?, last_accessed = ?, retrieval_count = ?, metadata = ?
           WHERE id = ?`,
          [
            update.encodingStrength,
            update.lastAccessedAt,
            update.retrievalCount,
            metadata,
            traceId,
          ],
        );
        return;
      }

      const penalty = penalizeUnused(this._buildTrace(row), now);
      const existingDecay = readPersistedDecayState(parseTraceMetadata(row.metadata), row.retrieval_count);
      const metadata = JSON.stringify(
        withPersistedDecayState(parseTraceMetadata(row.metadata), {
          stability: penalty.stability,
          accessCount: existingDecay.accessCount,
          reinforcementInterval: existingDecay.reinforcementInterval,
          ...(existingDecay.nextReinforcementAt !== undefined
            ? { nextReinforcementAt: existingDecay.nextReinforcementAt }
            : {}),
        }),
      );
      await this._brain.run(
        `UPDATE memory_traces
         SET strength = ?, last_accessed = ?, metadata = ?
         WHERE id = ?`,
        [penalty.encodingStrength, penalty.lastAccessedAt, metadata, traceId],
      );
    } catch {
      // Explicit feedback is best-effort; the caller should not fail on analytics updates.
    }
  }

  // =========================================================================
  // Import / Export
  // =========================================================================

  /**
   * Export the memory store to a file or directory.
   *
   * Format is detected from `options.format` or the file extension:
   * - `.json` -> JSON
   * - `.sqlite` / `.db` -> SQLite file copy
   * - directory path -> Markdown or Obsidian (based on `options.format`)
   *
   * @param outputPath - Path to write the export to.
   * @param options    - Optional format and content controls.
   */
  async export(outputPath: string, options?: ExportOptions): Promise<void> {
    await this._initPromise;

    const format = this._detectExportFormat(outputPath, options);

    switch (format) {
      case 'json': {
        const exporter = new JsonExporter(this._brain);
        await exporter.export(outputPath, options);
        break;
      }
      case 'markdown': {
        const exporter = new MarkdownExporter(this._brain);
        await exporter.export(outputPath, options);
        break;
      }
      case 'obsidian': {
        const exporter = new ObsidianExporter(this._brain);
        await exporter.export(outputPath, options);
        break;
      }
      case 'sqlite': {
        const exporter = new SqliteExporter(this._brain);
        await exporter.export(outputPath, options);
        break;
      }
      default: {
        throw new Error(`Memory.export(): unsupported format "${format}".`);
      }
    }
  }

  /**
   * Import memory data from a file or directory.
   *
   * Format is detected from `options.format`, the file extension, or by
   * inspecting the content.
   *
   * @param source  - Path to the import source (file or directory).
   * @param options - Optional format hint and dedup settings.
   * @returns Summary of the import operation.
   */
  async importFrom(source: string, options?: ImportOptions): Promise<ImportResult> {
    await this._initPromise;

    const format = await this._detectImportFormat(source, options);
    let result: ImportResult;

    switch (format) {
      case 'json':
        result = await new JsonImporter(this._brain).import(source);
        break;
      case 'markdown':
        result = await new MarkdownImporter(this._brain).import(source);
        break;
      case 'obsidian':
        result = await new ObsidianImporter(this._brain).import(source);
        break;
      case 'sqlite':
        result = await new SqliteImporter(this._brain).import(source);
        break;
      case 'chatgpt':
        result = await new ChatGptImporter(this._brain).import(source);
        break;
      case 'csv':
        result = await new CsvImporter(this._brain).import(source);
        break;
      default:
        result = { imported: 0, skipped: 0, errors: [`Unsupported import format: "${format}"`] };
        break;
    }

    if (result.imported > 0) {
      await this._rebuildFtsIndex();
    }

    return result;
  }

  // =========================================================================
  // Tool integration
  // =========================================================================

  /**
   * Create runtime `ITool` instances backed by this memory facade's SQLite brain.
   *
   * This is the supported bridge from the standalone memory engine into
   * AgentOS tool registration. The returned tools share this `Memory`
   * instance's underlying SQLite database and consolidation loop.
   *
   * Typical usage:
   * ```ts
   * for (const tool of memory.createTools()) {
   *   await agentos.getToolOrchestrator().registerTool(tool);
   * }
   * ```
   *
   * When self-improvement is disabled, `memory_reflect` is omitted because
   * there is no backing {@link ConsolidationLoop} instance.
   */
  createTools(options?: { includeReflect?: boolean }): ITool[] {
    const tools: ITool[] = [
      new MemoryAddTool(this._brain),
      new MemoryUpdateTool(this._brain),
      new MemoryDeleteTool(this._brain),
      new MemoryMergeTool(this._brain),
      new MemorySearchTool(this._brain),
    ];

    const includeReflect = options?.includeReflect ?? true;
    if (includeReflect && this._consolidationLoop) {
      tools.push(new MemoryReflectTool(this._brain, this._consolidationLoop));
    }

    return tools;
  }

  // =========================================================================
  // Health
  // =========================================================================

  /**
   * Return a health snapshot of the memory store.
   *
   * Queries aggregate statistics from all tables and returns a
   * {@link MemoryHealth} report.
   */
  async health(): Promise<MemoryHealth> {
    await this._initPromise;

    // Total traces (active + deleted).
    const totalRow = await this._brain.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM memory_traces',
    );
    const totalTraces = totalRow?.cnt ?? 0;

    // Active traces (not deleted).
    const activeRow = await this._brain.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM memory_traces WHERE deleted = 0',
    );
    const activeTraces = activeRow?.cnt ?? 0;

    // Average strength of active traces.
    const avgRow = await this._brain.get<{ avg_s: number | null }>(
      'SELECT AVG(strength) AS avg_s FROM memory_traces WHERE deleted = 0',
    );
    const avgStrength = avgRow?.avg_s ?? 0;

    // Weakest active trace.
    const weakRow = await this._brain.get<{ min_s: number | null }>(
      'SELECT MIN(strength) AS min_s FROM memory_traces WHERE deleted = 0',
    );
    const weakestTraceStrength = weakRow?.min_s ?? 0;

    // Knowledge graph counts.
    const nodesRow = await this._brain.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM knowledge_nodes',
    );
    const graphNodes = nodesRow?.cnt ?? 0;

    const edgesRow = await this._brain.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM knowledge_edges',
    );
    const graphEdges = edgesRow?.cnt ?? 0;

    // Last consolidation timestamp.
    const lastConsolRow = await this._brain.get<{ ran_at: number }>(
      'SELECT ran_at FROM consolidation_log ORDER BY ran_at DESC LIMIT 1',
    );
    const lastConsolidation = lastConsolRow
      ? new Date(lastConsolRow.ran_at).toISOString()
      : null;

    // Traces per type.
    const typeRows = await this._brain.all<{ type: string; cnt: number }>(
      'SELECT type, COUNT(*) AS cnt FROM memory_traces WHERE deleted = 0 GROUP BY type',
    );
    const tracesPerType: Record<string, number> = {};
    for (const row of typeRows) {
      tracesPerType[row.type] = row.cnt;
    }

    // Traces per scope.
    const scopeRows = await this._brain.all<{ scope: string; cnt: number }>(
      'SELECT scope, COUNT(*) AS cnt FROM memory_traces WHERE deleted = 0 GROUP BY scope',
    );
    const tracesPerScope: Record<string, number> = {};
    for (const row of scopeRows) {
      tracesPerScope[row.scope] = row.cnt;
    }

    // Total document chunks.
    const docsRow = await this._brain.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM documents',
    );
    const documentsIngested = docsRow?.cnt ?? 0;

    return {
      totalTraces,
      activeTraces,
      avgStrength,
      weakestTraceStrength,
      graphNodes,
      graphEdges,
      lastConsolidation,
      tracesPerType,
      tracesPerScope,
      documentsIngested,
    };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Close the Memory instance and release all resources.
   *
   * Flushes the SQLite WAL and releases the file lock. Must be called when
   * the agent shuts down.
   */
  async close(): Promise<void> {
    await this._initPromise;
    await this._brain.close();
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Convert a raw `memory_traces` row into a `MemoryTrace` object.
   */
  private _buildTrace(row: TraceRow): MemoryTrace {
    let tags: string[] = [];
    try { tags = JSON.parse(row.tags); } catch { /* empty */ }

    let emotions = {};
    try { emotions = JSON.parse(row.emotions); } catch { /* empty */ }

    const metadata = parseTraceMetadata(row.metadata);

    const entities = Array.isArray(metadata.entities) ? metadata.entities as string[] : [];
    const scopeId = typeof metadata.scopeId === 'string' ? metadata.scopeId : '';
    const decayState = readPersistedDecayState(metadata, row.retrieval_count);

    return {
      id: row.id,
      type: row.type as MemoryTrace['type'],
      scope: row.scope as MemoryTrace['scope'],
      scopeId,
      content: row.content,
      entities,
      tags,
      provenance: {
        sourceType: 'user_statement',
        sourceTimestamp: row.created_at,
        confidence: 1.0,
        verificationCount: 0,
      },
      emotionalContext: {
        valence: 0,
        arousal: 0,
        dominance: 0,
        intensity: 0,
        gmiMood: 'neutral',
        ...emotions,
      },
      encodingStrength: row.strength,
      stability: decayState.stability,
      retrievalCount: row.retrieval_count,
      lastAccessedAt: row.last_accessed ?? row.created_at,
      accessCount: decayState.accessCount,
      reinforcementInterval: decayState.reinforcementInterval,
      ...(decayState.nextReinforcementAt !== undefined
        ? { nextReinforcementAt: decayState.nextReinforcementAt }
        : {}),
      associatedTraceIds: [],
      createdAt: row.created_at,
      updatedAt: row.created_at,
      isActive: row.deleted === 0,
    };
  }

  /**
   * Find an active trace previously stored with the same content hash.
   *
   * Checks both the facade-native `content_hash` metadata key and the
   * importer-used `import_hash` key so dedup works across facade and import
   * workflows.
   */
  private async _findExistingTraceByHash(
    contentHash: string,
    type: string,
    scope: string,
    scopeId: string,
  ): Promise<TraceRow | undefined> {
    const row = await this._brain.get<TraceRow>(
      `SELECT id, type, scope, content, embedding, strength, created_at,
              last_accessed, retrieval_count, tags, emotions, metadata, deleted
       FROM memory_traces
       WHERE deleted = 0
         AND type = ?
         AND scope = ?
         AND ifnull(json_extract(metadata, '$.scopeId'), '') = ?
         AND (
           json_extract(metadata, '$.content_hash') = ?
           OR json_extract(metadata, '$.import_hash') = ?
         )
       LIMIT 1`,
      [type, scope, scopeId, contentHash, contentHash],
    );
    return row ?? undefined;
  }

  /**
   * Apply spaced-repetition access updates to recalled rows and persist the
   * updated retrieval metadata back to SQLite.
   */
  private async _applyRecallAccessUpdates(rows: FtsJoinRow[]): Promise<FtsJoinRow[]> {
    if (rows.length === 0) return rows;

    const now = Date.now();

    return this._brain.transaction(async (trx) => {
      const results: FtsJoinRow[] = [];
      for (const row of rows) {
        const update = updateOnRetrieval(this._buildTrace(row), now);
        const metadata = JSON.stringify(
          withPersistedDecayState(parseTraceMetadata(row.metadata), {
            stability: update.stability,
            accessCount: update.accessCount,
            reinforcementInterval: update.reinforcementInterval,
            nextReinforcementAt: update.nextReinforcementAt,
          }),
        );
        await trx.run(
          `UPDATE memory_traces
           SET strength = ?, last_accessed = ?, retrieval_count = ?, metadata = ?
           WHERE id = ?`,
          [
            update.encodingStrength,
            update.lastAccessedAt,
            update.retrievalCount,
            metadata,
            row.id,
          ],
        );

        results.push({
          ...row,
          strength: update.encodingStrength,
          last_accessed: update.lastAccessedAt,
          retrieval_count: update.retrievalCount,
          metadata,
        });
      }
      return results;
    });
  }

  /**
   * Persist one loaded document into the documents/chunks/traces tables.
   *
   * Document-level dedup is keyed by `documents.content_hash`, so re-ingesting
   * the same source content is idempotent.
   */
  private async _ingestLoadedDocument(
    source: string,
    doc: LoadedDocument,
    chunking: {
      strategy: 'fixed' | 'semantic' | 'hierarchical' | 'layout';
      chunkSize: number;
      chunkOverlap: number;
    },
    result: IngestResult,
  ): Promise<void> {
    const contentHash = sha256(doc.content);
    const existingDoc = await this._brain.get<{ id: string }>(
      `SELECT id FROM documents WHERE content_hash = ? LIMIT 1`,
      [contentHash],
    );

    if (existingDoc) {
      return;
    }

    const chunks = await this._chunkingEngine.chunk(doc.content, chunking);
    const docId = `doc_${crypto.randomUUID()}`;

    await this._brain.run(
      `INSERT INTO documents
         (id, path, format, title, content_hash, chunk_count, metadata, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId,
        doc.metadata.source ?? source,
        doc.format,
        doc.metadata.title ?? null,
        contentHash,
        chunks.length,
        JSON.stringify(doc.metadata),
        Date.now(),
      ],
    );

    for (const chunk of chunks) {
      const chunkId = `chunk_${crypto.randomUUID()}`;
      const traceId = nextTraceId();
      const createdAt = Date.now();

      await this._brain.run(
        `INSERT INTO memory_traces
           (id, type, scope, content, embedding, strength, created_at,
            last_accessed, retrieval_count, tags, emotions, metadata, deleted)
         VALUES (?, 'semantic', 'user', ?, NULL, 1.0, ?, NULL, 0, '[]', '{}', ?, 0)`,
        [
          traceId,
          chunk.content,
          createdAt,
          JSON.stringify(
            buildInitialTraceMetadata(
              {
                document_id: docId,
                chunk_index: chunk.index,
              },
              { contentHash: sha256(chunk.content) },
            ),
          ),
        ],
      );

      await this._brain.run(
        `INSERT INTO memory_traces_fts (rowid, content, tags)
         VALUES (
           (SELECT rowid FROM memory_traces WHERE id = ?),
           ?,
           '[]'
         )`,
        [traceId, chunk.content],
      );

      if (this._config.graph && !this._memoryGraph.hasNode(traceId)) {
        await this._memoryGraph.addNode(traceId, {
          type: 'semantic',
          scope: 'user',
          scopeId: docId,
          strength: 1.0,
          createdAt,
        });
      }

      await this._brain.run(
        `INSERT INTO document_chunks (id, document_id, trace_id, content, chunk_index, page_number, embedding)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        [
          chunkId,
          docId,
          traceId,
          chunk.content,
          chunk.index,
          chunk.pageNumber ?? null,
        ],
      );

      result.chunksCreated++;
      result.tracesCreated++;
    }
  }

  /**
   * Rebuild the external-content FTS index after bulk import operations.
   */
  private async _rebuildFtsIndex(): Promise<void> {
    try {
      await this._brain.exec(`INSERT INTO memory_traces_fts(memory_traces_fts) VALUES('rebuild')`);
    } catch {
      // Best-effort; imports still succeed even if the FTS rebuild is unavailable.
    }
  }

  /**
   * Detect the export format from options or file extension.
   */
  private _detectExportFormat(
    outputPath: string,
    options?: ExportOptions,
  ): 'json' | 'markdown' | 'obsidian' | 'sqlite' {
    if (options?.format) return options.format;

    const ext = path.extname(outputPath).toLowerCase();
    switch (ext) {
      case '.json': return 'json';
      case '.sqlite':
      case '.db': return 'sqlite';
      default: return 'markdown';
    }
  }

  /**
   * Detect the import format from options, file extension, or content inspection.
   */
  private async _detectImportFormat(
    source: string,
    options?: ImportOptions,
  ): Promise<'json' | 'markdown' | 'obsidian' | 'sqlite' | 'chatgpt' | 'csv'> {
    if (options?.format && options.format !== 'auto') return options.format;

    const ext = path.extname(source).toLowerCase();
    switch (ext) {
      case '.json': {
        // Check if it looks like a ChatGPT export.
        try {
          const head = await fs.readFile(source, { encoding: 'utf8', flag: 'r' });
          if (head.includes('"mapping"') && head.includes('"conversation_id"')) {
            return 'chatgpt';
          }
        } catch { /* fall through */ }
        return 'json';
      }
      case '.sqlite':
      case '.db': return 'sqlite';
      case '.csv': return 'csv';
      default: {
        // Check if source is a directory.
        try {
          const stat = await fs.stat(source);
          if (stat.isDirectory()) return 'markdown';
        } catch { /* fall through */ }
        return 'json';
      }
    }
  }
}

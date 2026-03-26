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
} from './types.js';
import type {
  IKnowledgeGraph,
  KnowledgeEntity,
  KnowledgeRelation,
} from '../../core/knowledge/IKnowledgeGraph.js';

import { SqliteBrain } from '../store/SqliteBrain.js';
import { SqliteKnowledgeGraph } from '../store/SqliteKnowledgeGraph.js';
import { SqliteMemoryGraph } from '../store/SqliteMemoryGraph.js';
import { LoaderRegistry } from '../ingestion/LoaderRegistry.js';
import { FolderScanner } from '../ingestion/FolderScanner.js';
import { ChunkingEngine } from '../ingestion/ChunkingEngine.js';
import { RetrievalFeedbackSignal } from '../feedback/RetrievalFeedbackSignal.js';
import { ConsolidationLoop } from '../consolidation/ConsolidationLoop.js';
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
} from '../io/index.js';

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

/** Monotonically increasing counter for trace IDs. */
let _traceCounter = 0;

/**
 * Generate a unique, collision-free trace ID.
 *
 * Format: `mt_{timestamp}_{counter}` where the counter resets at process
 * start but is never reused within a single process lifetime.
 */
function nextTraceId(): string {
  return `mt_${Date.now()}_${_traceCounter++}`;
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
 * const mem = new Memory({ store: 'sqlite', path: './brain.sqlite' });
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

  // -------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------

  /**
   * Create a new Memory instance and wire together all subsystems.
   *
   * Initialization sequence:
   * 1. Merge `config` with defaults (store='sqlite', path=tmpdir, graph=true,
   *    selfImprove=true, decay=true).
   * 2. Create `SqliteBrain(config.path)`.
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
   */
  constructor(config?: MemoryConfig) {
    // Step 1: merge with defaults.
    const randomSuffix = Math.random().toString(36).slice(2, 10);
    this._config = {
      store: 'sqlite',
      path: path.join(os.tmpdir(), `brain-${randomSuffix}.sqlite`),
      graph: true,
      selfImprove: true,
      decay: true,
      ...config,
    };

    // Step 2: create SqliteBrain.
    this._brain = new SqliteBrain(this._config.path!);

    // Step 3: check embedding dimension compatibility.
    const dimensions = this._config.embeddings?.dimensions ?? 1536;
    const compatible = this._brain.checkEmbeddingCompat(dimensions);
    if (!compatible) {
      console.warn(
        `[Memory] Embedding dimension mismatch: expected ${dimensions} but brain ` +
        `was previously configured with a different dimension. Vector similarity ` +
        `searches may produce incorrect results.`,
      );
    }

    // Step 4: create SqliteKnowledgeGraph.
    this._knowledgeGraph = new SqliteKnowledgeGraph(this._brain);

    // Step 5: create SqliteMemoryGraph and initialize.
    this._memoryGraph = new SqliteMemoryGraph(this._brain);
    this._initPromise = this._memoryGraph.initialize();

    // Step 6: create LoaderRegistry.
    this._loaderRegistry = new LoaderRegistry();

    // Step 7: create FolderScanner.
    this._folderScanner = new FolderScanner(this._loaderRegistry);

    // Step 8: create ChunkingEngine.
    this._chunkingEngine = new ChunkingEngine();

    // Step 9: self-improvement subsystems.
    if (this._config.selfImprove) {
      this._feedbackSignal = new RetrievalFeedbackSignal(this._brain);
      this._consolidationLoop = new ConsolidationLoop(this._brain, this._memoryGraph);
    } else {
      this._feedbackSignal = null;
      this._consolidationLoop = null;
    }
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

    const id = nextTraceId();
    const now = Date.now();
    const type = options?.type ?? 'episodic';
    const scope = options?.scope ?? 'user';
    const scopeId = options?.scopeId ?? '';
    const tags = options?.tags ?? [];
    const entities = options?.entities ?? [];
    const importance = options?.importance ?? 1.0;
    const contentHash = sha256(content);

    // Insert into memory_traces.
    this._brain.db
      .prepare(
        `INSERT INTO memory_traces
           (id, type, scope, content, embedding, strength, created_at,
            last_accessed, retrieval_count, tags, emotions, metadata, deleted)
         VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 0, ?, ?, ?, 0)`,
      )
      .run(
        id,
        type,
        scope,
        content,
        importance,
        now,
        JSON.stringify(tags),
        JSON.stringify({}),
        JSON.stringify({ content_hash: contentHash, entities, scopeId }),
      );

    // Sync FTS5 index. The external-content FTS5 table needs explicit insert.
    this._brain.db
      .prepare(
        `INSERT INTO memory_traces_fts (rowid, content, tags)
         VALUES (
           (SELECT rowid FROM memory_traces WHERE id = ?),
           ?,
           ?
         )`,
      )
      .run(id, content, JSON.stringify(tags));

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
      metadata: JSON.stringify({ content_hash: contentHash, entities, scopeId }),
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
    if (minStrength > 0) {
      conditions.push('t.strength >= ?');
      params.push(minStrength);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // FTS5 MATCH query joined with the main table.
    // rank is negative (closer to 0 = better match), so we use abs().
    const sql = `
      SELECT t.*, fts.rank
      FROM memory_traces_fts fts
      JOIN memory_traces t ON t.rowid = fts.rowid
      ${whereClause}
      AND memory_traces_fts MATCH ?
      ORDER BY (t.strength * abs(fts.rank)) DESC
      LIMIT ?
    `;

    params.push(query, limit);

    const rows = this._brain.db
      .prepare<unknown[], FtsJoinRow>(sql)
      .all(...params);

    return rows.map((row) => ({
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

    this._brain.db
      .prepare('UPDATE memory_traces SET deleted = 1 WHERE id = ?')
      .run(traceId);
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

    const chunkStrategy = this._config.ingestion?.chunkStrategy ?? 'semantic';
    const chunkSize = this._config.ingestion?.chunkSize ?? 512;
    const chunkOverlap = this._config.ingestion?.chunkOverlap ?? 64;

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
          const chunks = await this._chunkingEngine.chunk(doc.content, {
            strategy: chunkStrategy as 'fixed' | 'semantic' | 'hierarchical' | 'layout',
            chunkSize,
            chunkOverlap,
          });

          const docId = `doc_${Date.now()}_${_traceCounter++}`;
          const contentHash = sha256(doc.content);

          // Insert document record.
          this._brain.db
            .prepare(
              `INSERT OR IGNORE INTO documents
                 (id, path, format, title, content_hash, chunk_count, metadata, ingested_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              docId,
              doc.metadata.source ?? source,
              doc.format,
              doc.metadata.title ?? null,
              contentHash,
              chunks.length,
              JSON.stringify(doc.metadata),
              Date.now(),
            );

          // Insert chunks and create traces.
          // Insert memory_traces FIRST (document_chunks.trace_id is an FK).
          for (const chunk of chunks) {
            const chunkId = `chunk_${Date.now()}_${_traceCounter++}`;
            const traceId = nextTraceId();

            // 1. Create the memory trace for this chunk.
            this._brain.db
              .prepare(
                `INSERT INTO memory_traces
                   (id, type, scope, content, embedding, strength, created_at,
                    last_accessed, retrieval_count, tags, emotions, metadata, deleted)
                 VALUES (?, 'semantic', 'user', ?, NULL, 1.0, ?, NULL, 0, '[]', '{}', ?, 0)`,
              )
              .run(
                traceId,
                chunk.content,
                Date.now(),
                JSON.stringify({
                  content_hash: sha256(chunk.content),
                  document_id: docId,
                  chunk_index: chunk.index,
                }),
              );

            // 2. Sync FTS index.
            this._brain.db
              .prepare(
                `INSERT INTO memory_traces_fts (rowid, content, tags)
                 VALUES (
                   (SELECT rowid FROM memory_traces WHERE id = ?),
                   ?,
                   '[]'
                 )`,
              )
              .run(traceId, chunk.content);

            // 3. Insert the document chunk (FK to memory_traces now satisfied).
            this._brain.db
              .prepare(
                `INSERT INTO document_chunks (id, document_id, trace_id, content, chunk_index, page_number, embedding)
                 VALUES (?, ?, ?, ?, ?, ?, NULL)`,
              )
              .run(chunkId, docId, traceId, chunk.content, chunk.index, chunk.pageNumber ?? null);

            result.chunksCreated++;
            result.tracesCreated++;
          }
        }
      } else if (stat?.isFile()) {
        // Single file.
        try {
          const doc = await this._loaderRegistry.loadFile(source);
          result.succeeded.push(source);

          const chunks = await this._chunkingEngine.chunk(doc.content, {
            strategy: chunkStrategy as 'fixed' | 'semantic' | 'hierarchical' | 'layout',
            chunkSize,
            chunkOverlap,
          });

          const docId = `doc_${Date.now()}_${_traceCounter++}`;
          const contentHash = sha256(doc.content);

          this._brain.db
            .prepare(
              `INSERT OR IGNORE INTO documents
                 (id, path, format, title, content_hash, chunk_count, metadata, ingested_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              docId,
              source,
              doc.format,
              doc.metadata.title ?? null,
              contentHash,
              chunks.length,
              JSON.stringify(doc.metadata),
              Date.now(),
            );

          for (const chunk of chunks) {
            const chunkId = `chunk_${Date.now()}_${_traceCounter++}`;
            const traceId = nextTraceId();

            // 1. Create the memory trace first (FK target for document_chunks).
            this._brain.db
              .prepare(
                `INSERT INTO memory_traces
                   (id, type, scope, content, embedding, strength, created_at,
                    last_accessed, retrieval_count, tags, emotions, metadata, deleted)
                 VALUES (?, 'semantic', 'user', ?, NULL, 1.0, ?, NULL, 0, '[]', '{}', ?, 0)`,
              )
              .run(
                traceId,
                chunk.content,
                Date.now(),
                JSON.stringify({
                  content_hash: sha256(chunk.content),
                  document_id: docId,
                  chunk_index: chunk.index,
                }),
              );

            // 2. Sync FTS index.
            this._brain.db
              .prepare(
                `INSERT INTO memory_traces_fts (rowid, content, tags)
                 VALUES (
                   (SELECT rowid FROM memory_traces WHERE id = ?),
                   ?,
                   '[]'
                 )`,
              )
              .run(traceId, chunk.content);

            // 3. Insert document chunk (FK to memory_traces now satisfied).
            this._brain.db
              .prepare(
                `INSERT INTO document_chunks (id, document_id, trace_id, content, chunk_index, page_number, embedding)
                 VALUES (?, ?, ?, ?, ?, ?, NULL)`,
              )
              .run(chunkId, docId, traceId, chunk.content, chunk.index, chunk.pageNumber ?? null);

            result.chunksCreated++;
            result.tracesCreated++;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.failed.push({ path: source, error: message });
        }
      } else {
        // URL or unknown source -- treat as unsupported for now.
        result.failed.push({
          path: source,
          error: `Source "${source}" is not a file or directory.`,
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
   * Fire-and-forget: the feedback is persisted asynchronously and this method
   * returns immediately without waiting for the write to complete.
   *
   * @param traceId - The ID of the trace being evaluated.
   * @param signal  - Whether the trace was `'used'` or `'ignored'` by the LLM.
   */
  feedback(traceId: string, signal: 'used' | 'ignored'): void {
    if (!this._feedbackSignal) return;

    // Fire-and-forget: insert feedback row without awaiting.
    this._brain.db
      .prepare(
        `INSERT INTO retrieval_feedback (trace_id, signal, query, created_at)
         VALUES (?, ?, NULL, ?)`,
      )
      .run(traceId, signal, Date.now());
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

    switch (format) {
      case 'json': {
        const importer = new JsonImporter(this._brain);
        return importer.import(source);
      }
      case 'markdown': {
        const importer = new MarkdownImporter(this._brain);
        return importer.import(source);
      }
      case 'obsidian': {
        const importer = new ObsidianImporter(this._brain);
        return importer.import(source);
      }
      case 'sqlite': {
        const importer = new SqliteImporter(this._brain);
        return importer.import(source);
      }
      case 'chatgpt': {
        const importer = new ChatGptImporter(this._brain);
        return importer.import(source);
      }
      default: {
        return { imported: 0, skipped: 0, errors: [`Unsupported import format: "${format}"`] };
      }
    }
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

    const db = this._brain.db;

    // Total traces (active + deleted).
    const totalRow = db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM memory_traces')
      .get();
    const totalTraces = totalRow?.cnt ?? 0;

    // Active traces (not deleted).
    const activeRow = db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM memory_traces WHERE deleted = 0')
      .get();
    const activeTraces = activeRow?.cnt ?? 0;

    // Average strength of active traces.
    const avgRow = db
      .prepare<[], { avg_s: number | null }>(
        'SELECT AVG(strength) AS avg_s FROM memory_traces WHERE deleted = 0',
      )
      .get();
    const avgStrength = avgRow?.avg_s ?? 0;

    // Weakest active trace.
    const weakRow = db
      .prepare<[], { min_s: number | null }>(
        'SELECT MIN(strength) AS min_s FROM memory_traces WHERE deleted = 0',
      )
      .get();
    const weakestTraceStrength = weakRow?.min_s ?? 0;

    // Knowledge graph counts.
    const nodesRow = db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM knowledge_nodes')
      .get();
    const graphNodes = nodesRow?.cnt ?? 0;

    const edgesRow = db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM knowledge_edges')
      .get();
    const graphEdges = edgesRow?.cnt ?? 0;

    // Last consolidation timestamp.
    const lastConsolRow = db
      .prepare<[], { ran_at: number }>(
        'SELECT ran_at FROM consolidation_log ORDER BY ran_at DESC LIMIT 1',
      )
      .get();
    const lastConsolidation = lastConsolRow
      ? new Date(lastConsolRow.ran_at).toISOString()
      : null;

    // Traces per type.
    const typeRows = db
      .prepare<[], { type: string; cnt: number }>(
        'SELECT type, COUNT(*) AS cnt FROM memory_traces WHERE deleted = 0 GROUP BY type',
      )
      .all();
    const tracesPerType: Record<string, number> = {};
    for (const row of typeRows) {
      tracesPerType[row.type] = row.cnt;
    }

    // Traces per scope.
    const scopeRows = db
      .prepare<[], { scope: string; cnt: number }>(
        'SELECT scope, COUNT(*) AS cnt FROM memory_traces WHERE deleted = 0 GROUP BY scope',
      )
      .all();
    const tracesPerScope: Record<string, number> = {};
    for (const row of scopeRows) {
      tracesPerScope[row.scope] = row.cnt;
    }

    // Total document chunks.
    const docsRow = db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM documents')
      .get();
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
    this._brain.close();
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

    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(row.metadata); } catch { /* empty */ }

    const entities = Array.isArray(metadata.entities) ? metadata.entities as string[] : [];
    const scopeId = typeof metadata.scopeId === 'string' ? metadata.scopeId : '';

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
      stability: 86_400_000, // 1 day default
      retrievalCount: row.retrieval_count,
      lastAccessedAt: row.last_accessed ?? row.created_at,
      accessCount: row.retrieval_count,
      reinforcementInterval: 86_400_000,
      associatedTraceIds: [],
      createdAt: row.created_at,
      updatedAt: row.created_at,
      isActive: row.deleted === 0,
    };
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

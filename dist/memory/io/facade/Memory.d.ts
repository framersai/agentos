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
import type { MemoryTrace } from '../../core/types.js';
import type { ITool } from '../../../core/tools/ITool.js';
import type { MemoryConfig, RememberOptions, RecallOptions, IngestOptions, IngestResult, ExportOptions, ImportOptions, ImportResult, ConsolidationResult, MemoryHealth } from './types.js';
import type { IKnowledgeGraph, KnowledgeEntity, KnowledgeRelation } from '../../retrieval/graph/knowledge/IKnowledgeGraph.js';
import type { RetrievalFeedback } from '../../retrieval/feedback/RetrievalFeedbackSignal.js';
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
export declare class Memory {
    private readonly _brain;
    private readonly _knowledgeGraph;
    private readonly _memoryGraph;
    private _loaderRegistry;
    private _folderScanner;
    private _ingestionToolsPromise;
    private readonly _chunkingEngine;
    private readonly _feedbackSignal;
    private readonly _consolidationLoop;
    private readonly _config;
    private _initPromise;
    /** HNSW sidecar index for O(log n) vector search alongside SQLite. */
    private _hnswSidecar;
    /** Optional embedding function for vector search (set via config.embed). */
    private readonly _embed;
    /**
     * Private constructor. Receives an already-opened SqliteBrain and
     * pre-computed configuration. Use {@link Memory.create} to instantiate.
     */
    private constructor();
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
     * 6. Create `ChunkingEngine()`.
     * 7. Lazily create ingestion loaders on first `ingest()` call.
     * 8. If `selfImprove`: create `RetrievalFeedbackSignal(brain)` and
     *    `ConsolidationLoop(brain, memoryGraph)`.
     *
     * @param config - Optional configuration; see {@link MemoryConfig}.
     * @returns A fully initialised Memory instance.
     */
    static create(config?: MemoryConfig): Promise<Memory>;
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
    remember(content: string, options?: RememberOptions): Promise<MemoryTrace>;
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
    recall(query: string, options?: RecallOptions): Promise<ScoredTrace[]>;
    /**
     * Soft-delete a memory trace by setting `deleted = 1`.
     *
     * The trace remains in the database for audit/recovery purposes but is
     * excluded from all recall queries and health reports.
     *
     * @param traceId - The ID of the trace to forget.
     */
    forget(traceId: string): Promise<void>;
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
    ingest(source: string, options?: IngestOptions): Promise<IngestResult>;
    private _ensureIngestionTools;
    /**
     * Add or update an entity in the knowledge graph.
     *
     * Delegates to `SqliteKnowledgeGraph.upsertEntity()`. Accepts a partial
     * entity; `id`, `createdAt`, and `updatedAt` are auto-generated when omitted.
     *
     * @param entity - Partial entity descriptor.
     * @returns The complete, persisted entity.
     */
    addEntity(entity: Partial<KnowledgeEntity>): Promise<KnowledgeEntity>;
    /**
     * Add or update a relation (edge) in the knowledge graph.
     *
     * Delegates to `SqliteKnowledgeGraph.upsertRelation()`. Accepts a partial
     * relation; `id` and `createdAt` are auto-generated when omitted.
     *
     * @param relation - Partial relation descriptor.
     * @returns The complete, persisted relation.
     */
    addRelation(relation: Partial<KnowledgeRelation>): Promise<KnowledgeRelation>;
    /**
     * Access the underlying IKnowledgeGraph implementation.
     *
     * Useful for advanced queries (traversal, semantic search, neighbourhood
     * lookups) that are not exposed on the facade directly.
     */
    get graph(): IKnowledgeGraph;
    /**
     * Run one consolidation cycle (prune, merge, strengthen, derive, compact,
     * re-index).
     *
     * @param options - Optional topic filter (reserved for future use).
     * @returns Statistics from the consolidation run.
     * @throws {Error} When `selfImprove` was set to `false` in the config.
     */
    consolidate(options?: {
        topic?: string;
    }): Promise<ConsolidationResult>;
    /**
     * Record retrieval feedback for a memory trace.
     *
     * The feedback is persisted asynchronously. This method returns a Promise
     * that resolves once the feedback has been written.
     *
     * @param traceId - The ID of the trace being evaluated.
     * @param signal  - Whether the trace was `'used'` or `'ignored'` by the LLM.
     * @param query   - Optional retrieval context, typically the original user query.
     */
    feedback(traceId: string, signal: 'used' | 'ignored', query?: string): Promise<void>;
    /**
     * Detect and persist used/ignored feedback for a batch of injected traces
     * based on the assistant's final response text.
     *
     * This is the high-level bridge used by long-term-memory integrations that
     * already know which traces were injected into the prompt.
     */
    feedbackFromResponse(injectedTraces: MemoryTrace[], response: string, query?: string): Promise<RetrievalFeedback[]>;
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
    export(outputPath: string, options?: ExportOptions): Promise<void>;
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
    importFrom(source: string, options?: ImportOptions): Promise<ImportResult>;
    /**
     * Import memory data from a string without filesystem access.
     *
     * Supports JSON and CSV formats. Useful in browser environments or when
     * the data is already in memory.
     *
     * @param content - The raw string content to import.
     * @param format  - The format of the content: `'json'` or `'csv'`.
     * @param options - Optional deduplication controls.
     * @returns Summary of the import operation.
     */
    importFromString(content: string, format: 'json' | 'csv', options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Export the full brain state as a JSON string without filesystem access.
     *
     * Useful in browser environments or when the data needs to be sent over
     * a network connection.
     *
     * @param options - Optional export configuration (embeddings, conversations).
     * @returns Pretty-printed JSON string of the full brain payload.
     */
    exportToString(options?: ExportOptions): Promise<string>;
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
    createTools(options?: {
        includeReflect?: boolean;
    }): ITool[];
    /**
     * Return a health snapshot of the memory store.
     *
     * Queries aggregate statistics from all tables and returns a
     * {@link MemoryHealth} report.
     */
    health(): Promise<MemoryHealth>;
    /**
     * Close the Memory instance and release all resources.
     *
     * Flushes the SQLite WAL and releases the file lock. Must be called when
     * the agent shuts down.
     */
    close(): Promise<void>;
    /**
     * Convert a raw `memory_traces` row into a `MemoryTrace` object.
     */
    private _buildTrace;
    /**
     * Find an active trace previously stored with the same content hash.
     *
     * Checks both the facade-native `content_hash` metadata key and the
     * importer-used `import_hash` key so dedup works across facade and import
     * workflows.
     */
    private _findExistingTraceByHash;
    /**
     * Apply spaced-repetition access updates to recalled rows and persist the
     * updated retrieval metadata back to SQLite.
     */
    private _applyRecallAccessUpdates;
    /**
     * Persist one loaded document into the documents/chunks/traces tables.
     *
     * Document-level dedup is keyed by `documents.content_hash`, so re-ingesting
     * the same source content is idempotent.
     */
    private _ingestLoadedDocument;
    /**
     * Rebuild the external-content FTS index after bulk import operations.
     */
    private _rebuildFtsIndex;
    private _recallWithoutFts;
    /**
     * Rebuild the HNSW sidecar after bulk import operations.
     *
     * Imports bypass `remember()`, so any embedded traces need to be replayed
     * into the ANN sidecar explicitly to keep hybrid recall accurate.
     */
    private _rebuildHnswIndex;
    /**
     * Detect the export format from options or file extension.
     */
    private _detectExportFormat;
    /**
     * Detect the import format from options, file extension, or content inspection.
     */
    private _detectImportFormat;
}
//# sourceMappingURL=Memory.d.ts.map
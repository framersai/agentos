/**
 * @fileoverview Unified SQLite connection manager for a single agent's long-term brain.
 *
 * One `brain.sqlite` file stores everything the memory ingestion engine needs:
 * memory traces, knowledge graph nodes/edges, document ingestion records,
 * conversation history, consolidation logs, and retrieval feedback signals.
 *
 * ## Cognitive science grounding
 * The schema mirrors Tulving's LTM taxonomy:
 * - `memory_traces`       → episodic + semantic + procedural + prospective memories
 * - `knowledge_nodes/edges` → semantic network (Collins & Quillian spreading-activation model)
 * - `documents/chunks`    → external world model (grounded episodic encoding)
 * - `conversations/messages` → episodic conversational buffer
 * - `consolidation_log`   → slow-wave sleep analogue (offline consolidation events)
 * - `retrieval_feedback`  → Hebbian reinforcement ("neurons that fire together wire together")
 *
 * ## Storage design choices
 * - **Cross-platform**: Uses `@framers/sql-storage-adapter` StorageAdapter interface,
 *   enabling browser (IndexedDB/sql.js), mobile (Capacitor), and Postgres backends
 *   in addition to the default Node.js better-sqlite3 path.
 * - **WAL mode**: allows concurrent reads during writes (when adapter supports it).
 * - **FTS5 with Porter tokenizer**: enables fast full-text search over memory content with
 *   morphological stemming (retrieval cue → "retriev*").
 * - **Embeddings as BLOBs**: raw Float32Array buffers stored directly — no external vector DB
 *   dependency for the SQLite-backed path; vector similarity runs in-process via HNSW.
 * - **JSON columns**: tags, emotions, metadata stored as JSON TEXT for schema flexibility
 *   without sacrificing query-ability via SQLite's json_extract().
 *
 * @module memory/store/Brain
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  StorageAdapter,
  StorageRunResult,
  StorageParameters,
  StorageFeatures,
} from '@framers/sql-storage-adapter';
import { resolveStorageAdapter, createStorageFeatures, createPostgresAdapter } from '@framers/sql-storage-adapter';
import {
  DDL_ARCHIVED_TRACES,
  DDL_ARCHIVED_TRACES_IDX_AGENT_TIME,
  DDL_ARCHIVED_TRACES_IDX_REASON,
  DDL_ARCHIVE_ACCESS_LOG,
  DDL_ARCHIVE_ACCESS_LOG_IDX,
} from '../../archive/SqlStorageMemoryArchive.js';
import { MigrationRunner, MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations/index.js';
import { PORTABLE_TABLES, PORTABLE_TABLE_PRIMARY_KEYS } from './portable-tables.js';

/**
 * Derive a stable brain identifier from the database file path.
 *
 * `:memory:` becomes `'default'`. For real paths, the file basename is used
 * with extensions stripped (e.g. `companion-alice.sqlite` becomes
 * `companion-alice`; `foo.brain.sqlite` becomes `foo.brain`).
 *
 * Used by {@link Brain.open} when the caller does not supply an
 * explicit `brainId`.
 */
function deriveBrainIdFromPath(dbPath: string): string {
  if (dbPath === ':memory:') return 'default';
  const basename = path.basename(dbPath);
  const lastDot = basename.lastIndexOf('.');
  return lastDot > 0 ? basename.slice(0, lastDot) : basename;
}

/**
 * Redact the password segment from a Postgres connection string for safe
 * inclusion in error messages.
 *
 * `postgresql://user:secret@host/db` becomes `postgresql://user:***@host/db`.
 * Connection strings without embedded passwords pass through unchanged.
 */
function redactPostgresPassword(connStr: string): string {
  return connStr.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// SCHEMA_VERSION moved to migrations/index.ts as LATEST_SCHEMA_VERSION
// (derived from the highest registered migration, so adding v2-to-v3.ts
// auto-bumps the seed value).

// ---------------------------------------------------------------------------
// DDL — full schema
// ---------------------------------------------------------------------------

/**
 * Brain metadata key-value store.
 * Used for versioning, agent identity, and embedding configuration.
 */
const DDL_BRAIN_META = `
CREATE TABLE IF NOT EXISTS brain_meta (
  brain_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT NOT NULL,
  PRIMARY KEY (brain_id, key)
);
`;

/**
 * Core memory trace table (Tulving's unified trace model).
 *
 * Column notes:
 * - `embedding` is a raw BLOB (Float32Array serialised as little-endian bytes).
 * - `strength` is the Ebbinghaus retrievability R ∈ [0, 1].
 * - `tags` / `emotions` / `metadata` are JSON TEXT columns.
 * - `deleted` is a soft-delete flag (0 = active, 1 = tombstoned).
 */
const DDL_MEMORY_TRACES = `
CREATE TABLE IF NOT EXISTS memory_traces (
  brain_id        TEXT    NOT NULL,
  id              TEXT    NOT NULL,
  type            TEXT    NOT NULL,
  scope           TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  embedding       BLOB,
  strength        REAL    NOT NULL DEFAULT 1.0,
  created_at      INTEGER NOT NULL,
  last_accessed   INTEGER,
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  tags            TEXT    NOT NULL DEFAULT '[]',
  emotions        TEXT    NOT NULL DEFAULT '{}',
  metadata        TEXT    NOT NULL DEFAULT '{}',
  deleted         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (brain_id, id)
);

CREATE INDEX IF NOT EXISTS idx_memory_traces_brain_type
  ON memory_traces (brain_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_traces_brain_scope
  ON memory_traces (brain_id, scope);
`;

// FTS index DDL is now generated dynamically by features.fts.createIndex()
// to support both SQLite FTS5 and Postgres tsvector/GIN.

/**
 * Knowledge graph nodes (semantic network).
 * Each node represents a real-world entity or concept the agent has learned about.
 *
 * `properties` is a JSON TEXT column holding arbitrary typed attributes.
 * `source` is a JSON TEXT provenance reference.
 * `confidence` ∈ [0, 1] — certainty of this node's existence / accuracy.
 */
const DDL_KNOWLEDGE_NODES = `
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  brain_id   TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  type       TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  properties TEXT    NOT NULL DEFAULT '{}',
  embedding  BLOB,
  confidence REAL    NOT NULL DEFAULT 1.0,
  source     TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (brain_id, id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_brain_type
  ON knowledge_nodes (brain_id, type);
`;

/**
 * Knowledge graph edges (typed relationships).
 * Models semantic links between knowledge nodes (e.g. IS_A, HAS_PART, CAUSED_BY).
 *
 * `bidirectional = 1` means the edge applies in both directions (e.g. SIBLING_OF).
 * `weight` ∈ [0, 1] represents relationship strength / confidence.
 */
const DDL_KNOWLEDGE_EDGES = `
CREATE TABLE IF NOT EXISTS knowledge_edges (
  brain_id      TEXT    NOT NULL,
  id            TEXT    NOT NULL,
  source_id     TEXT    NOT NULL,
  target_id     TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  weight        REAL    NOT NULL DEFAULT 1.0,
  bidirectional INTEGER NOT NULL DEFAULT 0,
  metadata      TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (brain_id, id),
  FOREIGN KEY (brain_id, source_id) REFERENCES knowledge_nodes(brain_id, id),
  FOREIGN KEY (brain_id, target_id) REFERENCES knowledge_nodes(brain_id, id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_edges_brain_source
  ON knowledge_edges (brain_id, source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_brain_target
  ON knowledge_edges (brain_id, target_id);
`;

/**
 * Ingested document registry.
 *
 * Tracks every external document (PDF, Markdown, web page, etc.) that has
 * been chunked and embedded into this agent's brain.
 *
 * `content_hash` enables idempotent re-ingestion (skip if unchanged).
 */
const DDL_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS documents (
  brain_id     TEXT    NOT NULL,
  id           TEXT    NOT NULL,
  path         TEXT    NOT NULL,
  format       TEXT    NOT NULL,
  title        TEXT,
  content_hash TEXT    NOT NULL,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  metadata     TEXT    NOT NULL DEFAULT '{}',
  ingested_at  INTEGER NOT NULL,
  PRIMARY KEY (brain_id, id)
);
`;

/**
 * Document chunk table.
 *
 * Each chunk corresponds to a contiguous passage of text extracted from a
 * parent document. `trace_id` links to the corresponding memory trace so
 * retrieval pipelines can cross-reference vector search results.
 */
const DDL_DOCUMENT_CHUNKS = `
CREATE TABLE IF NOT EXISTS document_chunks (
  brain_id     TEXT    NOT NULL,
  id           TEXT    NOT NULL,
  document_id  TEXT    NOT NULL,
  trace_id     TEXT,
  content      TEXT    NOT NULL,
  chunk_index  INTEGER NOT NULL,
  page_number  INTEGER,
  embedding    BLOB,
  PRIMARY KEY (brain_id, id),
  FOREIGN KEY (brain_id, document_id) REFERENCES documents(brain_id, id),
  FOREIGN KEY (brain_id, trace_id) REFERENCES memory_traces(brain_id, id)
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_brain_document
  ON document_chunks (brain_id, document_id, chunk_index);
`;

/**
 * Document image table.
 *
 * Stores visual assets extracted from documents (e.g. figures, diagrams).
 * `caption` and `embedding` support multimodal retrieval.
 */
const DDL_DOCUMENT_IMAGES = `
CREATE TABLE IF NOT EXISTS document_images (
  brain_id    TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  document_id TEXT    NOT NULL,
  chunk_id    TEXT,
  data        BLOB    NOT NULL,
  mime_type   TEXT    NOT NULL,
  caption     TEXT,
  page_number INTEGER,
  embedding   BLOB,
  PRIMARY KEY (brain_id, id),
  FOREIGN KEY (brain_id, document_id) REFERENCES documents(brain_id, id),
  FOREIGN KEY (brain_id, chunk_id) REFERENCES document_chunks(brain_id, id)
);
`;

/**
 * Consolidation log.
 *
 * Records each offline consolidation run — the analogue of slow-wave sleep
 * memory consolidation. Tracks how many traces were pruned, merged, derived
 * (by inference), or compacted (losslessly compressed).
 */
const DDL_CONSOLIDATION_LOG = `
CREATE TABLE IF NOT EXISTS consolidation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brain_id    TEXT    NOT NULL,
  ran_at      INTEGER NOT NULL,
  pruned      INTEGER NOT NULL DEFAULT 0,
  merged      INTEGER NOT NULL DEFAULT 0,
  derived     INTEGER NOT NULL DEFAULT 0,
  compacted   INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_consolidation_log_brain_time
  ON consolidation_log (brain_id, ran_at DESC);
`;

/**
 * Retrieval feedback signals.
 *
 * Captures explicit (thumbs up/down) or implicit (click, dwell time, follow-up)
 * feedback on retrieved memory traces. Used by the spaced-repetition scheduler
 * to modulate `strength` and `stability` updates (Hebbian reinforcement).
 *
 * `signal` examples: 'positive', 'negative', 'neutral', 'implicit_positive'.
 */
const DDL_RETRIEVAL_FEEDBACK = `
CREATE TABLE IF NOT EXISTS retrieval_feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  brain_id   TEXT    NOT NULL,
  trace_id   TEXT    NOT NULL,
  signal     TEXT    NOT NULL,
  query      TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (brain_id, trace_id) REFERENCES memory_traces(brain_id, id)
);

CREATE INDEX IF NOT EXISTS idx_retrieval_feedback_brain_trace
  ON retrieval_feedback (brain_id, trace_id, created_at DESC);
`;

/**
 * Conversation sessions.
 *
 * Provides a lightweight conversational buffer independent of external message
 * stores. Primarily used for episodic memory encoding (conversation → trace).
 */
const DDL_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
  brain_id   TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata   TEXT    NOT NULL DEFAULT '{}',
  PRIMARY KEY (brain_id, id)
);
`;

/**
 * Conversation messages.
 *
 * Each message belongs to a conversation. `role` follows the OpenAI convention:
 * 'user' | 'assistant' | 'system' | 'tool'.
 */
const DDL_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
  brain_id        TEXT    NOT NULL,
  id              TEXT    NOT NULL,
  conversation_id TEXT    NOT NULL,
  role            TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  metadata        TEXT    NOT NULL DEFAULT '{}',
  PRIMARY KEY (brain_id, id),
  FOREIGN KEY (brain_id, conversation_id) REFERENCES conversations(brain_id, id)
);

CREATE INDEX IF NOT EXISTS idx_messages_brain_conversation
  ON messages (brain_id, conversation_id, created_at);
`;

/**
 * Prospective memory items table.
 *
 * Stores time-based, event-based, and context-based reminders/intentions
 * that the ProspectiveMemoryManager checks each turn. Items are registered
 * automatically from commitment and intention observation notes.
 *
 * `trigger_type` determines how the item fires:
 * - 'time_based': fires at or after `trigger_at` timestamp
 * - 'event_based': fires when `trigger_event` name occurs
 * - 'context_based': fires when embedding similarity to `cue_embedding` exceeds threshold
 */
const DDL_PROSPECTIVE_ITEMS = `
CREATE TABLE IF NOT EXISTS prospective_items (
  brain_id             TEXT    NOT NULL,
  id                   TEXT    NOT NULL,
  content              TEXT    NOT NULL,
  trigger_type         TEXT    NOT NULL,
  trigger_at           INTEGER,
  trigger_event        TEXT,
  cue_text             TEXT,
  cue_embedding        BLOB,
  similarity_threshold REAL    DEFAULT 0.7,
  importance           REAL    NOT NULL DEFAULT 0.5,
  triggered            INTEGER NOT NULL DEFAULT 0,
  recurring            INTEGER NOT NULL DEFAULT 0,
  source_trace_id      TEXT,
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (brain_id, id)
);
`;

// ---------------------------------------------------------------------------
// Brain
// ---------------------------------------------------------------------------

/**
 * Unified cross-platform connection manager for a single agent's persistent brain.
 *
 * Uses the `StorageAdapter` interface from `@framers/sql-storage-adapter` to
 * support multiple backends (better-sqlite3, sql.js, IndexedDB, Postgres, etc.)
 * transparently. All methods are async.
 *
 * **Usage:**
 * ```ts
 * const brain = await Brain.open('/path/to/agent/brain.sqlite');
 *
 * // Async query API for subsystems
 * const row = await brain.get<{ value: string }>('SELECT value FROM brain_meta WHERE key = ?', ['schema_version']);
 *
 * // Meta helpers
 * await brain.setMeta('last_sync', Date.now().toString());
 * const ver = await brain.getMeta('schema_version'); // '1'
 *
 * await brain.close();
 * ```
 *
 * Subsystems (KnowledgeGraph, MemoryGraph, ConsolidationLoop, etc.)
 * receive the `Brain` instance and call its async proxy methods
 * (`run`, `get`, `all`, `exec`, `transaction`) for all database operations.
 */
export class Brain {
  /**
   * The cross-platform storage adapter backing this brain.
   * Not exposed publicly — consumers use the async proxy methods instead.
   */
  private readonly _adapter: StorageAdapter;

  /**
   * Platform-aware feature bundle (dialect, FTS, BLOB codec, exporter).
   * Created by `createStorageFeatures(adapter)` during `open()`.
   */
  private readonly _features: StorageFeatures;

  /**
   * Brain identifier used to scope every brain-owned table row.
   *
   * In SQLite per-file mode, defaults to the file basename (or `'default'`
   * for `:memory:`); subsystems pass it through to the `brain_id` column
   * on every INSERT/UPDATE and into every WHERE clause on SELECT.
   *
   * In Postgres mode (multi-tenant), this is required and must be unique
   * per brain across the database.
   */
  readonly #brainId: string;

  // ---------------------------------------------------------------------------
  // Constructor (private — use Brain.open())
  // ---------------------------------------------------------------------------

  /**
   * Private constructor — use `Brain.open(dbPath)` instead.
   *
   * @param adapter  - A fully initialised StorageAdapter instance.
   * @param features - Platform-aware feature bundle.
   * @param brainId  - Brain identifier used to scope multi-tenant queries.
   */
  private constructor(adapter: StorageAdapter, features: StorageFeatures, brainId: string) {
    this._adapter = adapter;
    this._features = features;
    this.#brainId = brainId;
  }

  /**
   * Brain identifier scoping every query through this Brain instance.
   * Subsystems (KnowledgeGraph, MemoryGraph, ConsolidationLoop) read this
   * to inject `brain_id` into their own SQL.
   */
  get brainId(): string {
    return this.#brainId;
  }

  // ---------------------------------------------------------------------------
  // Async factories (three named entry points)
  //
  // Naming convention:
  //   - openSqlite / openPostgres: factory by-DIALECT. The caller specifies
  //     "I want a SQLite-backed brain at this file" or "I want a Postgres-
  //     backed brain at this URL." The adapter is constructed internally.
  //   - openWithAdapter: factory by-PRE-BUILT-ADAPTER. The caller has already
  //     built the StorageAdapter (e.g., to share a connection pool with
  //     another subsystem) and hands it to Brain to consume.
  //
  // The naming asymmetry is intentional: the first two are dialect-specific
  // entry points; the third is the escape hatch for advanced cases where the
  // adapter is owned outside the Brain.
  // ---------------------------------------------------------------------------

  /**
   * Open a Brain backed by SQLite. Tries adapters in order:
   * better-sqlite3 (Node native) -> sql.js (WASM) -> indexeddb (browser).
   *
   * @param path - File path. Use `:memory:` for in-process testing.
   * @param opts.brainId - Optional explicit brainId; defaults to file basename
   *   (or `'default'` for `:memory:`).
   * @param opts.priority - Override the default adapter priority.
   * @returns A fully initialised `Brain` instance with the v2 schema.
   */
  static async openSqlite(
    path: string,
    opts: {
      brainId?: string;
      priority?: ('better-sqlite3' | 'sqljs' | 'indexeddb')[];
    } = {},
  ): Promise<Brain> {
    const adapter = await resolveStorageAdapter({
      filePath: path,
      priority: opts.priority ?? ['better-sqlite3', 'sqljs', 'indexeddb'],
      quiet: true,
    });
    const brainId = opts.brainId ?? deriveBrainIdFromPath(path);
    return Brain._initialize(adapter, brainId);
  }

  /**
   * Open a Brain backed by PostgreSQL. Requires the `pg` npm package and
   * a reachable Postgres instance.
   *
   * @param connectionString - Standard Postgres connection URL.
   * @param opts.brainId - REQUIRED. Used to scope every query so multiple
   *   brains can share one Postgres database without leaking rows.
   * @param opts.poolSize - pg connection pool size. Defaults to 10.
   */
  static async openPostgres(
    connectionString: string,
    opts: { brainId: string; poolSize?: number },
  ): Promise<Brain> {
    if (!opts.brainId) {
      throw new Error('Brain.openPostgres: opts.brainId is required (Postgres mode is multi-tenant)');
    }
    // Use createPostgresAdapter directly so we can pass pool size; the
    // resolveStorageAdapter facade only forwards `connectionString`.
    let adapter: StorageAdapter;
    try {
      adapter = await createPostgresAdapter({
        connectionString,
        max: opts.poolSize ?? 10,
      });
      await adapter.open();
    } catch (err) {
      const safe = redactPostgresPassword(connectionString);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Brain.openPostgres: connection failed for ${safe}: ${msg}`);
    }
    return Brain._initialize(adapter, opts.brainId);
  }

  /**
   * Open a Brain with a pre-resolved StorageAdapter. Use when sharing an
   * adapter across subsystems (e.g., wilds-ai foundation pool + brain) or
   * when the consumer needs full control over adapter resolution.
   *
   * @param adapter - Pre-built StorageAdapter instance.
   * @param opts.brainId - Required for postgres-kind adapters; optional for
   *   sqlite-kind adapters (defaults to `'default'`).
   */
  static async openWithAdapter(
    adapter: StorageAdapter,
    opts: { brainId?: string } = {},
  ): Promise<Brain> {
    const isPostgres = adapter.kind.includes('postgres');
    if (isPostgres && !opts.brainId) {
      throw new Error(
        'Brain.openWithAdapter: opts.brainId is required for postgres-kind adapters',
      );
    }
    const brainId = opts.brainId ?? 'default';
    return Brain._initialize(adapter, brainId);
  }

  /**
   * Internal common initialization path used by all three factories.
   *
   * Sequence:
   * 1. Build platform-aware feature bundle.
   * 2. Set WAL mode (dialect.pragma returns null on Postgres).
   * 3. Enable foreign key enforcement (dialect.pragma returns null on Postgres).
   * 4. Auto-migrate v1 schemas to v2 (idempotent; no-op for fresh DBs and v2).
   * 5. Apply full DDL via _initSchema().
   * 6. Seed brain_meta defaults.
   */
  private static async _initialize(adapter: StorageAdapter, brainId: string): Promise<Brain> {
    const features = createStorageFeatures(adapter);
    const brain = new Brain(adapter, features, brainId);

    const walPragma = features.dialect.pragma('journal_mode', 'WAL');
    if (walPragma) await adapter.exec(walPragma);

    const fkPragma = features.dialect.pragma('foreign_keys', 'ON');
    if (fkPragma) await adapter.exec(fkPragma);

    await MigrationRunner.runPending(adapter, features, brainId, MIGRATIONS);
    await brain._initSchema();
    await brain._seedMeta();

    return brain;
  }

  // ---------------------------------------------------------------------------
  // Async proxy methods (for consumer subsystems)
  // ---------------------------------------------------------------------------

  /**
   * Execute a mutation statement (INSERT, UPDATE, DELETE).
   *
   * @param sql    - SQL statement with `?` positional placeholders.
   * @param params - Parameter array matching the placeholders.
   * @returns Metadata about affected rows.
   */
  async run(sql: string, params?: StorageParameters): Promise<StorageRunResult> {
    return this._adapter.run(sql, params);
  }

  /**
   * Retrieve a single row (or null if none found).
   *
   * @param sql    - SQL SELECT statement.
   * @param params - Parameter array.
   * @returns First matching row or null.
   */
  async get<T = unknown>(sql: string, params?: StorageParameters): Promise<T | null> {
    return this._adapter.get<T>(sql, params);
  }

  /**
   * Retrieve all rows matching the statement.
   *
   * @param sql    - SQL SELECT statement.
   * @param params - Parameter array.
   * @returns Array of matching rows (empty array if none).
   */
  async all<T = unknown>(sql: string, params?: StorageParameters): Promise<T[]> {
    return this._adapter.all<T>(sql, params);
  }

  /**
   * Execute a script containing multiple SQL statements.
   *
   * @param sql - SQL script (semicolon-delimited statements).
   */
  async exec(sql: string): Promise<void> {
    return this._adapter.exec(sql);
  }

  /**
   * Execute a callback within a database transaction.
   *
   * The transaction is automatically committed on success or rolled back
   * on error.
   *
   * @param fn - Async callback receiving a transactional adapter.
   * @returns Result of the callback.
   */
  async transaction<T>(fn: (trx: StorageAdapter) => Promise<T>): Promise<T> {
    return this._adapter.transaction(fn);
  }

  /**
   * Expose the raw storage adapter for advanced usage.
   *
   * Primarily used by SqliteExporter (VACUUM INTO) and SqliteImporter
   * (which needs direct adapter access for the target brain).
   */
  get adapter(): StorageAdapter {
    return this._adapter;
  }

  /**
   * Platform-aware feature bundle (dialect, FTS, BLOB codec, exporter).
   * Consumers use this to generate cross-platform SQL instead of hardcoding
   * SQLite-specific syntax.
   */
  get features(): StorageFeatures {
    return this._features;
  }

  // ---------------------------------------------------------------------------
  // Private init helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute idempotent DDL statements to initialize the schema.
   * `CREATE TABLE IF NOT EXISTS` is safe to re-run, so a sequential setup path
   * is sufficient and avoids adapter-specific transaction quirks during DDL.
   */
  private async _initSchema(): Promise<void> {
    const ddlStatements = [
      DDL_BRAIN_META,
      DDL_MEMORY_TRACES,
      DDL_KNOWLEDGE_NODES,
      DDL_KNOWLEDGE_EDGES,
      DDL_DOCUMENTS,
      DDL_DOCUMENT_CHUNKS,
      DDL_DOCUMENT_IMAGES,
      DDL_CONSOLIDATION_LOG,
      DDL_RETRIEVAL_FEEDBACK,
      DDL_CONVERSATIONS,
      DDL_MESSAGES,
      DDL_PROSPECTIVE_ITEMS,
      // Memory archive tables (write-ahead cold storage for verbatim content)
      DDL_ARCHIVED_TRACES,
      DDL_ARCHIVED_TRACES_IDX_AGENT_TIME,
      DDL_ARCHIVED_TRACES_IDX_REASON,
      DDL_ARCHIVE_ACCESS_LOG,
      DDL_ARCHIVE_ACCESS_LOG_IDX,
    ];

    for (const statement of ddlStatements) {
      await this._adapter.exec(statement);
    }

    // FTS index via feature abstraction (FTS5 on SQLite, tsvector/GIN on Postgres).
    // SQL.js builds may not include FTS5, so keep the core schema independent.
    const ftsDdl = this._features.fts.createIndex({
      table: 'memory_traces_fts',
      columns: ['content', 'tags'],
      contentTable: 'memory_traces',
      tokenizer: 'porter ascii',
    });
    try {
      await this._adapter.exec(ftsDdl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('no such module: fts5')) {
        throw error;
      }
    }
  }

  /**
   * Seed `brain_meta` with mandatory keys on first creation.
   * Uses INSERT OR IGNORE to be idempotent on subsequent opens.
   */
  private async _seedMeta(): Promise<void> {
    const { dialect } = this._features;
    // INSERT OR IGNORE is idempotent — no transaction needed.
    // Avoids sql.js "cannot rollback" errors when DDL from _initSchema()
    // leaves the connection in an implicit-commit state.
    await this._adapter.run(
      dialect.insertOrIgnore('brain_meta', ['brain_id', 'key', 'value'], ['?', '?', '?']),
      [this.#brainId, 'schema_version', String(LATEST_SCHEMA_VERSION)],
    );
    await this._adapter.run(
      dialect.insertOrIgnore('brain_meta', ['brain_id', 'key', 'value'], ['?', '?', '?']),
      [this.#brainId, 'created_at', Date.now().toString()],
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Read a value from the `brain_meta` key-value store.
   *
   * @param key - The metadata key to look up.
   * @returns The stored string value, or `undefined` if the key does not exist.
   */
  async getMeta(key: string): Promise<string | undefined> {
    const row = await this._adapter.get<{ value: string }>(
      'SELECT value FROM brain_meta WHERE brain_id = ? AND key = ?',
      [this.#brainId, key],
    );

    return row?.value;
  }

  /**
   * Upsert a value into the `brain_meta` key-value store.
   *
   * Uses `INSERT OR REPLACE` semantics — creates the row if absent, or
   * overwrites if present.
   *
   * @param key   - The metadata key.
   * @param value - The string value to store.
   */
  async setMeta(key: string, value: string): Promise<void> {
    await this._adapter.run(
      this._features.dialect.insertOrReplace(
        'brain_meta',
        ['brain_id', 'key', 'value'],
        ['?', '?', '?'],
        'brain_id, key',
      ),
      [this.#brainId, key, value],
    );
  }

  /**
   * Check whether a given embedding dimension is compatible with this brain.
   *
   * On first call (no stored `embedding_dimensions`), returns `true` and stores
   * the provided dimension for future compatibility checks.
   *
   * Subsequent calls compare `dimensions` against the stored value.
   * Mismatches indicate that a different embedding model was used to encode
   * memories — mixing dimensions would corrupt vector similarity searches.
   *
   * @param dimensions - The embedding vector length to check (e.g. 1536 for OpenAI ada-002).
   * @returns `true` if compatible (or no prior value), `false` on mismatch.
   */
  async checkEmbeddingCompat(dimensions: number): Promise<boolean> {
    const stored = await this.getMeta('embedding_dimensions');

    if (stored === undefined) {
      // First embedding model encounter — store and accept.
      await this.setMeta('embedding_dimensions', String(dimensions));
      return true;
    }

    return parseInt(stored, 10) === dimensions;
  }

  // ---------------------------------------------------------------------------
  // Portable artifact: export to / import from a SQLite snapshot
  // ---------------------------------------------------------------------------

  /**
   * Materialize this brain to a portable SQLite file at `targetPath`.
   *
   * Source can be any backend (SQLite, Postgres, Capacitor, etc.); output
   * is always a fresh SQLite file. Used by `.wildsoul`-style export and
   * other portability flows.
   *
   * Refuses to overwrite an existing file at `targetPath` so callers do
   * not silently lose data.
   *
   * Forking semantics: rows are emitted with the source brainId. Importing
   * the resulting file under a different brainId produces a fork.
   *
   * @param targetPath - Destination file path. File must not exist.
   * @returns Bytes written to the destination file.
   */
  async exportToSqlite(targetPath: string): Promise<{ bytesWritten: number }> {
    // Refuse to overwrite an existing file.
    try {
      await fs.access(targetPath);
      throw new Error(`Brain.exportToSqlite: target already exists: ${targetPath}`);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // Re-throw the "already exists" error and any other access error
        // that isn't a missing-file response.
        throw err;
      }
    }

    // Open a fresh SQLite Brain at the target path. We import under the
    // source brainId so the export file is identifiable as belonging to
    // this brain even if the receiving Brain has a different id.
    const target = await Brain.openSqlite(targetPath, { brainId: this.#brainId });
    try {
      for (const table of PORTABLE_TABLES) {
        const rows = await this.all<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE brain_id = ?`,
          [this.#brainId],
        );
        if (rows.length === 0) continue;

        // Upsert so source rows override the brain_meta defaults
        // (schema_version, created_at) seeded during target initialisation.
        await this._bulkCopy(target, table, rows, this.#brainId, { upsert: true });
      }
    } finally {
      await target.close();
    }

    const stat = await fs.stat(targetPath);
    return { bytesWritten: stat.size };
  }

  /**
   * Load a portable SQLite file into this Brain's adapter.
   *
   * Forking semantics: rows from the source file are written under the
   * RECEIVING brain's `brainId`, not the brainId stored in the source
   * file. This means importing an `alice` snapshot into a Brain opened
   * with `brainId: 'alice-fork'` produces a fork with no shared identity.
   *
   * @param sourcePath - Source SQLite file path (typically produced by
   *   `Brain.exportToSqlite`).
   * @param opts.strategy - `'merge'` (default) upserts on PK collision;
   *   `'replace'` wipes all rows for the receiving `brainId` first.
   * @returns Counts of rows imported per table.
   */
  async importFromSqlite(
    sourcePath: string,
    opts: { strategy?: 'merge' | 'replace' } = {},
  ): Promise<{ tablesImported: Record<string, number> }> {
    const strategy = opts.strategy ?? 'merge';

    // Peek at the source's brain_meta BEFORE opening it as a Brain. Opening
    // via Brain.openSqlite without a brainId would derive one from the file
    // path and pollute brain_meta with that synthetic id (via _seedMeta),
    // breaking the single-brain check below. We use a raw adapter for the
    // peek so we don't trigger any seeding.
    const peekAdapter = await resolveStorageAdapter({
      filePath: sourcePath,
      priority: ['better-sqlite3', 'sqljs'],
      quiet: true,
    });
    let sourceBrainIds: { brain_id: string }[];
    try {
      sourceBrainIds = await peekAdapter.all<{ brain_id: string }>(
        `SELECT DISTINCT brain_id FROM brain_meta WHERE brain_id IS NOT NULL`,
      );
    } finally {
      await peekAdapter.close();
    }

    if (sourceBrainIds.length > 1) {
      const ids = sourceBrainIds.map((r) => r.brain_id).join(', ');
      throw new Error(
        `Brain.importFromSqlite: source contains multiple brain_ids (${ids}). ` +
          `Imports must be from a single-brain export (use Brain.exportToSqlite).`,
      );
    }

    // Open the source as a Brain with the peeked brainId (if any) to avoid
    // _seedMeta polluting brain_meta with a path-derived id.
    const sourceBrainId = sourceBrainIds[0]?.brain_id;
    const source = sourceBrainId
      ? await Brain.openSqlite(sourcePath, { brainId: sourceBrainId })
      : await Brain.openSqlite(sourcePath);
    const tablesImported: Record<string, number> = {};

    try {
      if (strategy === 'replace') {
        // Wipe existing rows for the receiving brainId in every portable table.
        // Order matters: child tables before parent tables to satisfy FKs.
        for (const table of [...PORTABLE_TABLES].reverse()) {
          await this.run(
            `DELETE FROM ${table} WHERE brain_id = ?`,
            [this.#brainId],
          );
        }
      }

      for (const table of PORTABLE_TABLES) {
        // Read every row in the source file regardless of its stored brainId
        // so we capture the full snapshot for re-insertion under our brainId.
        const rows = await source.all<Record<string, unknown>>(
          `SELECT * FROM ${table}`,
        );
        tablesImported[table] = rows.length;
        if (rows.length === 0) continue;

        // Always use upsert to gracefully handle the brain_meta rows seeded
        // by `_seedMeta` during the receiving Brain's initialization (which
        // would otherwise collide with the source's schema_version/created_at).
        await this._bulkCopy(this, table, rows, this.#brainId, { upsert: true });
      }
    } finally {
      await source.close();
    }

    return { tablesImported };
  }

  /**
   * Internal helper: bulk-insert `rows` into `target.<table>`, rewriting
   * `brain_id` on each row to `targetBrainId`. When `opts.upsert` is true,
   * uses `dialect.insertOrReplace` so PK collisions overwrite (idempotent).
   */
  private async _bulkCopy(
    target: Brain,
    table: string,
    rows: Record<string, unknown>[],
    targetBrainId: string,
    opts: { upsert?: boolean } = {},
  ): Promise<void> {
    if (rows.length === 0) return;

    const columns = Object.keys(rows[0]!);
    const placeholders = columns.map(() => '?').join(', ');
    const colList = columns.join(', ');

    const stmt = opts.upsert
      ? target._features.dialect.insertOrReplace(
          table,
          columns,
          columns.map(() => '?'),
          PORTABLE_TABLE_PRIMARY_KEYS[table] ?? 'brain_id, id',
        )
      : `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;

    // Single transaction per table for bulk-insert performance + atomicity.
    await target._adapter.exec('BEGIN');
    try {
      for (const row of rows) {
        const values = columns.map((c) =>
          c === 'brain_id' ? targetBrainId : row[c],
        );
        await target._adapter.run(stmt, values as never[]);
      }
      await target._adapter.exec('COMMIT');
    } catch (err) {
      await target._adapter.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Close the database connection.
   *
   * Must be called when the agent shuts down to flush the WAL and release
   * the file lock. Failing to close may leave the database in WAL mode with
   * an unconsumed WAL file.
   */
  async close(): Promise<void> {
    try {
      await this._adapter.close();
    } catch (err) {
      // Adapter close failures (pool drain timeouts, lock-release races on
      // shutdown) shouldn't propagate to callers who are themselves shutting
      // down and can't usefully react. Log to stderr so CI artifacts capture
      // the failure context if it ever indicates a real problem.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Brain.close] adapter close failed: ${msg}\n`);
    }
  }
}

// PORTABLE_TABLES + PORTABLE_TABLE_PRIMARY_KEYS moved to ./portable-tables.ts
// (single source of truth shared with v1-to-v2 migration + postgres test cleanup).

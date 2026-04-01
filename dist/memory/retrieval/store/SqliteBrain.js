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
 * @module memory/store/SqliteBrain
 */
import { resolveStorageAdapter, createStorageFeatures } from '@framers/sql-storage-adapter';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Current schema version. Increment when breaking schema changes are made. */
const SCHEMA_VERSION = '1';
// ---------------------------------------------------------------------------
// DDL — full schema
// ---------------------------------------------------------------------------
/**
 * Brain metadata key-value store.
 * Used for versioning, agent identity, and embedding configuration.
 */
const DDL_BRAIN_META = `
CREATE TABLE IF NOT EXISTS brain_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
  id              TEXT    PRIMARY KEY,
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
  deleted         INTEGER NOT NULL DEFAULT 0
);
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
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  properties TEXT    NOT NULL DEFAULT '{}',
  embedding  BLOB,
  confidence REAL    NOT NULL DEFAULT 1.0,
  source     TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
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
  id            TEXT    PRIMARY KEY,
  source_id     TEXT    NOT NULL REFERENCES knowledge_nodes(id),
  target_id     TEXT    NOT NULL REFERENCES knowledge_nodes(id),
  type          TEXT    NOT NULL,
  weight        REAL    NOT NULL DEFAULT 1.0,
  bidirectional INTEGER NOT NULL DEFAULT 0,
  metadata      TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
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
  id           TEXT    PRIMARY KEY,
  path         TEXT    NOT NULL,
  format       TEXT    NOT NULL,
  title        TEXT,
  content_hash TEXT    NOT NULL,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  metadata     TEXT    NOT NULL DEFAULT '{}',
  ingested_at  INTEGER NOT NULL
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
  id           TEXT    PRIMARY KEY,
  document_id  TEXT    NOT NULL REFERENCES documents(id),
  trace_id     TEXT    REFERENCES memory_traces(id),
  content      TEXT    NOT NULL,
  chunk_index  INTEGER NOT NULL,
  page_number  INTEGER,
  embedding    BLOB
);
`;
/**
 * Document image table.
 *
 * Stores visual assets extracted from documents (e.g. figures, diagrams).
 * `caption` and `embedding` support multimodal retrieval.
 */
const DDL_DOCUMENT_IMAGES = `
CREATE TABLE IF NOT EXISTS document_images (
  id          TEXT    PRIMARY KEY,
  document_id TEXT    NOT NULL REFERENCES documents(id),
  chunk_id    TEXT    REFERENCES document_chunks(id),
  data        BLOB    NOT NULL,
  mime_type   TEXT    NOT NULL,
  caption     TEXT,
  page_number INTEGER,
  embedding   BLOB
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
  ran_at      INTEGER NOT NULL,
  pruned      INTEGER NOT NULL DEFAULT 0,
  merged      INTEGER NOT NULL DEFAULT 0,
  derived     INTEGER NOT NULL DEFAULT 0,
  compacted   INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
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
  trace_id   TEXT    NOT NULL REFERENCES memory_traces(id),
  signal     TEXT    NOT NULL,
  query      TEXT,
  created_at INTEGER NOT NULL
);
`;
/**
 * Conversation sessions.
 *
 * Provides a lightweight conversational buffer independent of external message
 * stores. Primarily used for episodic memory encoding (conversation → trace).
 */
const DDL_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT    PRIMARY KEY,
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata   TEXT    NOT NULL DEFAULT '{}'
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
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL REFERENCES conversations(id),
  role            TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  metadata        TEXT    NOT NULL DEFAULT '{}'
);
`;
// ---------------------------------------------------------------------------
// SqliteBrain
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
 * const brain = await SqliteBrain.open('/path/to/agent/brain.sqlite');
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
 * receive the `SqliteBrain` instance and call its async proxy methods
 * (`run`, `get`, `all`, `exec`, `transaction`) for all database operations.
 */
export class SqliteBrain {
    // ---------------------------------------------------------------------------
    // Constructor (private — use SqliteBrain.open())
    // ---------------------------------------------------------------------------
    /**
     * Private constructor — use `SqliteBrain.open(dbPath)` instead.
     *
     * @param adapter  - A fully initialised StorageAdapter instance.
     * @param features - Platform-aware feature bundle.
     */
    constructor(adapter, features) {
        this._adapter = adapter;
        this._features = features;
    }
    // ---------------------------------------------------------------------------
    // Async factory
    // ---------------------------------------------------------------------------
    /**
     * Create or open the agent's brain database at `dbPath`.
     *
     * Async factory that replaces the previous synchronous constructor.
     *
     * Initialization sequence:
     * 1. Resolve the best available storage adapter for the current runtime.
     * 2. Enable WAL journal mode for concurrent read access (when supported).
     * 3. Enable foreign key enforcement (OFF by default in SQLite).
     * 4. Execute the full DDL schema (all `CREATE TABLE IF NOT EXISTS`).
     * 5. Create the FTS5 virtual table for full-text memory search.
     * 6. Seed `brain_meta` with `schema_version` and `created_at` if absent.
     *
     * @param dbPath - Absolute path to the `.sqlite` file. The file is created
     *   if it does not exist; parent directories must already exist.
     * @returns A fully initialised `SqliteBrain` instance.
     */
    static async open(dbPath) {
        const adapter = await resolveStorageAdapter({
            filePath: dbPath,
            priority: ['better-sqlite3', 'sqljs', 'indexeddb'],
            quiet: true,
        });
        const features = createStorageFeatures(adapter);
        const brain = new SqliteBrain(adapter, features);
        // Step 1: WAL mode — dialect returns null for non-SQLite adapters.
        const walPragma = features.dialect.pragma('journal_mode', 'WAL');
        if (walPragma)
            await adapter.exec(walPragma);
        // Step 2: Foreign key enforcement — dialect returns null for Postgres (enforced by default).
        const fkPragma = features.dialect.pragma('foreign_keys', 'ON');
        if (fkPragma)
            await adapter.exec(fkPragma);
        // Step 3: Apply full schema in a single transaction for atomicity.
        await brain._initSchema();
        // Step 4: Seed brain_meta defaults if this is a fresh database.
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
    async run(sql, params) {
        return this._adapter.run(sql, params);
    }
    /**
     * Retrieve a single row (or null if none found).
     *
     * @param sql    - SQL SELECT statement.
     * @param params - Parameter array.
     * @returns First matching row or null.
     */
    async get(sql, params) {
        return this._adapter.get(sql, params);
    }
    /**
     * Retrieve all rows matching the statement.
     *
     * @param sql    - SQL SELECT statement.
     * @param params - Parameter array.
     * @returns Array of matching rows (empty array if none).
     */
    async all(sql, params) {
        return this._adapter.all(sql, params);
    }
    /**
     * Execute a script containing multiple SQL statements.
     *
     * @param sql - SQL script (semicolon-delimited statements).
     */
    async exec(sql) {
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
    async transaction(fn) {
        return this._adapter.transaction(fn);
    }
    /**
     * Expose the raw storage adapter for advanced usage.
     *
     * Primarily used by SqliteExporter (VACUUM INTO) and SqliteImporter
     * (which needs direct adapter access for the target brain).
     */
    get adapter() {
        return this._adapter;
    }
    /**
     * Platform-aware feature bundle (dialect, FTS, BLOB codec, exporter).
     * Consumers use this to generate cross-platform SQL instead of hardcoding
     * SQLite-specific syntax.
     */
    get features() {
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
    async _initSchema() {
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
        }
        catch (error) {
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
    async _seedMeta() {
        const { dialect } = this._features;
        await this._adapter.transaction(async (trx) => {
            await trx.run(dialect.insertOrIgnore('brain_meta', ['key', 'value'], ['?', '?']), ['schema_version', SCHEMA_VERSION]);
            await trx.run(dialect.insertOrIgnore('brain_meta', ['key', 'value'], ['?', '?']), ['created_at', Date.now().toString()]);
        });
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
    async getMeta(key) {
        const row = await this._adapter.get('SELECT value FROM brain_meta WHERE key = ?', [key]);
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
    async setMeta(key, value) {
        await this._adapter.run(this._features.dialect.insertOrReplace('brain_meta', ['key', 'value'], ['?', '?'], 'key'), [key, value]);
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
    async checkEmbeddingCompat(dimensions) {
        const stored = await this.getMeta('embedding_dimensions');
        if (stored === undefined) {
            // First embedding model encounter — store and accept.
            await this.setMeta('embedding_dimensions', String(dimensions));
            return true;
        }
        return parseInt(stored, 10) === dimensions;
    }
    /**
     * Close the database connection.
     *
     * Must be called when the agent shuts down to flush the WAL and release
     * the file lock. Failing to close may leave the database in WAL mode with
     * an unconsumed WAL file.
     */
    async close() {
        await this._adapter.close();
    }
}
//# sourceMappingURL=SqliteBrain.js.map
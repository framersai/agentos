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
import type { StorageAdapter, StorageRunResult, StorageParameters, StorageFeatures } from '@framers/sql-storage-adapter';
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
export declare class SqliteBrain {
    /**
     * The cross-platform storage adapter backing this brain.
     * Not exposed publicly — consumers use the async proxy methods instead.
     */
    private readonly _adapter;
    /**
     * Platform-aware feature bundle (dialect, FTS, BLOB codec, exporter).
     * Created by `createStorageFeatures(adapter)` during `open()`.
     */
    private readonly _features;
    /**
     * Private constructor — use `SqliteBrain.open(dbPath)` instead.
     *
     * @param adapter  - A fully initialised StorageAdapter instance.
     * @param features - Platform-aware feature bundle.
     */
    private constructor();
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
    static open(dbPath: string): Promise<SqliteBrain>;
    /**
     * Execute a mutation statement (INSERT, UPDATE, DELETE).
     *
     * @param sql    - SQL statement with `?` positional placeholders.
     * @param params - Parameter array matching the placeholders.
     * @returns Metadata about affected rows.
     */
    run(sql: string, params?: StorageParameters): Promise<StorageRunResult>;
    /**
     * Retrieve a single row (or null if none found).
     *
     * @param sql    - SQL SELECT statement.
     * @param params - Parameter array.
     * @returns First matching row or null.
     */
    get<T = unknown>(sql: string, params?: StorageParameters): Promise<T | null>;
    /**
     * Retrieve all rows matching the statement.
     *
     * @param sql    - SQL SELECT statement.
     * @param params - Parameter array.
     * @returns Array of matching rows (empty array if none).
     */
    all<T = unknown>(sql: string, params?: StorageParameters): Promise<T[]>;
    /**
     * Execute a script containing multiple SQL statements.
     *
     * @param sql - SQL script (semicolon-delimited statements).
     */
    exec(sql: string): Promise<void>;
    /**
     * Execute a callback within a database transaction.
     *
     * The transaction is automatically committed on success or rolled back
     * on error.
     *
     * @param fn - Async callback receiving a transactional adapter.
     * @returns Result of the callback.
     */
    transaction<T>(fn: (trx: StorageAdapter) => Promise<T>): Promise<T>;
    /**
     * Expose the raw storage adapter for advanced usage.
     *
     * Primarily used by SqliteExporter (VACUUM INTO) and SqliteImporter
     * (which needs direct adapter access for the target brain).
     */
    get adapter(): StorageAdapter;
    /**
     * Platform-aware feature bundle (dialect, FTS, BLOB codec, exporter).
     * Consumers use this to generate cross-platform SQL instead of hardcoding
     * SQLite-specific syntax.
     */
    get features(): StorageFeatures;
    /**
     * Execute idempotent DDL statements to initialize the schema.
     * `CREATE TABLE IF NOT EXISTS` is safe to re-run, so a sequential setup path
     * is sufficient and avoids adapter-specific transaction quirks during DDL.
     */
    private _initSchema;
    /**
     * Seed `brain_meta` with mandatory keys on first creation.
     * Uses INSERT OR IGNORE to be idempotent on subsequent opens.
     */
    private _seedMeta;
    /**
     * Read a value from the `brain_meta` key-value store.
     *
     * @param key - The metadata key to look up.
     * @returns The stored string value, or `undefined` if the key does not exist.
     */
    getMeta(key: string): Promise<string | undefined>;
    /**
     * Upsert a value into the `brain_meta` key-value store.
     *
     * Uses `INSERT OR REPLACE` semantics — creates the row if absent, or
     * overwrites if present.
     *
     * @param key   - The metadata key.
     * @param value - The string value to store.
     */
    setMeta(key: string, value: string): Promise<void>;
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
    checkEmbeddingCompat(dimensions: number): Promise<boolean>;
    /**
     * Close the database connection.
     *
     * Must be called when the agent shuts down to flush the WAL and release
     * the file lock. Failing to close may leave the database in WAL mode with
     * an unconsumed WAL file.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=SqliteBrain.d.ts.map
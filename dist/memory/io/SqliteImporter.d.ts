/**
 * @fileoverview Cross-platform SQLite importer for AgentOS memory brain.
 *
 * Opens a source SQLite file via `@framers/sql-storage-adapter` (supporting
 * better-sqlite3, sql.js, IndexedDB, etc.) and merges traces, knowledge
 * nodes, and edges into the target `SqliteBrain`.
 *
 * ## Merge strategy
 * - **memory_traces**: deduplicated by SHA-256 of `content`.
 *   - If a trace with the same hash already exists in the target:
 *     - Keep the newer `created_at` / `last_accessed` timestamp.
 *     - Merge `tags` arrays (union, dedup).
 *   - New traces are inserted wholesale.
 * - **knowledge_nodes**: deduplicated by `label` + `type`.
 *   - New nodes are inserted; existing nodes are left unchanged.
 * - **knowledge_edges**: deduplicated by `source_id` + `target_id` + `type`.
 *   - New edges are inserted; existing edges are left unchanged.
 *
 * @module memory/io/SqliteImporter
 */
import type { ImportOptions, ImportResult } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
/**
 * Merges a source SQLite brain file into a target `SqliteBrain`.
 *
 * Uses `@framers/sql-storage-adapter` to open the source file, enabling
 * cross-platform operation (better-sqlite3, sql.js, IndexedDB).
 *
 * **Usage:**
 * ```ts
 * const importer = new SqliteImporter(targetBrain);
 * const result = await importer.import('/path/to/source.sqlite');
 * ```
 */
export declare class SqliteImporter {
    private readonly brain;
    constructor(brain: SqliteBrain);
    /**
     * Open `sourcePath` via StorageAdapter, read all tables, and merge
     * their contents into the target brain.
     *
     * @param sourcePath - Absolute path to the source `.sqlite` file to import.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    import(sourcePath: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    private _sha256;
    private _mergeTraces;
    private _mergeNodes;
    private _mergeEdges;
    private _resolveTraceId;
}
//# sourceMappingURL=SqliteImporter.d.ts.map
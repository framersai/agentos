/**
 * @fileoverview SQLite importer for AgentOS memory brain.
 *
 * Opens a source SQLite file (exported by `SqliteExporter` or any compatible
 * AgentOS brain) as a separate `better-sqlite3` connection, reads all data
 * tables, and merges them into the target `SqliteBrain`.
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
 * **Usage:**
 * ```ts
 * const importer = new SqliteImporter(targetBrain);
 * const result = await importer.import('/path/to/source.sqlite');
 * ```
 */
export declare class SqliteImporter {
    private readonly brain;
    /**
     * @param brain - The target `SqliteBrain` to merge data into.
     */
    constructor(brain: SqliteBrain);
    /**
     * Open `sourcePath` as a read-only SQLite connection, read all tables, and
     * merge their contents into the target brain.
     *
     * The source connection is closed when this method returns (even on error).
     *
     * @param sourcePath - Absolute path to the source `.sqlite` file to import.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    import(sourcePath: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * SHA-256 of an arbitrary string (hex output).
     */
    private _sha256;
    /**
     * Merge `memory_traces` from source into target.
     *
     * Dedup key: SHA-256 of `content`.
     * Conflict resolution: keep newer timestamp, union tags.
     *
     * @param src    - Open source `better-sqlite3` database.
     * @param result - Mutable result accumulator.
     * @param trx    - Transactional storage adapter for target writes.
     */
    private _mergeTraces;
    /**
     * Merge `knowledge_nodes` from source into target.
     *
     * Dedup key: SHA-256 of `label` + `type`.
     *
     * @param src    - Open source database.
     * @param result - Mutable result accumulator.
     * @param trx    - Transactional storage adapter for target writes.
     */
    private _mergeNodes;
    private _resolveTraceId;
    /**
     * Merge `knowledge_edges` from source into target.
     *
     * Dedup key: SHA-256 of `source_id` + `target_id` + `type`.
     * Edges whose referenced nodes don't exist in the target are skipped.
     *
     * @param src    - Open source database.
     * @param result - Mutable result accumulator.
     * @param trx    - Transactional storage adapter for target writes.
     */
    private _mergeEdges;
}
//# sourceMappingURL=SqliteImporter.d.ts.map
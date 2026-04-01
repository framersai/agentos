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
import Database from 'better-sqlite3';
import { sha256 as crossSha256 } from '../core/util/crossPlatformCrypto.js';
import { v4 as uuidv4 } from 'uuid';
// ---------------------------------------------------------------------------
// SqliteImporter
// ---------------------------------------------------------------------------
/**
 * Merges a source SQLite brain file into a target `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new SqliteImporter(targetBrain);
 * const result = await importer.import('/path/to/source.sqlite');
 * ```
 */
export class SqliteImporter {
    /**
     * @param brain - The target `SqliteBrain` to merge data into.
     */
    constructor(brain) {
        this.brain = brain;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Open `sourcePath` as a read-only SQLite connection, read all tables, and
     * merge their contents into the target brain.
     *
     * The source connection is closed when this method returns (even on error).
     *
     * @param sourcePath - Absolute path to the source `.sqlite` file to import.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    async import(sourcePath, options) {
        const result = { imported: 0, skipped: 0, errors: [] };
        // Open the source file read-only so we cannot accidentally corrupt it.
        let sourceDb;
        try {
            sourceDb = new Database(sourcePath, { readonly: true });
        }
        catch (err) {
            result.errors.push(`Cannot open source SQLite: ${String(err)}`);
            return result;
        }
        try {
            // Run the whole merge in a single transaction on the target brain.
            await this.brain.transaction(async (trx) => {
                await this._mergeTraces(sourceDb, result, trx, options);
                await this._mergeNodes(sourceDb, result, trx);
                await this._mergeEdges(sourceDb, result, trx);
            });
        }
        finally {
            sourceDb.close();
        }
        return result;
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * SHA-256 of an arbitrary string (hex output).
     */
    async _sha256(s) {
        return crossSha256(s);
    }
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
    async _mergeTraces(src, result, trx, options) {
        let sourceRows;
        try {
            sourceRows = src.prepare('SELECT * FROM memory_traces').all();
        }
        catch {
            // Table might not exist in an incompatible source.
            return;
        }
        const { dialect } = this.brain.features;
        const checkSql = `SELECT id, created_at, tags
       FROM memory_traces
       WHERE ${dialect.jsonExtract('metadata', '$.import_hash')} = ?
          OR content = ?
       LIMIT 1`;
        const insertSql = `INSERT INTO memory_traces
         (id, type, scope, content, embedding, strength, created_at, last_accessed,
          retrieval_count, tags, emotions, metadata, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const updateTimestampSql = `UPDATE memory_traces SET created_at = ?, tags = ? WHERE id = ?`;
        for (const row of sourceRows) {
            try {
                const hash = await this._sha256(row.content);
                if (options?.dedup ?? true) {
                    const existing = await trx.get(checkSql, [hash, row.content]);
                    if (existing) {
                        // Keep the newer timestamp and union the tags.
                        const newerAt = Math.max(existing.created_at, row.created_at);
                        let existingTags = [];
                        try {
                            existingTags = JSON.parse(existing.tags);
                        }
                        catch { /* ignore */ }
                        let sourceTags = [];
                        try {
                            sourceTags = JSON.parse(row.tags);
                        }
                        catch { /* ignore */ }
                        const merged = Array.from(new Set([...existingTags, ...sourceTags]));
                        await trx.run(updateTimestampSql, [newerAt, JSON.stringify(merged), existing.id]);
                        result.skipped++;
                        continue;
                    }
                }
                // New trace — enrich metadata with import_hash.
                let meta = {};
                try {
                    meta = JSON.parse(row.metadata);
                }
                catch { /* ignore */ }
                meta['import_hash'] = hash;
                const id = await this._resolveTraceId(trx, row.id ?? `mt_${uuidv4()}`);
                await trx.run(insertSql, [
                    id,
                    row.type ?? 'episodic',
                    row.scope ?? 'user',
                    row.content,
                    row.embedding ?? null,
                    row.strength ?? 1.0,
                    row.created_at ?? Date.now(),
                    row.last_accessed ?? null,
                    row.retrieval_count ?? 0,
                    row.tags ?? '[]',
                    row.emotions ?? '{}',
                    JSON.stringify(meta),
                    row.deleted ?? 0,
                ]);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Trace merge error: ${String(err)}`);
            }
        }
    }
    /**
     * Merge `knowledge_nodes` from source into target.
     *
     * Dedup key: SHA-256 of `label` + `type`.
     *
     * @param src    - Open source database.
     * @param result - Mutable result accumulator.
     * @param trx    - Transactional storage adapter for target writes.
     */
    async _mergeNodes(src, result, trx) {
        let sourceRows;
        try {
            sourceRows = src.prepare('SELECT * FROM knowledge_nodes').all();
        }
        catch {
            return;
        }
        const checkSql = `SELECT id FROM knowledge_nodes WHERE label = ? AND type = ? LIMIT 1`;
        const { dialect } = this.brain.features;
        const insertSql = dialect.insertOrIgnore('knowledge_nodes', ['id', 'type', 'label', 'properties', 'embedding', 'confidence', 'source', 'created_at'], ['?', '?', '?', '?', '?', '?', '?', '?']);
        for (const row of sourceRows) {
            try {
                const existing = await trx.get(checkSql, [row.label ?? '', row.type ?? '']);
                if (existing) {
                    result.skipped++;
                    continue;
                }
                await trx.run(insertSql, [
                    row.id ?? `kn_${uuidv4()}`,
                    row.type ?? 'concept',
                    row.label ?? '',
                    row.properties ?? '{}',
                    row.embedding ?? null,
                    row.confidence ?? 1.0,
                    row.source ?? '{}',
                    row.created_at ?? Date.now(),
                ]);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Node merge error: ${String(err)}`);
            }
        }
    }
    async _resolveTraceId(trx, preferredId) {
        const existing = await trx.get('SELECT id FROM memory_traces WHERE id = ? LIMIT 1', [preferredId]);
        return existing ? `mt_${uuidv4()}` : preferredId;
    }
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
    async _mergeEdges(src, result, trx) {
        let sourceRows;
        try {
            sourceRows = src.prepare('SELECT * FROM knowledge_edges').all();
        }
        catch {
            return;
        }
        const checkSql = `SELECT id FROM knowledge_edges
       WHERE source_id = ? AND target_id = ? AND type = ?
       LIMIT 1`;
        const { dialect } = this.brain.features;
        const insertSql = dialect.insertOrIgnore('knowledge_edges', ['id', 'source_id', 'target_id', 'type', 'weight', 'bidirectional', 'metadata', 'created_at'], ['?', '?', '?', '?', '?', '?', '?', '?']);
        for (const row of sourceRows) {
            try {
                if (!row.source_id || !row.target_id) {
                    result.skipped++;
                    continue;
                }
                const existing = await trx.get(checkSql, [row.source_id, row.target_id, row.type ?? '']);
                if (existing) {
                    result.skipped++;
                    continue;
                }
                await trx.run(insertSql, [
                    row.id ?? `ke_${uuidv4()}`,
                    row.source_id,
                    row.target_id,
                    row.type ?? 'related_to',
                    row.weight ?? 1.0,
                    row.bidirectional ?? 0,
                    row.metadata ?? '{}',
                    row.created_at ?? Date.now(),
                ]);
                result.imported++;
            }
            catch (err) {
                // FK constraint: target node not in this brain — expected for partial imports.
                result.errors.push(`Edge merge error: ${String(err)}`);
            }
        }
    }
}
//# sourceMappingURL=SqliteImporter.js.map
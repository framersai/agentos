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
import { sha256 as crossSha256 } from '../core/util/crossPlatformCrypto.js';
import { v4 as uuidv4 } from 'uuid';
import { resolveStorageAdapter } from '@framers/sql-storage-adapter';
// ---------------------------------------------------------------------------
// SqliteImporter
// ---------------------------------------------------------------------------
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
export class SqliteImporter {
    constructor(brain) {
        this.brain = brain;
    }
    /**
     * Open `sourcePath` via StorageAdapter, read all tables, and merge
     * their contents into the target brain.
     *
     * @param sourcePath - Absolute path to the source `.sqlite` file to import.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    async import(sourcePath, options) {
        const result = { imported: 0, skipped: 0, errors: [] };
        // Check file exists before opening — resolveStorageAdapter creates new
        // files on open (SQLite behavior), which would hide missing-file errors.
        let sourceAdapter;
        try {
            const fs = await import('node:fs');
            if (!fs.existsSync(sourcePath)) {
                result.errors.push(`Cannot open source SQLite: file does not exist: ${sourcePath}`);
                return result;
            }
            sourceAdapter = await resolveStorageAdapter({
                filePath: sourcePath,
                quiet: true,
            });
        }
        catch (err) {
            result.errors.push(`Cannot open source SQLite: ${String(err)}`);
            return result;
        }
        try {
            await this.brain.transaction(async (trx) => {
                await this._mergeTraces(sourceAdapter, result, trx, options);
                await this._mergeNodes(sourceAdapter, result, trx);
                await this._mergeEdges(sourceAdapter, result, trx);
            });
        }
        finally {
            await sourceAdapter.close();
        }
        return result;
    }
    async _sha256(s) {
        return crossSha256(s);
    }
    async _mergeTraces(src, result, trx, options) {
        let sourceRows;
        try {
            sourceRows = await src.all('SELECT * FROM memory_traces');
        }
        catch {
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
    async _mergeNodes(src, result, trx) {
        let sourceRows;
        try {
            sourceRows = await src.all('SELECT * FROM knowledge_nodes');
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
    async _mergeEdges(src, result, trx) {
        let sourceRows;
        try {
            sourceRows = await src.all('SELECT * FROM knowledge_edges');
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
                result.errors.push(`Edge merge error: ${String(err)}`);
            }
        }
    }
    async _resolveTraceId(trx, preferredId) {
        const existing = await trx.get('SELECT id FROM memory_traces WHERE id = ? LIMIT 1', [preferredId]);
        return existing ? `mt_${uuidv4()}` : preferredId;
    }
}
//# sourceMappingURL=SqliteImporter.js.map
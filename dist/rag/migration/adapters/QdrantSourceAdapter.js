/**
 * @fileoverview Qdrant source adapter for the migration engine.
 * @module rag/migration/adapters/QdrantSourceAdapter
 *
 * Reads vectors from Qdrant collections using the scroll API.
 * Non-vector data (knowledge graph, documents, etc.) is read from
 * the sidecar SQLite file that accompanies Qdrant deployments.
 */
import Database from 'better-sqlite3';
/** Tables stored as Qdrant collections (vector data). */
const QDRANT_COLLECTIONS = ['memory_traces', 'document_chunks'];
/** Tables stored in the sidecar SQLite file (non-vector data). */
const SIDECAR_TABLES = [
    'brain_meta', 'knowledge_nodes', 'knowledge_edges',
    'documents', 'document_images', 'consolidation_log',
    'retrieval_feedback', 'conversations', 'messages',
];
export class QdrantSourceAdapter {
    /**
     * @param url    - Qdrant base URL (e.g. 'http://localhost:6333').
     * @param apiKey - Optional API key for cloud instances.
     */
    constructor(url, apiKey, sidecarPath) {
        this.url = url;
        this.apiKey = apiKey;
        this.sidecarDb = null; // better-sqlite3 Database for non-vector tables
        if (sidecarPath) {
            this.sidecarDb = new Database(sidecarPath, { readonly: true });
        }
    }
    /** Build fetch headers with optional API key. */
    _headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.apiKey)
            h['api-key'] = this.apiKey;
        return h;
    }
    /**
     * List available tables/collections.
     * Combines Qdrant collections and sidecar SQLite tables.
     */
    async listTables() {
        const tables = [];
        // Check which Qdrant collections exist.
        try {
            const res = await fetch(`${this.url}/collections`, { headers: this._headers() });
            if (res.ok) {
                const data = await res.json();
                const names = new Set(data.result.collections.map(c => c.name));
                for (const t of QDRANT_COLLECTIONS) {
                    if (names.has(t))
                        tables.push(t);
                }
            }
        }
        catch {
            // Qdrant not reachable — skip vector tables.
        }
        if (this.sidecarDb) {
            const rows = this.sidecarDb
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                .all();
            const existing = new Set(rows.map((row) => row.name));
            for (const table of SIDECAR_TABLES) {
                if (existing.has(table))
                    tables.push(table);
            }
        }
        return tables;
    }
    /** Count points in a Qdrant collection. */
    async countRows(table) {
        if (QDRANT_COLLECTIONS.includes(table)) {
            const res = await fetch(`${this.url}/collections/${table}`, { headers: this._headers() });
            if (res.ok) {
                const data = await res.json();
                return data.result.points_count;
            }
        }
        if (this.sidecarDb && SIDECAR_TABLES.includes(table)) {
            const row = this.sidecarDb.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get();
            return row.c;
        }
        return 0;
    }
    /**
     * Read a batch of points from a Qdrant collection using the scroll API.
     * Converts Qdrant point format to flat row objects.
     */
    async readBatch(table, offset, limit) {
        if (this.sidecarDb && SIDECAR_TABLES.includes(table)) {
            return this.sidecarDb
                .prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`)
                .all(limit, offset);
        }
        if (!QDRANT_COLLECTIONS.includes(table))
            return [];
        const body = JSON.stringify({
            limit,
            offset,
            with_payload: true,
            with_vector: true,
        });
        const res = await fetch(`${this.url}/collections/${table}/points/scroll`, {
            method: 'POST',
            headers: this._headers(),
            body,
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        // Flatten Qdrant point structure into row objects.
        return data.result.points.map(pt => ({
            id: String(pt.id),
            embedding: pt.vector,
            ...pt.payload,
        }));
    }
    /** Close connections. */
    async close() {
        if (this.sidecarDb) {
            this.sidecarDb.close();
            this.sidecarDb = null;
        }
    }
}
//# sourceMappingURL=QdrantSourceAdapter.js.map
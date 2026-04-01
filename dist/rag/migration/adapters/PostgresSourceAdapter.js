/**
 * @fileoverview Postgres source adapter for the migration engine.
 * @module rag/migration/adapters/PostgresSourceAdapter
 *
 * Reads data from a Postgres + pgvector database in streaming batches.
 * Uses the `pg` npm package for connection management.
 */
/**
 * Tables in the AgentOS Postgres schema that should be migrated.
 * Matches the SQLite schema with JSONB instead of TEXT for JSON columns.
 */
const PG_MIGRATION_TABLES = [
    'brain_meta',
    'memory_traces',
    'knowledge_nodes',
    'knowledge_edges',
    'documents',
    'document_chunks',
    'document_images',
    'consolidation_log',
    'retrieval_feedback',
    'conversations',
    'messages',
];
export class PostgresSourceAdapter {
    /**
     * @param connectionString - Postgres connection string (e.g. 'postgresql://user:pass@host:5432/db').
     */
    constructor(connectionString) {
        this.connectionString = connectionString;
        this.pool = null; // pg.Pool — dynamically imported
    }
    /** Lazily initialize the pg connection pool. */
    async _ensurePool() {
        if (this.pool)
            return this.pool;
        const pg = await import('pg');
        this.pool = new pg.default.Pool({ connectionString: this.connectionString, max: 5 });
        return this.pool;
    }
    /** List tables that exist in the Postgres schema. */
    async listTables() {
        const pool = await this._ensurePool();
        const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
        const existing = new Set(result.rows.map((r) => r.table_name));
        return PG_MIGRATION_TABLES.filter(t => existing.has(t));
    }
    /** Count rows in a table. */
    async countRows(table) {
        const pool = await this._ensurePool();
        const result = await pool.query(`SELECT COUNT(*) as c FROM "${table}"`);
        return parseInt(result.rows[0].c, 10);
    }
    /**
     * Read a batch of rows using LIMIT/OFFSET.
     * Converts pgvector `vector` columns to number[] arrays.
     */
    async readBatch(table, offset, limit) {
        const pool = await this._ensurePool();
        const result = await pool.query(`SELECT * FROM "${table}" LIMIT $1 OFFSET $2`, [limit, offset]);
        return result.rows;
    }
    /** Close the connection pool. */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }
}
//# sourceMappingURL=PostgresSourceAdapter.js.map
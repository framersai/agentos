/**
 * @fileoverview Postgres target adapter for the migration engine.
 * @module rag/migration/adapters/PostgresTargetAdapter
 *
 * Writes migration data to a Postgres + pgvector database.
 * Ensures pgvector extension and creates tables with appropriate
 * column types (JSONB, vector, tsvector).
 */
export class PostgresTargetAdapter {
    /**
     * @param connectionString - Postgres connection string.
     */
    constructor(connectionString) {
        this.connectionString = connectionString;
        this.pool = null;
        this.createdTables = new Set();
    }
    /** Lazily initialize the pg connection pool and ensure pgvector is available. */
    async _ensurePool() {
        if (this.pool)
            return this.pool;
        const pg = await import('pg');
        this.pool = new pg.default.Pool({ connectionString: this.connectionString, max: 5 });
        // Ensure pgvector extension exists.
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        return this.pool;
    }
    /**
     * Create the target table if it doesn't exist.
     * Infers column types from the sample row:
     * - Buffer → BYTEA (or vector if column name contains 'embedding')
     * - number → BIGINT or DOUBLE PRECISION
     * - boolean → BOOLEAN
     * - object/array → JSONB
     * - string → TEXT
     */
    async ensureTable(table, sampleRow) {
        if (this.createdTables.has(table))
            return;
        const pool = await this._ensurePool();
        const columns = Object.keys(sampleRow);
        const colDefs = columns.map(col => {
            const val = sampleRow[col];
            // Embedding columns get the pgvector `vector` type.
            if (col.includes('embedding') && (val instanceof Buffer || Array.isArray(val))) {
                const dim = val instanceof Buffer ? val.byteLength / 4 : val.length;
                return `"${col}" vector(${dim})`;
            }
            if (val instanceof Buffer || val instanceof Uint8Array)
                return `"${col}" BYTEA`;
            if (typeof val === 'number')
                return `"${col}" ${Number.isInteger(val) ? 'BIGINT' : 'DOUBLE PRECISION'}`;
            if (typeof val === 'boolean')
                return `"${col}" BOOLEAN`;
            if (typeof val === 'object' && val !== null)
                return `"${col}" JSONB`;
            return `"${col}" TEXT`;
        }).join(', ');
        await pool.query(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`);
        this.createdTables.add(table);
    }
    /**
     * Write a batch of rows using INSERT ... ON CONFLICT DO NOTHING.
     * Wraps in a single transaction for atomicity.
     */
    async writeBatch(table, rows) {
        if (rows.length === 0)
            return 0;
        const pool = await this._ensurePool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const columns = Object.keys(rows[0]);
            const quotedCols = columns.map(c => `"${c}"`).join(', ');
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            const sql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
            let count = 0;
            for (const row of rows) {
                const values = columns.map(c => {
                    const v = row[c];
                    // Convert Buffer embeddings to pgvector format: '[0.1,0.2,...]'
                    if (c.includes('embedding') && v instanceof Buffer) {
                        const f32 = new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4);
                        return `[${Array.from(f32).join(',')}]`;
                    }
                    // Convert objects/arrays to JSON strings for JSONB columns.
                    if (typeof v === 'object' && v !== null && !(v instanceof Buffer)) {
                        return JSON.stringify(v);
                    }
                    return v;
                });
                await client.query(sql, values);
                count++;
            }
            await client.query('COMMIT');
            return count;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    /** Close the connection pool. */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }
}
//# sourceMappingURL=PostgresTargetAdapter.js.map
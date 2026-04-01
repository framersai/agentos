/**
 * @fileoverview SQLite target adapter for the migration engine.
 * @module rag/migration/adapters/SqliteTargetAdapter
 *
 * Writes migration data to a new or existing brain.sqlite file.
 * Uses WAL mode for concurrent read safety and wraps each batch
 * in a transaction for atomicity and performance.
 */
import Database from 'better-sqlite3';
export class SqliteTargetAdapter {
    /**
     * @param path - Path to the target brain.sqlite file. Created if it doesn't exist.
     */
    constructor(path) {
        /** Track which tables we've already created to avoid redundant DDL. */
        this.createdTables = new Set();
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
    }
    /**
     * Ensure the target table exists. Infers column types from a sample row:
     * - Buffer → BLOB
     * - number (integer) → INTEGER
     * - number (float) → REAL
     * - everything else → TEXT
     *
     * Uses CREATE TABLE IF NOT EXISTS so it's safe to call multiple times.
     *
     * @param table     - Table name to create.
     * @param sampleRow - A sample row to derive column types from.
     */
    async ensureTable(table, sampleRow) {
        if (this.createdTables.has(table))
            return;
        const columns = Object.keys(sampleRow);
        const colDefs = columns.map(col => {
            const val = sampleRow[col];
            // Infer SQLite column type from the sample value.
            if (val instanceof Buffer || val instanceof Uint8Array)
                return `"${col}" BLOB`;
            if (typeof val === 'number')
                return `"${col}" ${Number.isInteger(val) ? 'INTEGER' : 'REAL'}`;
            if (typeof val === 'boolean')
                return `"${col}" INTEGER`; // SQLite stores booleans as 0/1
            return `"${col}" TEXT`;
        }).join(', ');
        this.db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`);
        this.createdTables.add(table);
    }
    /**
     * Write a batch of rows to the target table.
     * Uses INSERT OR REPLACE to handle duplicates (requires a PRIMARY KEY
     * or UNIQUE constraint — if none exists, rows are simply inserted).
     *
     * Wraps the entire batch in a single transaction for atomicity and
     * dramatically better write performance (avoids per-row fsync).
     *
     * @param table - Table name to write to.
     * @param rows  - Array of row objects.
     * @returns Number of rows written.
     */
    async writeBatch(table, rows) {
        if (rows.length === 0)
            return 0;
        const columns = Object.keys(rows[0]);
        const quotedCols = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO "${table}" (${quotedCols}) VALUES (${placeholders})`);
        // Transaction wrapper: single fsync for the entire batch.
        const tx = this.db.transaction((batch) => {
            let count = 0;
            for (const row of batch) {
                const values = columns.map(c => {
                    const v = row[c];
                    // Convert booleans to integers for SQLite compatibility.
                    if (typeof v === 'boolean')
                        return v ? 1 : 0;
                    return v;
                });
                stmt.run(...values);
                count++;
            }
            return count;
        });
        return tx(rows);
    }
    /** Close the database connection. */
    async close() {
        this.db.close();
    }
}
//# sourceMappingURL=SqliteTargetAdapter.js.map
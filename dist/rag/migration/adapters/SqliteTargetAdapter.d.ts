/**
 * @fileoverview SQLite target adapter for the migration engine.
 * @module rag/migration/adapters/SqliteTargetAdapter
 *
 * Writes migration data to a new or existing brain.sqlite file.
 * Uses WAL mode for concurrent read safety and wraps each batch
 * in a transaction for atomicity and performance.
 */
import type { IMigrationTarget } from '../types.js';
export declare class SqliteTargetAdapter implements IMigrationTarget {
    private db;
    /** Track which tables we've already created to avoid redundant DDL. */
    private createdTables;
    /**
     * @param path - Path to the target brain.sqlite file. Created if it doesn't exist.
     */
    constructor(path: string);
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
    ensureTable(table: string, sampleRow: Record<string, unknown>): Promise<void>;
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
    writeBatch(table: string, rows: Record<string, unknown>[]): Promise<number>;
    /** Close the database connection. */
    close(): Promise<void>;
}
//# sourceMappingURL=SqliteTargetAdapter.d.ts.map
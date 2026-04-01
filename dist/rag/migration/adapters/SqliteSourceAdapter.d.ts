/**
 * @fileoverview SQLite source adapter for the migration engine.
 * @module rag/migration/adapters/SqliteSourceAdapter
 *
 * Reads data from a brain.sqlite file in streaming batches using
 * better-sqlite3's synchronous API (fastest for local reads).
 */
import type { IMigrationSource } from '../types.js';
export declare class SqliteSourceAdapter implements IMigrationSource {
    private db;
    /**
     * @param path - Path to the source brain.sqlite file. Opened read-only.
     */
    constructor(path: string);
    /**
     * List tables that exist in the source database AND are part of
     * the AgentOS memory schema. Unknown tables are skipped.
     */
    listTables(): Promise<string[]>;
    /**
     * Count rows in a table.
     * @param table - Table name.
     */
    countRows(table: string): Promise<number>;
    /**
     * Read a batch of rows from a table using LIMIT/OFFSET pagination.
     *
     * @param table  - Table name.
     * @param offset - Number of rows to skip.
     * @param limit  - Maximum rows to return.
     * @returns Array of row objects with column name → value mappings.
     */
    readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
    /** Close the read-only database connection. */
    close(): Promise<void>;
}
//# sourceMappingURL=SqliteSourceAdapter.d.ts.map
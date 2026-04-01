/**
 * @fileoverview Postgres source adapter for the migration engine.
 * @module rag/migration/adapters/PostgresSourceAdapter
 *
 * Reads data from a Postgres + pgvector database in streaming batches.
 * Uses the `pg` npm package for connection management.
 */
import type { IMigrationSource } from '../types.js';
export declare class PostgresSourceAdapter implements IMigrationSource {
    private readonly connectionString;
    private pool;
    /**
     * @param connectionString - Postgres connection string (e.g. 'postgresql://user:pass@host:5432/db').
     */
    constructor(connectionString: string);
    /** Lazily initialize the pg connection pool. */
    private _ensurePool;
    /** List tables that exist in the Postgres schema. */
    listTables(): Promise<string[]>;
    /** Count rows in a table. */
    countRows(table: string): Promise<number>;
    /**
     * Read a batch of rows using LIMIT/OFFSET.
     * Converts pgvector `vector` columns to number[] arrays.
     */
    readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
    /** Close the connection pool. */
    close(): Promise<void>;
}
//# sourceMappingURL=PostgresSourceAdapter.d.ts.map
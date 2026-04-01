/**
 * @fileoverview Postgres target adapter for the migration engine.
 * @module rag/migration/adapters/PostgresTargetAdapter
 *
 * Writes migration data to a Postgres + pgvector database.
 * Ensures pgvector extension and creates tables with appropriate
 * column types (JSONB, vector, tsvector).
 */
import type { IMigrationTarget } from '../types.js';
export declare class PostgresTargetAdapter implements IMigrationTarget {
    private readonly connectionString;
    private pool;
    private createdTables;
    /**
     * @param connectionString - Postgres connection string.
     */
    constructor(connectionString: string);
    /** Lazily initialize the pg connection pool and ensure pgvector is available. */
    private _ensurePool;
    /**
     * Create the target table if it doesn't exist.
     * Infers column types from the sample row:
     * - Buffer → BYTEA (or vector if column name contains 'embedding')
     * - number → BIGINT or DOUBLE PRECISION
     * - boolean → BOOLEAN
     * - object/array → JSONB
     * - string → TEXT
     */
    ensureTable(table: string, sampleRow: Record<string, unknown>): Promise<void>;
    /**
     * Write a batch of rows using INSERT ... ON CONFLICT DO NOTHING.
     * Wraps in a single transaction for atomicity.
     */
    writeBatch(table: string, rows: Record<string, unknown>[]): Promise<number>;
    /** Close the connection pool. */
    close(): Promise<void>;
}
//# sourceMappingURL=PostgresTargetAdapter.d.ts.map
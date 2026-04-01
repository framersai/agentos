/**
 * @fileoverview Qdrant target adapter for the migration engine.
 * @module rag/migration/adapters/QdrantTargetAdapter
 *
 * Writes vector data to Qdrant collections and non-vector data
 * to a sidecar SQLite file. Creates collections with appropriate
 * vector configuration on first write.
 */
import type { IMigrationTarget } from '../types.js';
export declare class QdrantTargetAdapter implements IMigrationTarget {
    private readonly url;
    private readonly apiKey?;
    private createdCollections;
    private createdSidecarTables;
    private sidecarDb;
    /**
     * @param url    - Qdrant base URL.
     * @param apiKey - Optional API key for cloud instances.
     */
    constructor(url: string, apiKey?: string | undefined, sidecarPath?: string);
    /** Build fetch headers. */
    private _headers;
    /**
     * Ensure a Qdrant collection exists with the correct vector configuration.
     * For non-vector tables, ensures the sidecar SQLite file has the table.
     */
    ensureTable(table: string, sampleRow: Record<string, unknown>): Promise<void>;
    /**
     * Write a batch of rows as Qdrant points.
     * Extracts `id` and `embedding` fields; everything else becomes payload.
     */
    writeBatch(table: string, rows: Record<string, unknown>[]): Promise<number>;
    /** Close connections. */
    close(): Promise<void>;
}
//# sourceMappingURL=QdrantTargetAdapter.d.ts.map
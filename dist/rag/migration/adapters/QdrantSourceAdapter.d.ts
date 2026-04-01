/**
 * @fileoverview Qdrant source adapter for the migration engine.
 * @module rag/migration/adapters/QdrantSourceAdapter
 *
 * Reads vectors from Qdrant collections using the scroll API.
 * Non-vector data (knowledge graph, documents, etc.) is read from
 * the sidecar SQLite file that accompanies Qdrant deployments.
 */
import type { IMigrationSource } from '../types.js';
export declare class QdrantSourceAdapter implements IMigrationSource {
    private readonly url;
    private readonly apiKey?;
    private sidecarDb;
    /**
     * @param url    - Qdrant base URL (e.g. 'http://localhost:6333').
     * @param apiKey - Optional API key for cloud instances.
     */
    constructor(url: string, apiKey?: string | undefined, sidecarPath?: string);
    /** Build fetch headers with optional API key. */
    private _headers;
    /**
     * List available tables/collections.
     * Combines Qdrant collections and sidecar SQLite tables.
     */
    listTables(): Promise<string[]>;
    /** Count points in a Qdrant collection. */
    countRows(table: string): Promise<number>;
    /**
     * Read a batch of points from a Qdrant collection using the scroll API.
     * Converts Qdrant point format to flat row objects.
     */
    readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
    /** Close connections. */
    close(): Promise<void>;
}
//# sourceMappingURL=QdrantSourceAdapter.d.ts.map
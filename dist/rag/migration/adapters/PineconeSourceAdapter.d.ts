/**
 * @fileoverview Pinecone source adapter for the migration engine.
 * @module rag/migration/adapters/PineconeSourceAdapter
 *
 * Reads vectors from Pinecone using the list + fetch API.
 * Non-vector data (knowledge graph, etc.) is not stored in Pinecone.
 */
import type { IMigrationSource } from '../types.js';
export declare class PineconeSourceAdapter implements IMigrationSource {
    private readonly indexHost;
    private readonly apiKey;
    private readonly namespace;
    constructor(indexHost: string, apiKey: string, namespace?: string);
    private _headers;
    /** Pinecone only stores vector data — returns single "table". */
    listTables(): Promise<string[]>;
    /** Count vectors via describe_index_stats. */
    countRows(_table: string): Promise<number>;
    /** Read vectors via list + fetch. Pinecone doesn't support offset-based pagination well. */
    readBatch(_table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=PineconeSourceAdapter.d.ts.map
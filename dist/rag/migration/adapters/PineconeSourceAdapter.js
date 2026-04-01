/**
 * @fileoverview Pinecone source adapter for the migration engine.
 * @module rag/migration/adapters/PineconeSourceAdapter
 *
 * Reads vectors from Pinecone using the list + fetch API.
 * Non-vector data (knowledge graph, etc.) is not stored in Pinecone.
 */
export class PineconeSourceAdapter {
    constructor(indexHost, apiKey, namespace = '') {
        this.indexHost = indexHost;
        this.apiKey = apiKey;
        this.namespace = namespace;
    }
    _headers() {
        return { 'Api-Key': this.apiKey, 'Content-Type': 'application/json' };
    }
    /** Pinecone only stores vector data — returns single "table". */
    async listTables() {
        return ['memory_traces'];
    }
    /** Count vectors via describe_index_stats. */
    async countRows(_table) {
        const res = await fetch(`${this.indexHost}/describe_index_stats`, {
            method: 'POST',
            headers: this._headers(),
            body: '{}',
        });
        if (!res.ok)
            return 0;
        const data = await res.json();
        if (this.namespace && data.namespaces?.[this.namespace]) {
            return data.namespaces[this.namespace].vectorCount ?? 0;
        }
        return data.totalVectorCount ?? 0;
    }
    /** Read vectors via list + fetch. Pinecone doesn't support offset-based pagination well. */
    async readBatch(_table, offset, limit) {
        // Use list endpoint to get IDs, then fetch to get vectors + metadata.
        const listRes = await fetch(`${this.indexHost}/vectors/list?namespace=${encodeURIComponent(this.namespace)}&limit=${limit}`, { headers: this._headers() });
        if (!listRes.ok)
            return [];
        const listData = await listRes.json();
        const ids = (listData.vectors ?? []).map(v => v.id);
        if (ids.length === 0)
            return [];
        // Fetch full vectors by ID.
        const fetchRes = await fetch(`${this.indexHost}/vectors/fetch`, {
            method: 'POST',
            headers: this._headers(),
            body: JSON.stringify({ ids, namespace: this.namespace }),
        });
        if (!fetchRes.ok)
            return [];
        const fetchData = await fetchRes.json();
        return Object.values(fetchData.vectors ?? {}).map(v => ({
            id: v.id,
            embedding: v.values,
            ...v.metadata,
        }));
    }
    async close() { }
}
//# sourceMappingURL=PineconeSourceAdapter.js.map
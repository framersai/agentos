/**
 * @fileoverview Pinecone Vector Store Implementation.
 * @module rag/vector_stores/PineconeVectorStore
 *
 * Implements `IVectorStore` using Pinecone's REST API via native `fetch`.
 * No SDK dependency — works in any runtime that supports fetch (Node 18+,
 * Deno, Bun, edge runtimes).
 *
 * Features:
 * - Dense vector upsert/query via Pinecone Data Plane API
 * - Metadata filtering via Pinecone's filter syntax
 * - Namespace-based collection isolation
 * - Serverless and pod-based index support
 *
 * Pinecone API docs: https://docs.pinecone.io/reference/api
 *
 * @see ../../IVectorStore.ts for the interface definition.
 */
// ---------------------------------------------------------------------------
// PineconeVectorStore
// ---------------------------------------------------------------------------
export class PineconeVectorStore {
    constructor(config) {
        this.isInitialized = false;
        this.config = config;
    }
    // =========================================================================
    // Lifecycle
    // =========================================================================
    /** Verify connectivity by calling the describe index stats endpoint. */
    async initialize() {
        if (this.isInitialized)
            return;
        // Ping the index to verify API key and host are correct.
        const res = await this._fetch('/describe_index_stats', { method: 'POST', body: '{}' });
        if (!res.ok) {
            const body = await res.text().catch(() => 'unknown error');
            throw new Error(`Pinecone initialization failed (${res.status}): ${body}`);
        }
        this.isInitialized = true;
    }
    /** No-op — Pinecone is cloud-managed. */
    async close() {
        this.isInitialized = false;
    }
    /** Gracefully shut down the store (alias for close). */
    async shutdown() {
        await this.close();
    }
    /** Health check — verify index is reachable (legacy). */
    async healthCheck() {
        try {
            const res = await this._fetch('/describe_index_stats', { method: 'POST', body: '{}' });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    /** IVectorStore-compliant health check. */
    async checkHealth() {
        const isHealthy = await this.healthCheck();
        return { isHealthy };
    }
    // =========================================================================
    // Collection Management (mapped to Pinecone namespaces)
    // =========================================================================
    /**
     * Create a "collection" — in Pinecone this maps to a namespace.
     * Namespaces are created implicitly on first upsert, so this is a no-op.
     */
    async createCollection(_name, _dimension, _options) {
        await this._ensureInit();
        // Pinecone namespaces are created implicitly. Nothing to do.
    }
    /**
     * Drop a "collection" — deletes all vectors in the namespace.
     */
    async dropCollection(name) {
        await this._ensureInit();
        const ns = name || this.config.namespace || '';
        await this._fetch('/vectors/delete', {
            method: 'POST',
            body: JSON.stringify({ deleteAll: true, namespace: ns }),
        });
    }
    // =========================================================================
    // Upsert
    // =========================================================================
    /**
     * Upsert vectors into Pinecone.
     * Batches automatically in chunks of 100 (Pinecone's max batch size).
     */
    async upsert(collectionName, documents, options) {
        await this._ensureInit();
        const ns = collectionName || this.config.namespace || '';
        const batchSize = 100; // Pinecone max vectors per upsert request.
        let successCount = 0;
        const failedIds = [];
        const sparseVectorsById = this._readSparseVectorsById(options?.customParams);
        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            const vectors = batch.map(doc => {
                const sparseValues = sparseVectorsById?.[doc.id];
                return {
                    id: doc.id,
                    values: doc.embedding,
                    sparse_values: sparseValues,
                    metadata: doc.metadata
                        ? this._flattenMetadata(doc.metadata)
                        : undefined,
                };
            });
            try {
                const res = await this._fetch('/vectors/upsert', {
                    method: 'POST',
                    body: JSON.stringify({ vectors, namespace: ns }),
                });
                if (res.ok) {
                    const data = await res.json();
                    successCount += data.upsertedCount ?? batch.length;
                }
                else {
                    failedIds.push(...batch.map(d => d.id));
                }
            }
            catch {
                failedIds.push(...batch.map(d => d.id));
            }
        }
        return {
            upsertedCount: successCount,
            upsertedIds: documents.map(d => d.id),
            failedCount: failedIds.length,
        };
    }
    // =========================================================================
    // Query
    // =========================================================================
    /**
     * Query for top-K nearest neighbors via Pinecone's query endpoint.
     * Supports metadata filtering via Pinecone's native filter syntax.
     */
    async query(collectionName, queryEmbedding, options) {
        await this._ensureInit();
        const ns = collectionName || this.config.namespace || '';
        const topK = options?.topK ?? 10;
        const body = {
            vector: queryEmbedding,
            topK,
            namespace: ns,
            includeMetadata: options?.includeMetadata !== false,
            includeValues: options?.includeEmbedding ?? false,
        };
        // Translate MetadataFilter to Pinecone's filter format.
        if (options?.filter) {
            body.filter = this._buildPineconeFilter(options.filter);
        }
        const res = await this._fetch('/query', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Pinecone query failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const documents = (data.matches ?? []).map(m => {
            const doc = {
                id: m.id,
                similarityScore: m.score ?? 0,
                embedding: m.values ?? [],
            };
            if (m.metadata && options?.includeMetadata !== false) {
                doc.metadata = m.metadata;
            }
            return doc;
        });
        return {
            documents,
            queryId: `pinecone-${Date.now()}`,
            stats: {
                totalCandidates: documents.length,
                filteredCandidates: documents.length,
                returnedCount: documents.length,
            },
        };
    }
    /**
     * Hybrid search is not natively supported by Pinecone in a single call.
     * Falls back to dense-only query. For true hybrid search, use Postgres
     * or Qdrant backends which support server-side RRF fusion.
     */
    async hybridSearch(collectionName, queryEmbedding, _queryText, options) {
        await this._ensureInit();
        const sparseVector = this._normalizeSparseVector(options?.customParams?.sparseVector ?? options?.customParams?.sparseValues);
        if (!sparseVector) {
            return this.query(collectionName, queryEmbedding, options);
        }
        const ns = collectionName || this.config.namespace || '';
        const topK = options?.topK ?? 10;
        const alphaRaw = typeof options?.alpha === 'number' ? options.alpha : 0.7;
        const alpha = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 0.7;
        const body = {
            vector: queryEmbedding.map((value) => value * alpha),
            sparseVector: {
                indices: sparseVector.indices,
                values: sparseVector.values.map((value) => value * (1 - alpha)),
            },
            topK,
            namespace: ns,
            includeMetadata: options?.includeMetadata !== false,
            includeValues: options?.includeEmbedding ?? false,
        };
        if (options?.filter) {
            body.filter = this._buildPineconeFilter(options.filter);
        }
        const res = await this._fetch('/query', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Pinecone query failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const documents = (data.matches ?? []).map(m => {
            const doc = {
                id: m.id,
                similarityScore: m.score ?? 0,
                embedding: m.values ?? [],
            };
            if (m.metadata && options?.includeMetadata !== false) {
                doc.metadata = m.metadata;
            }
            return doc;
        });
        return {
            documents,
            queryId: `pinecone-hybrid-${Date.now()}`,
            stats: {
                totalCandidates: documents.length,
                filteredCandidates: documents.length,
                returnedCount: documents.length,
                alpha,
            },
        };
    }
    // =========================================================================
    // Delete
    // =========================================================================
    /** Delete vectors by ID or delete all in namespace. */
    async delete(collectionName, ids, options) {
        await this._ensureInit();
        const ns = collectionName || this.config.namespace || '';
        if (options?.deleteAll) {
            await this._fetch('/vectors/delete', {
                method: 'POST',
                body: JSON.stringify({ deleteAll: true, namespace: ns }),
            });
            return { deletedCount: -1 }; // Pinecone doesn't return count on deleteAll.
        }
        if (ids && ids.length > 0) {
            // Pinecone supports up to 1000 IDs per delete.
            const batchSize = 1000;
            let deleted = 0;
            for (let i = 0; i < ids.length; i += batchSize) {
                const batch = ids.slice(i, i + batchSize);
                const res = await this._fetch('/vectors/delete', {
                    method: 'POST',
                    body: JSON.stringify({ ids: batch, namespace: ns }),
                });
                if (res.ok)
                    deleted += batch.length;
            }
            return { deletedCount: deleted };
        }
        return { deletedCount: 0 };
    }
    // =========================================================================
    // Internals
    // =========================================================================
    /** Ensure initialization before operations. */
    async _ensureInit() {
        if (!this.isInitialized)
            await this.initialize();
    }
    /**
     * Make a fetch request to the Pinecone Data Plane API.
     * Automatically sets Authorization header and Content-Type.
     */
    async _fetch(path, init) {
        const url = `${this.config.indexHost.replace(/\/+$/, '')}${path}`;
        return fetch(url, {
            method: init.method,
            headers: {
                'Api-Key': this.config.apiKey,
                'Content-Type': 'application/json',
            },
            body: init.body,
        });
    }
    /**
     * Flatten metadata to Pinecone-compatible format.
     * Pinecone metadata values must be string, number, boolean, or string[].
     * Complex objects are JSON-stringified.
     */
    _flattenMetadata(metadata) {
        const flat = {};
        for (const [key, val] of Object.entries(metadata)) {
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                flat[key] = val;
            }
            else if (Array.isArray(val)) {
                flat[key] = val.map(String);
            }
            else {
                flat[key] = JSON.stringify(val);
            }
        }
        return flat;
    }
    _normalizeSparseVector(input) {
        if (!input || typeof input !== 'object') {
            return undefined;
        }
        const candidate = input;
        const indices = Array.isArray(candidate.indices)
            ? candidate.indices.filter((value) => typeof value === 'number' && Number.isInteger(value))
            : [];
        const values = Array.isArray(candidate.values)
            ? candidate.values.filter((value) => typeof value === 'number' && Number.isFinite(value))
            : [];
        if (indices.length === 0 || indices.length !== values.length) {
            return undefined;
        }
        return { indices, values };
    }
    _readSparseVectorsById(customParams) {
        if (!customParams || typeof customParams !== 'object') {
            return undefined;
        }
        const source = customParams.sparseVectorsById;
        if (!source || typeof source !== 'object') {
            return undefined;
        }
        const parsedEntries = Object.entries(source)
            .map(([id, sparseVector]) => [id, this._normalizeSparseVector(sparseVector)])
            .filter((entry) => Boolean(entry[1]));
        return parsedEntries.length > 0 ? Object.fromEntries(parsedEntries) : undefined;
    }
    /**
     * Translate AgentOS MetadataFilter to Pinecone's filter format.
     *
     * Pinecone uses MongoDB-style operators:
     * `{ "field": { "$eq": "value" } }`
     *
     * @see https://docs.pinecone.io/guides/data/filter-with-metadata
     */
    _buildPineconeFilter(filter) {
        const conditions = [];
        for (const [field, condition] of Object.entries(filter)) {
            // Direct scalar match (implicit $eq).
            if (typeof condition !== 'object' || condition === null) {
                conditions.push({ [field]: { $eq: condition } });
                continue;
            }
            const cond = condition;
            const fieldConditions = {};
            if (cond.$eq !== undefined)
                fieldConditions.$eq = cond.$eq;
            if (cond.$ne !== undefined)
                fieldConditions.$ne = cond.$ne;
            if (cond.$gt !== undefined)
                fieldConditions.$gt = cond.$gt;
            if (cond.$gte !== undefined)
                fieldConditions.$gte = cond.$gte;
            if (cond.$lt !== undefined)
                fieldConditions.$lt = cond.$lt;
            if (cond.$lte !== undefined)
                fieldConditions.$lte = cond.$lte;
            if (cond.$in !== undefined)
                fieldConditions.$in = cond.$in;
            if (cond.$nin !== undefined)
                fieldConditions.$nin = cond.$nin;
            if (cond.$exists !== undefined)
                fieldConditions.$exists = cond.$exists;
            if (Object.keys(fieldConditions).length > 0) {
                conditions.push({ [field]: fieldConditions });
            }
        }
        // Pinecone requires $and for multiple conditions.
        if (conditions.length === 1)
            return conditions[0];
        return { $and: conditions };
    }
}
//# sourceMappingURL=PineconeVectorStore.js.map
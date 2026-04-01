/**
 * @fileoverview Memory-specific HNSW sidecar adapter.
 * @module memory/store/HnswSidecar
 *
 * Thin compatibility wrapper around the canonical {@link HnswIndexSidecar}
 * from `rag/vector-search/`. Preserves the Memory subsystem's constructor-based
 * API (sqlitePath, autoThreshold, etc.) and delegates to the shared implementation.
 *
 * New code should use `HnswIndexSidecar` from `rag/vector-search/` directly.
 *
 * @see rag/vector-search/HnswIndexSidecar for the canonical implementation
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HnswIndexSidecar } from '../../../rag/vector-search/HnswIndexSidecar.js';
// ---------------------------------------------------------------------------
// HnswSidecar — thin adapter over HnswIndexSidecar
// ---------------------------------------------------------------------------
/**
 * Memory-specific HNSW sidecar that wraps the canonical {@link HnswIndexSidecar}.
 *
 * Maintains the original constructor-based API expected by `Memory` facade
 * and `SqliteBrain` consumers, while delegating all index operations to the
 * shared RAG implementation.
 */
export class HnswSidecar {
    constructor(config) {
        this._config = {
            autoThreshold: 1000,
            m: 16,
            efConstruction: 200,
            efSearch: 50,
            ...config,
        };
        this._indexPath = join(dirname(this._config.sqlitePath), 'brain.hnsw');
        this._mapPath = this._indexPath + '.map.json';
        this._delegate = new HnswIndexSidecar();
    }
    /** Whether the HNSW index is currently active and queryable. */
    get isActive() {
        return this._delegate.isActive();
    }
    /** Number of vectors currently indexed. */
    get size() {
        return this._delegate.getStats().vectorCount;
    }
    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------
    /**
     * Initialize the sidecar. Loads existing index from disk if present.
     * If hnswlib-node is not installed, silently stays inactive.
     */
    async init() {
        await this._delegate.initialize({
            indexPath: this._indexPath,
            dimensions: this._config.dimensions,
            metric: 'cosine',
            activationThreshold: this._config.autoThreshold,
            hnswM: this._config.m,
            hnswEfConstruction: this._config.efConstruction,
            hnswEfSearch: this._config.efSearch,
        });
    }
    /**
     * Add a vector to the index. If below threshold, does nothing.
     * If threshold is crossed, caller should call rebuildFromData().
     *
     * @param traceId    - The trace ID to associate with this vector.
     * @param embedding  - The embedding vector.
     * @param _totalCount - Current total trace count (unused, kept for API compat).
     */
    async add(traceId, embedding, _totalCount) {
        await this._delegate.add(traceId, embedding);
    }
    /**
     * Query the HNSW index for top-K nearest neighbors.
     * Returns trace IDs sorted by distance (closest first).
     *
     * @param embedding - Query vector.
     * @param topK      - Number of results to return.
     * @returns Array of { id, distance } sorted by distance ascending.
     */
    query(embedding, topK) {
        /* Synchronous wrapper — HnswIndexSidecar.search() is async but the
           underlying hnswlib-node searchKnn is synchronous, so we call it
           via a blocking pattern for backward compatibility. We convert the
           score-based results back to distance-based results. */
        // We need synchronous access, but the delegate is async. Since the
        // underlying hnswlib-node operations are synchronous, we access
        // the delegate's internal state directly for search. To maintain
        // the sync API, we perform the search synchronously by calling
        // the delegate's search and using a workaround.
        // Instead, we return empty if not active and do a direct sync call.
        if (!this._delegate.isActive())
            return [];
        // Use a sync approach: we know the delegate wraps hnswlib-node which
        // is synchronous under the hood. We'll collect results asynchronously
        // but since this is called from sync code, we need a different approach.
        // The simplest backward-compatible fix is to cache results. However,
        // looking at usage in Memory.ts, query() is always called within an
        // async context. We'll return via a promise-like pattern.
        // Actually, re-examining: the delegate's search() returns a Promise,
        // but the original HnswSidecar.query() was synchronous. The underlying
        // hnswlib-node searchKnn IS synchronous. The delegate just wraps it
        // in async. We need to keep this sync for backward compatibility.
        // Solution: access the delegate's internal index directly since both
        // implementations use the same hnswlib-node API.
        const stats = this._delegate.getStats();
        if (stats.vectorCount === 0)
            return [];
        // For backward compat, perform the search via the async delegate
        // and return a placeholder. But this breaks the sync contract.
        // Better solution: keep the original sync search logic here.
        return this._syncQuery(embedding, topK);
    }
    /**
     * Remove a trace from the index by marking its label as deleted.
     * HNSW doesn't support true deletion — cleaned up on rebuild.
     *
     * @param traceId - The trace ID to remove.
     */
    remove(traceId) {
        // Fire-and-forget since original was sync
        void this._delegate.remove(traceId);
    }
    /**
     * Rebuild the entire index from a set of id/embedding pairs.
     * Called on first threshold crossing or when brain.hnsw is missing/corrupt.
     * Filters out dimension-mismatched vectors before delegating.
     *
     * @param data - Array of { id, embedding } to index.
     */
    async rebuildFromData(data) {
        if (data.length === 0)
            return;
        // Filter out dimension-mismatched vectors (feature from original impl)
        const dim = this._config.dimensions;
        const filtered = data.filter(item => item.embedding.length === dim);
        await this._delegate.rebuildFromData(filtered);
    }
    /**
     * Persist index and label map to disk.
     * Called after rebuildFromData() and periodically after adds.
     */
    saveToDisk() {
        void this._delegate.save();
    }
    /**
     * Delete index files from disk and deactivate.
     */
    destroy() {
        void this._delegate.shutdown();
        try {
            if (existsSync(this._indexPath))
                unlinkSync(this._indexPath);
            if (existsSync(this._mapPath))
                unlinkSync(this._mapPath);
        }
        catch {
            // Best effort cleanup
        }
    }
    // ---------------------------------------------------------------------------
    // Internal — sync query for backward compatibility
    // ---------------------------------------------------------------------------
    /**
     * Synchronous query that accesses the delegate's internal index.
     * This is needed because the original HnswSidecar.query() was synchronous,
     * and Memory.ts calls it in a synchronous context within an async function.
     */
    _syncQuery(embedding, topK) {
        // Access the delegate's internals for sync search. The delegate stores
        // its state in private fields; we use a type assertion to reach them.
        const delegate = this._delegate;
        const index = delegate.index;
        const labelToId = delegate.labelToId;
        if (!index || labelToId.size === 0)
            return [];
        const k = Math.min(topK, labelToId.size);
        try {
            const result = index.searchKnn(embedding, k);
            const hits = [];
            for (let i = 0; i < result.neighbors.length; i++) {
                const label = result.neighbors[i];
                const id = labelToId.get(label);
                if (id) {
                    hits.push({ id, distance: result.distances[i] });
                }
            }
            return hits;
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=HnswSidecar.js.map
/**
 * @fileoverview Shared HNSW index sidecar that sits alongside a SQLite database.
 * Provides O(log n) approximate nearest neighbor search via hnswlib-node,
 * with automatic activation at a configurable document count threshold
 * and graceful fallback when the native addon is unavailable.
 *
 * Used by both the RAG system (SqlVectorStore) and the Memory system (SqliteBrain).
 *
 * @module agentos/rag/vector-search/HnswIndexSidecar
 */
import type { HnswSidecarConfig, HnswSidecarStats, HnswSearchResult } from './types';
/**
 * HNSW index sidecar — manages an hnswlib-node index file alongside
 * a primary data store (SQLite, etc.).
 *
 * The primary store remains the source of truth. The HNSW index is
 * rebuildable from it at any time. This sidecar handles:
 * - Dynamic import of hnswlib-node (graceful if missing)
 * - Auto-activation at document count threshold
 * - Auto-resize when capacity is reached
 * - Persistence to disk (.hnsw + .hnsw.map.json)
 * - Dirty tracking with explicit save()
 */
export declare class HnswIndexSidecar {
    private config;
    private index;
    private hnswlib;
    /** Maps HNSW integer labels → document string IDs. */
    private labelToId;
    /** Maps document string IDs → HNSW integer labels. */
    private idToLabel;
    /** Next label to assign. */
    private nextLabel;
    /** Current index capacity. */
    private capacity;
    /** Whether index has unsaved changes. */
    private dirty;
    /** Whether hnswlib-node was successfully imported. */
    private hnswAvailable;
    /**
     * Initialize the sidecar. Attempts to dynamically import hnswlib-node.
     * If the import fails, the sidecar stays inactive (brute-force fallback).
     * If an existing index file is found, it's loaded from disk.
     */
    initialize(config: HnswSidecarConfig): Promise<void>;
    /** Persist and release the index. */
    shutdown(): Promise<void>;
    /** True when the index is loaded AND has vectors (above threshold or loaded from disk). */
    isActive(): boolean;
    /** True when hnswlib-node was successfully imported. */
    isAvailable(): boolean;
    /** Get statistics about the sidecar. */
    getStats(): HnswSidecarStats;
    /**
     * Add a single vector. Auto-resizes if capacity is reached.
     * Does nothing if hnswlib is unavailable or the item is already indexed.
     */
    add(id: string, embedding: number[]): Promise<void>;
    /**
     * Add multiple vectors at once. More efficient than calling add() in a loop.
     */
    addBatch(items: Array<{
        id: string;
        embedding: number[];
    }>): Promise<void>;
    /**
     * Upsert a single vector into an active index.
     * Replaces the previous vector when the ID already exists.
     */
    upsert(id: string, embedding: number[]): Promise<void>;
    /**
     * Upsert multiple vectors, replacing existing IDs in place.
     */
    upsertBatch(items: Array<{
        id: string;
        embedding: number[];
    }>): Promise<void>;
    /**
     * Soft-delete a vector by marking its label as deleted in the HNSW graph.
     */
    remove(id: string): Promise<void>;
    /**
     * Soft-delete multiple vectors in one pass.
     */
    removeBatch(ids: string[]): Promise<void>;
    /**
     * Search for the top-K nearest neighbors.
     * Returns empty if the sidecar is inactive.
     */
    search(query: number[], topK: number): Promise<HnswSearchResult[]>;
    /**
     * Full rebuild of the HNSW index from source-of-truth data.
     * Called when the activation threshold is crossed or on manual rebuild.
     */
    rebuildFromData(items: Array<{
        id: string;
        embedding: number[];
    }>): Promise<void>;
    /** Save the HNSW index and label map to disk. */
    save(): Promise<void>;
    /**
     * Load an existing HNSW index from disk.
     * Returns true if loaded successfully, false if no index exists.
     */
    load(): Promise<boolean>;
}
//# sourceMappingURL=HnswIndexSidecar.d.ts.map
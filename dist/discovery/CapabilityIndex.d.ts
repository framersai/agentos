/**
 * @fileoverview Capability Index — vector index over all capabilities.
 * @module @framers/agentos/discovery/CapabilityIndex
 *
 * Normalizes tools, skills, extensions, and channels into unified
 * CapabilityDescriptor objects, embeds them, and stores them in a
 * vector index for semantic search.
 *
 * Reuses existing infrastructure:
 * - IEmbeddingManager for embedding generation (with LRU cache)
 * - IVectorStore for vector storage (InMemory, HNSW, Qdrant, SQL)
 *
 * Performance targets:
 * - Index build: ~3s for ~100 capabilities (one-time, embedding API calls)
 * - Search: <1ms HNSW lookup + ~50ms embedding cold / <5ms warm
 */
import type { IEmbeddingManager } from '../core/embeddings/IEmbeddingManager.js';
import type { IVectorStore } from '../core/vector-store/IVectorStore.js';
import type { CapabilityDescriptor, CapabilityKind, CapabilitySearchResult, CapabilityIndexSources } from './types.js';
import { CapabilityEmbeddingStrategy } from './CapabilityEmbeddingStrategy.js';
export declare class CapabilityIndex {
    private readonly embeddingManager;
    private readonly vectorStore;
    private readonly collectionName;
    private readonly embeddingModelId?;
    private readonly descriptors;
    private readonly embeddingStrategy;
    private built;
    constructor(embeddingManager: IEmbeddingManager, vectorStore: IVectorStore, collectionName: string, embeddingModelId?: string | undefined);
    /**
     * Build the index from all capability sources.
     * Normalizes sources into CapabilityDescriptors, embeds them, and stores
     * in the vector store.
     */
    buildIndex(sources: CapabilityIndexSources): Promise<void>;
    /**
     * Incrementally add or update a single capability.
     */
    upsertCapability(cap: CapabilityDescriptor): Promise<void>;
    /**
     * Remove a capability from the index.
     */
    removeCapability(id: string): Promise<void>;
    /**
     * Semantic search for capabilities matching a query.
     *
     * @param query - Natural language query (e.g., "search the web for news")
     * @param topK - Number of results to return
     * @param filters - Optional filters by kind, category, availability
     */
    search(query: string, topK: number, filters?: {
        kind?: CapabilityKind | 'any';
        category?: string;
        onlyAvailable?: boolean;
        excludedCapabilityIds?: string[];
    }): Promise<CapabilitySearchResult[]>;
    /**
     * Get a capability by ID.
     */
    getCapability(id: string): CapabilityDescriptor | undefined;
    /**
     * Get all registered capabilities.
     */
    getAllCapabilities(): CapabilityDescriptor[];
    /**
     * Get all capability IDs.
     */
    listIds(): string[];
    /**
     * Get capabilities grouped by category.
     */
    getByCategory(): Map<string, CapabilityDescriptor[]>;
    /**
     * Whether the index has been built.
     */
    isBuilt(): boolean;
    /**
     * Number of indexed capabilities.
     */
    size(): number;
    /**
     * Get the embedding strategy (for external use by assembler).
     */
    getEmbeddingStrategy(): CapabilityEmbeddingStrategy;
    /**
     * Normalize all sources into CapabilityDescriptor objects.
     */
    normalizeSources(sources: CapabilityIndexSources): CapabilityDescriptor[];
    private normalizeToolSource;
    private normalizeSkillSource;
    private normalizeExtensionSource;
    private normalizeChannelSource;
}
//# sourceMappingURL=CapabilityIndex.d.ts.map
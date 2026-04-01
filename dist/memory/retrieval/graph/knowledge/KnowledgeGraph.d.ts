/**
 * @file KnowledgeGraph.ts
 * @description In-memory implementation of the Knowledge Graph.
 * Provides entity-relationship storage, episodic memory, and semantic search.
 *
 * @module AgentOS/Knowledge
 * @version 1.0.0
 */
import type { IKnowledgeGraph, KnowledgeEntity, KnowledgeRelation, EpisodicMemory, EntityId, RelationId, EntityType, RelationType, KnowledgeQueryOptions, TraversalOptions, TraversalResult, SemanticSearchOptions, SemanticSearchResult, KnowledgeGraphStats } from './IKnowledgeGraph';
import type { ILogger } from '../../../../core/logging/ILogger';
import type { IEmbeddingManager } from '../../../../core/embeddings/IEmbeddingManager';
/**
 * Configuration for KnowledgeGraph
 */
export interface KnowledgeGraphConfig {
    /** Embedding manager for semantic search */
    embeddingManager?: IEmbeddingManager;
    /** Logger instance */
    logger?: ILogger;
    /** Memory decay rate per day (0-1) */
    memoryDecayRate?: number;
    /** Minimum importance to retain memories */
    minImportanceThreshold?: number;
}
/**
 * In-memory Knowledge Graph implementation
 */
export declare class KnowledgeGraph implements IKnowledgeGraph {
    private readonly entities;
    private readonly relations;
    private readonly memories;
    private readonly entityByType;
    private readonly relationsBySource;
    private readonly relationsByTarget;
    private readonly entitiesByOwner;
    private readonly embeddingManager?;
    private readonly logger?;
    private readonly memoryDecayRate;
    private readonly minImportanceThreshold;
    constructor(config?: KnowledgeGraphConfig);
    initialize(): Promise<void>;
    upsertEntity(entityInput: Omit<KnowledgeEntity, 'id' | 'createdAt' | 'updatedAt'> & {
        id?: EntityId;
    }): Promise<KnowledgeEntity>;
    getEntity(id: EntityId): Promise<KnowledgeEntity | undefined>;
    queryEntities(options?: KnowledgeQueryOptions): Promise<KnowledgeEntity[]>;
    deleteEntity(id: EntityId): Promise<boolean>;
    upsertRelation(relationInput: Omit<KnowledgeRelation, 'id' | 'createdAt'> & {
        id?: RelationId;
    }): Promise<KnowledgeRelation>;
    getRelations(entityId: EntityId, options?: {
        direction?: 'outgoing' | 'incoming' | 'both';
        types?: RelationType[];
    }): Promise<KnowledgeRelation[]>;
    deleteRelation(id: RelationId): Promise<boolean>;
    recordMemory(memoryInput: Omit<EpisodicMemory, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt'>): Promise<EpisodicMemory>;
    getMemory(id: string): Promise<EpisodicMemory | undefined>;
    queryMemories(options?: {
        types?: EpisodicMemory['type'][];
        participants?: string[];
        minImportance?: number;
        timeRange?: {
            from?: string;
            to?: string;
        };
        limit?: number;
    }): Promise<EpisodicMemory[]>;
    recallMemories(query: string, topK?: number): Promise<EpisodicMemory[]>;
    traverse(startEntityId: EntityId, options?: TraversalOptions): Promise<TraversalResult>;
    findPath(sourceId: EntityId, targetId: EntityId, maxDepth?: number): Promise<Array<{
        entity: KnowledgeEntity;
        relation?: KnowledgeRelation;
    }> | null>;
    getNeighborhood(entityId: EntityId, depth?: number): Promise<{
        entities: KnowledgeEntity[];
        relations: KnowledgeRelation[];
    }>;
    semanticSearch(options: SemanticSearchOptions): Promise<SemanticSearchResult[]>;
    private textBasedSearch;
    extractFromText(text: string, options?: {
        extractRelations?: boolean;
        entityTypes?: EntityType[];
    }): Promise<{
        entities: KnowledgeEntity[];
        relations: KnowledgeRelation[];
    }>;
    mergeEntities(entityIds: EntityId[], primaryId: EntityId): Promise<KnowledgeEntity>;
    decayMemories(decayFactor?: number): Promise<number>;
    getStats(): Promise<KnowledgeGraphStats>;
    clear(): Promise<void>;
    private cosineSimilarity;
}
//# sourceMappingURL=KnowledgeGraph.d.ts.map
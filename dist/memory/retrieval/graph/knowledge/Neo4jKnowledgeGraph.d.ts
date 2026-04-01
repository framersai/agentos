/**
 * @fileoverview Neo4j-backed Knowledge Graph implementation.
 *
 * Implements `IKnowledgeGraph` using Neo4j for persistent entity/relation/memory
 * storage with native Cypher traversal, shortest path, and vector index-based
 * semantic search.
 *
 * Features:
 * - Persistent entity/relation storage via Neo4j
 * - Native BFS traversal and shortest path via Cypher variable-length paths
 * - Vector indexes on KnowledgeEntity.embedding and EpisodicMemory.embedding
 * - Dynamic relationship types via APOC merge.relationship
 * - Memory decay via Cypher-based exponential formula
 * - Shared Neo4jConnectionManager for connection pooling
 *
 * @module @framers/agentos/knowledge/Neo4jKnowledgeGraph
 * @see ./IKnowledgeGraph.ts for the interface definition.
 */
import type { IKnowledgeGraph, KnowledgeEntity, KnowledgeRelation, EpisodicMemory, EntityId, RelationId, EntityType, RelationType, KnowledgeQueryOptions, TraversalOptions, TraversalResult, SemanticSearchOptions, SemanticSearchResult, KnowledgeGraphStats } from './IKnowledgeGraph.js';
import type { Neo4jConnectionManager } from '../neo4j/Neo4jConnectionManager.js';
export interface Neo4jKnowledgeGraphConfig {
    connectionManager: Neo4jConnectionManager;
    embeddingDimension?: number;
    memoryDecayRate?: number;
    minImportanceThreshold?: number;
}
export declare class Neo4jKnowledgeGraph implements IKnowledgeGraph {
    private config;
    private cypher;
    private embeddingDimension;
    private memoryDecayRate;
    private minImportanceThreshold;
    constructor(config: Neo4jKnowledgeGraphConfig);
    initialize(): Promise<void>;
    upsertEntity(entity: Omit<KnowledgeEntity, 'id' | 'createdAt' | 'updatedAt'> & {
        id?: EntityId;
    }): Promise<KnowledgeEntity>;
    getEntity(id: EntityId): Promise<KnowledgeEntity | undefined>;
    queryEntities(options?: KnowledgeQueryOptions): Promise<KnowledgeEntity[]>;
    deleteEntity(id: EntityId): Promise<boolean>;
    upsertRelation(relation: Omit<KnowledgeRelation, 'id' | 'createdAt'> & {
        id?: RelationId;
    }): Promise<KnowledgeRelation>;
    getRelations(entityId: EntityId, options?: {
        direction?: 'outgoing' | 'incoming' | 'both';
        types?: RelationType[];
    }): Promise<KnowledgeRelation[]>;
    deleteRelation(id: RelationId): Promise<boolean>;
    recordMemory(memory: Omit<EpisodicMemory, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt'>): Promise<EpisodicMemory>;
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
    extractFromText(_text: string, _options?: {
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
    private nodeToEntity;
    private nodeToMemory;
    private relToKnowledgeRelation;
    private relPropsToKnowledgeRelation;
    private safeParseJson;
}
//# sourceMappingURL=Neo4jKnowledgeGraph.d.ts.map
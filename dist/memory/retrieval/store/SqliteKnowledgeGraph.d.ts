/**
 * @fileoverview SQLite-backed implementation of IKnowledgeGraph.
 *
 * Persists knowledge entities (nodes), relations (edges), and episodic memories
 * to the `knowledge_nodes` and `knowledge_edges` tables managed by SqliteBrain.
 *
 * Uses the async StorageAdapter API exposed by SqliteBrain (run/get/all/exec/
 * transaction) rather than direct better-sqlite3 access.
 *
 * Episodic memories are stored as knowledge_nodes with `type = 'memory'` and
 * their memory-specific fields packed into the `properties` JSON column.
 *
 * Graph traversal (BFS/DFS, shortest path, neighbourhood) is implemented via
 * SQLite recursive Common Table Expressions (CTEs).
 *
 * Semantic search loads embeddings from BLOB columns and computes cosine
 * similarity in-process — no external vector DB needed for the SQLite path.
 *
 * @module memory/store/SqliteKnowledgeGraph
 */
import type { IKnowledgeGraph, KnowledgeEntity, KnowledgeRelation, EpisodicMemory, EntityId, RelationId, EntityType, RelationType, KnowledgeQueryOptions, TraversalOptions, TraversalResult, SemanticSearchOptions, SemanticSearchResult, KnowledgeGraphStats } from '../graph/knowledge/IKnowledgeGraph.js';
import type { SqliteBrain } from './SqliteBrain.js';
/**
 * Persistent knowledge graph backed by SQLite via SqliteBrain.
 *
 * Implements the full `IKnowledgeGraph` interface using the `knowledge_nodes`
 * and `knowledge_edges` tables. Extended entity/relation fields that don't
 * have dedicated columns are serialized into the JSON `properties` / `metadata`
 * columns.
 *
 * @example
 * ```ts
 * const brain = await SqliteBrain.open('/tmp/agent-brain.sqlite');
 * const graph = new SqliteKnowledgeGraph(brain);
 * await graph.initialize();
 *
 * const entity = await graph.upsertEntity({
 *   type: 'person',
 *   label: 'Alice',
 *   properties: { role: 'engineer' },
 *   confidence: 0.95,
 *   source: { type: 'user_input', timestamp: new Date().toISOString() },
 * });
 * ```
 */
export declare class SqliteKnowledgeGraph implements IKnowledgeGraph {
    /** The shared SQLite brain instance. */
    private readonly brain;
    /**
     * @param brain - A SqliteBrain instance whose async StorageAdapter methods
     *                are used for all queries.
     */
    constructor(brain: SqliteBrain);
    /**
     * Initialize the knowledge graph.
     *
     * The schema is already created by SqliteBrain's constructor, so this is
     * effectively a no-op. Provided to satisfy the IKnowledgeGraph contract.
     */
    initialize(): Promise<void>;
    /**
     * Insert or update a knowledge entity.
     *
     * If `entity.id` is provided and exists, the row is updated (INSERT OR REPLACE).
     * If omitted, a new UUID is generated.
     *
     * Extended fields (ownerId, tags, metadata, updatedAt) are packed into the
     * `properties` JSON column as underscore-prefixed keys to avoid collisions
     * with user-supplied properties.
     */
    upsertEntity(entity: Omit<KnowledgeEntity, 'id' | 'createdAt' | 'updatedAt'> & {
        id?: EntityId;
    }): Promise<KnowledgeEntity>;
    /**
     * Retrieve a single entity by its ID.
     * Returns `undefined` if the entity does not exist.
     */
    getEntity(id: EntityId): Promise<KnowledgeEntity | undefined>;
    /**
     * Query entities with optional filters.
     *
     * Supports filtering by entity type, tags, owner, minimum confidence,
     * full-text search, pagination (limit/offset), and time ranges.
     */
    queryEntities(options?: KnowledgeQueryOptions): Promise<KnowledgeEntity[]>;
    /**
     * Delete an entity and all its associated relations (incoming and outgoing).
     * Returns `true` if the entity existed and was deleted.
     */
    deleteEntity(id: EntityId): Promise<boolean>;
    /**
     * Insert or update a knowledge relation (edge).
     *
     * Extended edge fields (label, properties, confidence, source, validFrom,
     * validTo) are packed into the `metadata` JSON column.
     */
    upsertRelation(relation: Omit<KnowledgeRelation, 'id' | 'createdAt'> & {
        id?: RelationId;
    }): Promise<KnowledgeRelation>;
    /**
     * Get all relations for a given entity.
     *
     * @param entityId - The entity whose relations to retrieve.
     * @param options  - Optional filters: direction ('outgoing'|'incoming'|'both'), types.
     */
    getRelations(entityId: EntityId, options?: {
        direction?: 'outgoing' | 'incoming' | 'both';
        types?: RelationType[];
    }): Promise<KnowledgeRelation[]>;
    /**
     * Delete a single relation by its ID.
     * Returns `true` if the relation existed and was deleted.
     */
    deleteRelation(id: RelationId): Promise<boolean>;
    /**
     * Record an episodic memory.
     *
     * Memories are stored as knowledge_nodes with `type = 'memory'`. The
     * memory-specific fields are packed into the `properties` JSON column.
     */
    recordMemory(memory: Omit<EpisodicMemory, 'id' | 'createdAt' | 'accessCount' | 'lastAccessedAt'>): Promise<EpisodicMemory>;
    /**
     * Get an episodic memory by ID.
     *
     * Looks up the knowledge_node with the given ID and `type = 'memory'`,
     * then unpacks the memory-specific fields from the `properties` JSON.
     */
    getMemory(id: string): Promise<EpisodicMemory | undefined>;
    /**
     * Query episodic memories with optional filters.
     *
     * Supports filtering by memory sub-type, participants, minimum importance,
     * time range, and result limit.
     */
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
    /**
     * Recall relevant memories via keyword search against summaries.
     *
     * Performs a case-insensitive substring match on the label (which contains
     * the summary text). Increments accessCount and updates lastAccessedAt for
     * each returned memory (Hebbian reinforcement).
     *
     * Full semantic (embedding-based) recall requires the Memory facade.
     */
    recallMemories(query: string, topK?: number): Promise<EpisodicMemory[]>;
    /**
     * Traverse the graph from a starting entity using BFS.
     *
     * Uses a recursive CTE (Common Table Expression) to walk the graph up to
     * `maxDepth` hops from the start node. Results are grouped by depth level.
     *
     * @param startEntityId - ID of the entity to start traversal from.
     * @param options       - Optional: maxDepth, relationTypes, direction, minWeight, maxNodes.
     */
    traverse(startEntityId: EntityId, options?: TraversalOptions): Promise<TraversalResult>;
    /**
     * Find the shortest path between two entities using a bidirectional BFS
     * implemented via a recursive CTE.
     *
     * Returns an ordered array of `{ entity, relation? }` steps from source to
     * target, or `null` if no path exists within `maxDepth` hops.
     */
    findPath(sourceId: EntityId, targetId: EntityId, maxDepth?: number): Promise<Array<{
        entity: KnowledgeEntity;
        relation?: KnowledgeRelation;
    }> | null>;
    /**
     * Get the neighbourhood of an entity — all entities and relations within
     * `depth` hops.
     *
     * @param entityId - Centre entity.
     * @param depth    - Maximum number of hops (default 1).
     */
    getNeighborhood(entityId: EntityId, depth?: number): Promise<{
        entities: KnowledgeEntity[];
        relations: KnowledgeRelation[];
    }>;
    /**
     * Semantic search across entities and/or memories.
     *
     * Loads all embeddings from `knowledge_nodes`, computes cosine similarity
     * against the query embedding (if present in `options`), and returns the
     * top-K results above the minimum similarity threshold.
     *
     * NOTE: This implementation requires the caller to provide a query embedding
     * via a pre-processing step. If no nodes have embeddings, an empty array is
     * returned. For full text-to-embedding semantic search, use the Memory facade.
     */
    semanticSearch(options: SemanticSearchOptions): Promise<SemanticSearchResult[]>;
    /**
     * Extract entities and relations from text.
     *
     * This operation requires an LLM and is not supported at the store level.
     * Use the Memory facade for LLM-powered extraction.
     *
     * @throws {Error} Always — extraction requires an LLM.
     */
    extractFromText(_text: string, _options?: {
        extractRelations?: boolean;
        entityTypes?: EntityType[];
    }): Promise<{
        entities: KnowledgeEntity[];
        relations: KnowledgeRelation[];
    }>;
    /**
     * Merge multiple entities into one primary entity.
     *
     * All relations (edges) pointing to or from the non-primary entities are
     * re-linked to the primary entity. The non-primary entities are then deleted.
     *
     * @param entityIds - All entity IDs involved in the merge.
     * @param primaryId - The ID that survives the merge.
     */
    mergeEntities(entityIds: EntityId[], primaryId: EntityId): Promise<KnowledgeEntity>;
    /**
     * Decay the confidence of all memory-type nodes by a multiplicative factor.
     *
     * This simulates the Ebbinghaus forgetting curve — memories that are not
     * accessed (reinforced) gradually fade.
     *
     * @param decayFactor - Multiplicative factor in (0, 1). Default 0.95.
     * @returns The number of memory nodes whose confidence was reduced.
     */
    decayMemories(decayFactor?: number): Promise<number>;
    /**
     * Get aggregate statistics about the knowledge graph.
     *
     * Returns counts of entities, relations, memories, breakdowns by type,
     * average confidence, and oldest/newest entry timestamps.
     */
    getStats(): Promise<KnowledgeGraphStats>;
    /**
     * Delete all rows from knowledge_nodes and knowledge_edges.
     * Wipes the knowledge graph completely.
     */
    clear(): Promise<void>;
    /**
     * Convert a raw `knowledge_nodes` row into a `KnowledgeEntity` domain object.
     * Unpacks extended fields from the `properties` JSON column.
     */
    private _rowToEntity;
    /**
     * Convert a raw `knowledge_edges` row into a `KnowledgeRelation` domain object.
     * Unpacks extended fields from the `metadata` JSON column.
     */
    private _rowToRelation;
    /**
     * Convert a raw `knowledge_nodes` row (with `type = 'memory'`) into an
     * `EpisodicMemory` domain object. Unpacks memory-specific fields from the
     * `properties` JSON column.
     */
    private _rowToMemory;
}
//# sourceMappingURL=SqliteKnowledgeGraph.d.ts.map
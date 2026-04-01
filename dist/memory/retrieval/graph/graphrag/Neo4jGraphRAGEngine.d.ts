/**
 * @fileoverview Neo4j-backed GraphRAG engine for AgentOS.
 *
 * Implements `IGraphRAGEngine` using Neo4j for persistent entity/relationship/community
 * storage, native HNSW vector indexes for entity/community semantic search, and
 * GDS Louvain for community detection (with client-side graphology fallback).
 *
 * The entity extraction pipeline (LLM or pattern-based) is delegated to the caller
 * or reused from the existing GraphRAGEngine's extraction utilities.
 *
 * Features:
 * - Persistent graph storage in Neo4j
 * - Native vector indexes on entity/community embeddings
 * - GDS Louvain community detection (falls back to graphology if GDS unavailable)
 * - Document contribution tracking for safe re-ingestion
 * - Global search (community summaries) and local search (entity + 1-hop expansion)
 * - Shared Neo4jConnectionManager for connection pooling
 *
 * @module @framers/agentos/rag/graphrag/Neo4jGraphRAGEngine
 * @see ./IGraphRAG.ts for the interface definition.
 */
import type { IGraphRAGEngine, GraphRAGConfig, GraphEntity, GraphRelationship, GraphCommunity, GraphRAGSearchOptions, GlobalSearchResult, LocalSearchResult } from './IGraphRAG.js';
import type { MetadataValue } from '../../../../core/vector-store/IVectorStore.js';
import type { Neo4jConnectionManager } from '../neo4j/Neo4jConnectionManager.js';
interface LLMProvider {
    generateText(prompt: string, options?: {
        maxTokens?: number;
        temperature?: number;
    }): Promise<string>;
}
export interface Neo4jGraphRAGEngineDeps {
    connectionManager: Neo4jConnectionManager;
    embeddingManager?: {
        generateEmbeddings(input: {
            texts: string | string[];
        }): Promise<{
            embeddings: number[][];
        }>;
    };
    llmProvider?: LLMProvider;
}
export declare class Neo4jGraphRAGEngine implements IGraphRAGEngine {
    private deps;
    private config;
    private cypher;
    private embeddingDimension;
    private _isInitialized;
    constructor(deps: Neo4jGraphRAGEngineDeps);
    initialize(config: GraphRAGConfig): Promise<void>;
    ingestDocuments(documents: Array<{
        id: string;
        content: string;
        metadata?: Record<string, MetadataValue>;
    }>): Promise<{
        entitiesExtracted: number;
        relationshipsExtracted: number;
        communitiesDetected: number;
        documentsProcessed: number;
    }>;
    removeDocuments(documentIds: string[]): Promise<{
        documentsRemoved: number;
        communitiesDetected: number;
    }>;
    globalSearch(query: string, options?: GraphRAGSearchOptions): Promise<GlobalSearchResult>;
    localSearch(query: string, options?: GraphRAGSearchOptions): Promise<LocalSearchResult>;
    getEntities(options?: {
        type?: string;
        limit?: number;
    }): Promise<GraphEntity[]>;
    getRelationships(entityId: string): Promise<GraphRelationship[]>;
    getCommunities(level?: number): Promise<GraphCommunity[]>;
    getStats(): Promise<{
        totalEntities: number;
        totalRelationships: number;
        totalCommunities: number;
        communityLevels: number;
        documentsIngested: number;
    }>;
    clear(): Promise<void>;
    shutdown(): Promise<void>;
    private detectCommunities;
    private detectCommunitiesGDS;
    private detectCommunitiesClientSide;
    private storeCommunities;
    private extractEntitiesAndRelationships;
    private extractViaLLM;
    private extractViaPatterns;
    private generateEntityEmbeddings;
    private nodeToGraphEntity;
    private nodeToCommunity;
    private safeParseJson;
    private simpleHash;
}
export {};
//# sourceMappingURL=Neo4jGraphRAGEngine.d.ts.map
/**
 * @file GraphRAGEngine.ts
 * @description TypeScript-native GraphRAG engine for AgentOS.
 * Implements entity extraction, graph construction, Louvain community detection,
 * community summarization, and global/local search -- all without Python.
 *
 * Uses:
 * - graphology for graph data structure
 * - graphology-communities-louvain for community detection
 * - IVectorStore (hnswlib or sql) for embedding search
 * - IEmbeddingManager for embeddings
 * - sql-storage-adapter for persistence
 *
 * @module AgentOS/RAG/GraphRAG
 * @version 1.0.0
 */
import type { IGraphRAGEngine, GraphRAGConfig, GraphEntity, GraphRelationship, GraphCommunity, GraphRAGSearchOptions, GlobalSearchResult, LocalSearchResult } from './IGraphRAG.js';
import type { IVectorStore, MetadataValue } from '../../../../core/vector-store/IVectorStore.js';
import type { IEmbeddingManager } from '../../../../core/embeddings/IEmbeddingManager.js';
interface LLMProvider {
    generateText(prompt: string, options?: {
        maxTokens?: number;
        temperature?: number;
    }): Promise<string>;
}
interface PersistenceAdapter {
    exec(script: string): Promise<void>;
    run(statement: string, parameters?: any[]): Promise<{
        changes: number;
    }>;
    all<T = unknown>(statement: string, parameters?: any[]): Promise<T[]>;
    get<T = unknown>(statement: string, parameters?: any[]): Promise<T | null>;
}
export declare class GraphRAGEngine implements IGraphRAGEngine {
    private config;
    private isInitialized;
    private entities;
    private relationships;
    private communities;
    private ingestedDocumentIds;
    private ingestedDocumentHashes;
    private documentEntityContributions;
    private documentRelationshipContributions;
    private graph;
    private vectorStore?;
    private embeddingManager?;
    private llmProvider?;
    private persistenceAdapter?;
    private tablePrefix;
    constructor(deps?: {
        vectorStore?: IVectorStore;
        embeddingManager?: IEmbeddingManager;
        llmProvider?: LLMProvider;
        persistenceAdapter?: PersistenceAdapter;
    });
    private resolveEmbeddingDimension;
    private hashDocumentContent;
    initialize(config: GraphRAGConfig): Promise<void>;
    private ensureInitialized;
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
    private extractEntitiesAndRelationships;
    private llmExtract;
    private patternExtract;
    private extractSentenceContext;
    private countOccurrences;
    private mergeEntity;
    private mergeRelationship;
    private generateEntityEmbeddings;
    private detectCommunities;
    private buildCommunityHierarchy;
    private generateCommunitySummaries;
    private summarizeCommunity;
    private extractFindings;
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
    private createPersistenceSchema;
    private loadFromPersistence;
    private persistAll;
    private recomputeEntityAggregates;
    private recomputeRelationshipAggregates;
    private hydrateDocumentContributionsFromPersistence;
    private removeDocumentContributions;
}
export {};
//# sourceMappingURL=GraphRAGEngine.d.ts.map
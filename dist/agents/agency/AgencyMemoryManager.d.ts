/**
 * @file AgencyMemoryManager.ts
 * @description Manages shared RAG memory for Agency (multi-GMI) collectives.
 * Enables GMIs within an agency to share context, collaborate effectively,
 * and maintain collective memory across conversations.
 *
 * @module AgentOS/Agency
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const memoryManager = new AgencyMemoryManager(vectorStoreManager, logger);
 *
 * // Initialize shared memory for an agency
 * await memoryManager.initializeAgencyMemory(agencySession);
 *
 * // Ingest document to shared memory
 * await memoryManager.ingestToSharedMemory(agencyId, {
 *   content: 'Important context from GMI-1',
 *   contributorGmiId: 'gmi-1',
 *   contributorRoleId: 'researcher',
 * });
 *
 * // Query shared memory
 * const results = await memoryManager.querySharedMemory(agencyId, {
 *   query: 'What did the researcher find?',
 *   requestingGmiId: 'gmi-2',
 *   requestingRoleId: 'analyst',
 * });
 * ```
 */
import type { ILogger } from '../../logging/ILogger';
import type { IVectorStoreManager } from '../../core/vector-store/IVectorStoreManager';
import type { AgencySession, AgencyMemoryConfig, AgencyMemoryOperationResult, AgencyMemoryQueryOptions } from './AgencyTypes';
/**
 * Input for ingesting documents to agency shared memory.
 */
export interface AgencyMemoryIngestInput {
    /** Document content */
    content: string;
    /** GMI that contributed this content */
    contributorGmiId: string;
    /** Role of the contributing GMI */
    contributorRoleId: string;
    /** Document category */
    category?: 'communication' | 'finding' | 'decision' | 'summary' | 'context';
    /** Additional metadata */
    metadata?: Record<string, unknown>;
    /** Optional pre-computed embedding */
    embedding?: number[];
}
/**
 * Retrieved chunk from agency shared memory.
 */
export interface AgencyMemoryChunk {
    /** Chunk ID */
    chunkId: string;
    /** Document ID */
    documentId: string;
    /** Content text */
    content: string;
    /** Similarity score */
    score: number;
    /** Contributing GMI */
    contributorGmiId: string;
    /** Contributing role */
    contributorRoleId: string;
    /** Document category */
    category: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Result of querying agency shared memory.
 */
export interface AgencyMemoryQueryResult {
    /** Whether query succeeded */
    success: boolean;
    /** Retrieved chunks */
    chunks: AgencyMemoryChunk[];
    /** Total matching results */
    totalResults: number;
    /** Query processing time in ms */
    processingTimeMs: number;
    /** Error message if failed */
    error?: string;
}
/**
 * Statistics for agency memory.
 */
export interface AgencyMemoryStats {
    /** Total documents in shared memory */
    totalDocuments: number;
    /** Total chunks */
    totalChunks: number;
    /** Documents by role */
    documentsByRole: Record<string, number>;
    /** Documents by category */
    documentsByCategory: Record<string, number>;
    /** Last ingestion timestamp */
    lastIngestionAt?: string;
}
/**
 * Manages shared RAG memory for Agency collectives.
 *
 * @remarks
 * This manager provides:
 * - Initialization of dedicated data sources for agencies
 * - Ingestion with role-based access control
 * - Cross-GMI context queries with permission checks
 * - Memory lifecycle management (retention, eviction)
 *
 * Architecture:
 * ```
 * AgencyMemoryManager
 *         │
 *         ├─► VectorStoreManager (storage backend)
 *         │
 *         ├─► AgencyRegistry (session state)
 *         │
 *         └─► Per-Agency Collections
 *              └─► agency-{agencyId}-shared
 * ```
 */
export declare class AgencyMemoryManager {
    private readonly vectorStoreManager;
    private readonly logger?;
    /** Collection name prefix for agency shared memory */
    private static readonly COLLECTION_PREFIX;
    /** Default memory configuration */
    private static readonly DEFAULT_CONFIG;
    /** Tracks initialized agencies */
    private readonly initializedAgencies;
    /**
     * Creates a new AgencyMemoryManager instance.
     *
     * @param vectorStoreManager - Vector store manager for RAG operations
     * @param logger - Optional logger for diagnostics
     */
    constructor(vectorStoreManager: IVectorStoreManager | null, logger?: ILogger | undefined);
    /**
     * Initializes shared memory for an agency.
     * Creates dedicated collection and applies configuration.
     *
     * @param session - Agency session to initialize memory for
     * @returns Operation result
     */
    initializeAgencyMemory(session: AgencySession): Promise<AgencyMemoryOperationResult>;
    /**
     * Ingests a document to agency shared memory.
     *
     * @param agencyId - Target agency
     * @param input - Document to ingest
     * @param config - Agency memory configuration
     * @returns Operation result
     */
    ingestToSharedMemory(agencyId: string, input: AgencyMemoryIngestInput, config?: AgencyMemoryConfig): Promise<AgencyMemoryOperationResult>;
    /**
     * Queries agency shared memory.
     *
     * @param agencyId - Target agency
     * @param options - Query options
     * @param config - Agency memory configuration
     * @returns Query result with retrieved chunks
     */
    querySharedMemory(agencyId: string, options: AgencyMemoryQueryOptions, config?: AgencyMemoryConfig): Promise<AgencyMemoryQueryResult>;
    /**
     * Gets statistics for agency shared memory.
     *
     * @param agencyId - Target agency
     * @returns Memory statistics
     */
    getStats(agencyId: string): Promise<AgencyMemoryStats | null>;
    /**
     * Cleans up agency memory when agency is removed.
     *
     * @param agencyId - Agency to clean up
     * @returns Operation result
     */
    cleanupAgencyMemory(agencyId: string): Promise<AgencyMemoryOperationResult>;
    /**
     * Gets the collection ID for an agency's shared memory.
     */
    private getCollectionId;
    /**
     * Resolves configuration with defaults.
     */
    private resolveConfig;
    /**
     * Checks if agency memory is initialized.
     */
    isInitialized(agencyId: string): boolean;
    /**
     * Broadcasts context from one GMI to all others in the agency.
     * This is useful for sharing discoveries, decisions, or important updates.
     *
     * @param agencyId - Target agency
     * @param input - Broadcast input
     * @param config - Agency memory configuration
     * @returns Operation result with broadcast metadata
     *
     * @example
     * ```typescript
     * await memoryManager.broadcastToAgency(agencyId, {
     *   content: 'Found critical security vulnerability in auth module',
     *   senderGmiId: 'security-analyst-gmi',
     *   senderRoleId: 'security-analyst',
     *   broadcastType: 'finding',
     *   priority: 'high',
     * });
     * ```
     */
    broadcastToAgency(agencyId: string, input: {
        content: string;
        senderGmiId: string;
        senderRoleId: string;
        broadcastType: 'finding' | 'decision' | 'update' | 'request' | 'alert';
        priority?: 'low' | 'normal' | 'high' | 'critical';
        targetRoles?: string[];
        metadata?: Record<string, unknown>;
    }, config?: AgencyMemoryConfig): Promise<AgencyMemoryOperationResult>;
    /**
     * Gets recent context contributions from specific roles.
     * Enables GMIs to selectively query context from collaborators.
     *
     * @param agencyId - Target agency
     * @param options - Query options with role filtering
     * @param config - Agency memory configuration
     * @returns Query result filtered by contributor roles
     *
     * @example
     * ```typescript
     * // Get recent findings from the researcher role
     * const findings = await memoryManager.getContextFromRoles(agencyId, {
     *   fromRoles: ['researcher', 'analyst'],
     *   categories: ['finding', 'summary'],
     *   requestingGmiId: 'coordinator-gmi',
     *   requestingRoleId: 'coordinator',
     *   limit: 10,
     * });
     * ```
     */
    getContextFromRoles(agencyId: string, options: {
        fromRoles: string[];
        categories?: ('communication' | 'finding' | 'decision' | 'summary' | 'context')[];
        requestingGmiId: string;
        requestingRoleId: string;
        limit?: number;
        minScore?: number;
    }, config?: AgencyMemoryConfig): Promise<AgencyMemoryQueryResult>;
    /**
     * Shares a synthesis or summary across all GMIs in the agency.
     * Typically used by coordinator or synthesizer roles.
     *
     * @param agencyId - Target agency
     * @param summary - Summary content and metadata
     * @param config - Agency memory configuration
     * @returns Operation result
     */
    shareSynthesis(agencyId: string, summary: {
        content: string;
        synthesizerId: string;
        synthesizerRoleId: string;
        sourceRoles?: string[];
        summaryType: 'interim' | 'final' | 'action_items' | 'consensus';
        metadata?: Record<string, unknown>;
    }, config?: AgencyMemoryConfig): Promise<AgencyMemoryOperationResult>;
    /**
     * Records a decision made by the agency for future reference.
     *
     * @param agencyId - Target agency
     * @param decision - Decision details
     * @param config - Agency memory configuration
     * @returns Operation result
     */
    recordDecision(agencyId: string, decision: {
        content: string;
        decisionMakerId: string;
        decisionMakerRoleId: string;
        decisionType: 'consensus' | 'delegation' | 'escalation' | 'resolution';
        affectedRoles?: string[];
        rationale?: string;
        metadata?: Record<string, unknown>;
    }, config?: AgencyMemoryConfig): Promise<AgencyMemoryOperationResult>;
    /**
     * Gets all decisions made by the agency.
     *
     * @param agencyId - Target agency
     * @param options - Query options
     * @param config - Agency memory configuration
     * @returns Query result with decision chunks
     */
    getDecisions(agencyId: string, options: {
        requestingGmiId: string;
        requestingRoleId: string;
        decisionTypes?: ('consensus' | 'delegation' | 'escalation' | 'resolution')[];
        limit?: number;
    }, config?: AgencyMemoryConfig): Promise<AgencyMemoryQueryResult>;
}
//# sourceMappingURL=AgencyMemoryManager.d.ts.map
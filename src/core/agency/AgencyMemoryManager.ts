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
import type { IVectorStoreManager } from '../../rag/IVectorStoreManager';
import type { RagDocumentInput, RagRetrievalOptions } from '../../rag/IRetrievalAugmentor';
import type {
  AgencySession,
  AgencyMemoryConfig,
  AgencyMemoryOperationResult,
  AgencyMemoryQueryOptions,
} from './AgencyTypes';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// AgencyMemoryManager Implementation
// ============================================================================

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
export class AgencyMemoryManager {
  /** Collection name prefix for agency shared memory */
  private static readonly COLLECTION_PREFIX = 'agency-shared-';

  /** Default memory configuration */
  private static readonly DEFAULT_CONFIG: AgencyMemoryConfig = {
    enabled: false,
    autoIngestCommunications: false,
    scoping: {
      includeSharedInQueries: true,
      allowCrossGMIQueries: false,
      sharedMemoryWeight: 0.3,
    },
  };

  /** Tracks initialized agencies */
  private readonly initializedAgencies = new Set<string>();

  /**
   * Creates a new AgencyMemoryManager instance.
   *
   * @param vectorStoreManager - Vector store manager for RAG operations
   * @param logger - Optional logger for diagnostics
   */
  constructor(
    private readonly vectorStoreManager: IVectorStoreManager | null,
    private readonly logger?: ILogger,
  ) {
    if (!vectorStoreManager) {
      this.logger?.warn?.('AgencyMemoryManager created without VectorStoreManager - shared memory disabled');
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initializes shared memory for an agency.
   * Creates dedicated collection and applies configuration.
   *
   * @param session - Agency session to initialize memory for
   * @returns Operation result
   */
  public async initializeAgencyMemory(session: AgencySession): Promise<AgencyMemoryOperationResult> {
    const config = this.resolveConfig(session.memoryConfig);

    if (!config.enabled) {
      return {
        success: true,
        documentsAffected: 0,
        metadata: { reason: 'Agency memory not enabled' },
      };
    }

    if (!this.vectorStoreManager) {
      return {
        success: false,
        documentsAffected: 0,
        error: 'VectorStoreManager not available',
      };
    }

    try {
      const collectionId = this.getCollectionId(session.agencyId);

      // Check if already initialized
      if (this.initializedAgencies.has(session.agencyId)) {
        this.logger?.debug?.('Agency memory already initialized', { agencyId: session.agencyId });
        return {
          success: true,
          documentsAffected: 0,
          metadata: { alreadyInitialized: true },
        };
      }

      // Create collection via default provider
      const provider = await this.vectorStoreManager.getDefaultProvider();
      if (!provider) {
        throw new Error('No default vector store provider available');
      }

      // Ensure collection exists
      const exists = await provider.collectionExists(collectionId);
      if (!exists) {
        await provider.createCollection({
          name: collectionId,
          metadata: {
            agencyId: session.agencyId,
            workflowId: session.workflowId,
            type: 'agency-shared-memory',
            createdAt: new Date().toISOString(),
          },
        });
        this.logger?.info?.('Created agency shared memory collection', {
          agencyId: session.agencyId,
          collectionId,
        });
      }

      this.initializedAgencies.add(session.agencyId);

      return {
        success: true,
        documentsAffected: 0,
        metadata: { collectionId, initialized: true },
      };
    } catch (error: any) {
      this.logger?.error?.('Failed to initialize agency memory', {
        agencyId: session.agencyId,
        error: error.message,
      });
      return {
        success: false,
        documentsAffected: 0,
        error: error.message,
      };
    }
  }

  // ==========================================================================
  // Ingestion
  // ==========================================================================

  /**
   * Ingests a document to agency shared memory.
   *
   * @param agencyId - Target agency
   * @param input - Document to ingest
   * @param config - Agency memory configuration
   * @returns Operation result
   */
  public async ingestToSharedMemory(
    agencyId: string,
    input: AgencyMemoryIngestInput,
    config?: AgencyMemoryConfig,
  ): Promise<AgencyMemoryOperationResult> {
    const resolvedConfig = this.resolveConfig(config);

    if (!resolvedConfig.enabled) {
      return {
        success: false,
        documentsAffected: 0,
        error: 'Agency memory not enabled',
      };
    }

    // Check write permissions
    if (resolvedConfig.writeRoles && resolvedConfig.writeRoles.length > 0) {
      if (!resolvedConfig.writeRoles.includes(input.contributorRoleId)) {
        this.logger?.warn?.('GMI role not authorized to write to agency memory', {
          agencyId,
          roleId: input.contributorRoleId,
          allowedRoles: resolvedConfig.writeRoles,
        });
        return {
          success: false,
          documentsAffected: 0,
          error: `Role '${input.contributorRoleId}' not authorized to write to agency shared memory`,
        };
      }
    }

    if (!this.vectorStoreManager) {
      return {
        success: false,
        documentsAffected: 0,
        error: 'VectorStoreManager not available',
      };
    }

    try {
      const provider = await this.vectorStoreManager.getDefaultProvider();
      if (!provider) {
        throw new Error('No default vector store provider available');
      }

      const collectionId = this.getCollectionId(agencyId);
      const documentId = `agency-${agencyId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Upsert document with agency-specific metadata
      await provider.upsert(collectionId, {
        documents: [
          {
            id: documentId,
            content: input.content,
            metadata: {
              agencyId,
              contributorGmiId: input.contributorGmiId,
              contributorRoleId: input.contributorRoleId,
              category: input.category || 'context',
              ingestedAt: new Date().toISOString(),
              ...input.metadata,
            },
          },
        ],
      });

      this.logger?.debug?.('Ingested document to agency shared memory', {
        agencyId,
        documentId,
        contributorRoleId: input.contributorRoleId,
      });

      return {
        success: true,
        documentsAffected: 1,
        metadata: { documentId, collectionId },
      };
    } catch (error: any) {
      this.logger?.error?.('Failed to ingest to agency shared memory', {
        agencyId,
        error: error.message,
      });
      return {
        success: false,
        documentsAffected: 0,
        error: error.message,
      };
    }
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  /**
   * Queries agency shared memory.
   *
   * @param agencyId - Target agency
   * @param options - Query options
   * @param config - Agency memory configuration
   * @returns Query result with retrieved chunks
   */
  public async querySharedMemory(
    agencyId: string,
    options: AgencyMemoryQueryOptions,
    config?: AgencyMemoryConfig,
  ): Promise<AgencyMemoryQueryResult> {
    const startTime = Date.now();
    const resolvedConfig = this.resolveConfig(config);

    if (!resolvedConfig.enabled) {
      return {
        success: false,
        chunks: [],
        totalResults: 0,
        processingTimeMs: Date.now() - startTime,
        error: 'Agency memory not enabled',
      };
    }

    // Check read permissions
    if (resolvedConfig.readRoles && resolvedConfig.readRoles.length > 0) {
      if (!resolvedConfig.readRoles.includes(options.requestingRoleId)) {
        this.logger?.warn?.('GMI role not authorized to read agency memory', {
          agencyId,
          roleId: options.requestingRoleId,
          allowedRoles: resolvedConfig.readRoles,
        });
        return {
          success: false,
          chunks: [],
          totalResults: 0,
          processingTimeMs: Date.now() - startTime,
          error: `Role '${options.requestingRoleId}' not authorized to read agency shared memory`,
        };
      }
    }

    if (!this.vectorStoreManager) {
      return {
        success: false,
        chunks: [],
        totalResults: 0,
        processingTimeMs: Date.now() - startTime,
        error: 'VectorStoreManager not available',
      };
    }

    try {
      const provider = await this.vectorStoreManager.getDefaultProvider();
      if (!provider) {
        throw new Error('No default vector store provider available');
      }

      const collectionId = this.getCollectionId(agencyId);

      // Build metadata filter
      const metadataFilter: Record<string, unknown> = { agencyId };
      if (options.fromRoles && options.fromRoles.length > 0) {
        metadataFilter.contributorRoleId = { $in: options.fromRoles };
      }

      // Execute query
      const result = await provider.query(collectionId, {
        queryText: options.query,
        topK: options.topK || 5,
        filter: metadataFilter,
        includeMetadata: true,
      });

      // Transform results
      const chunks: AgencyMemoryChunk[] = result.results.map((r: any) => ({
        chunkId: r.id,
        documentId: r.id.split('_chunk_')[0] || r.id,
        content: r.content || '',
        score: r.score ?? 0,
        contributorGmiId: (r.metadata?.contributorGmiId as string) || 'unknown',
        contributorRoleId: (r.metadata?.contributorRoleId as string) || 'unknown',
        category: (r.metadata?.category as string) || 'context',
        metadata: r.metadata,
      }));

      // Apply threshold filter
      const threshold = options.threshold ?? 0;
      const filteredChunks = chunks.filter((c) => c.score >= threshold);

      this.logger?.debug?.('Queried agency shared memory', {
        agencyId,
        query: options.query.slice(0, 50),
        resultsReturned: filteredChunks.length,
      });

      return {
        success: true,
        chunks: filteredChunks,
        totalResults: filteredChunks.length,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error: any) {
      this.logger?.error?.('Failed to query agency shared memory', {
        agencyId,
        error: error.message,
      });
      return {
        success: false,
        chunks: [],
        totalResults: 0,
        processingTimeMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  // ==========================================================================
  // Statistics & Cleanup
  // ==========================================================================

  /**
   * Gets statistics for agency shared memory.
   *
   * @param agencyId - Target agency
   * @returns Memory statistics
   */
  public async getStats(agencyId: string): Promise<AgencyMemoryStats | null> {
    if (!this.vectorStoreManager) {
      return null;
    }

    try {
      const provider = await this.vectorStoreManager.getDefaultProvider();
      if (!provider) {
        return null;
      }

      const collectionId = this.getCollectionId(agencyId);
      const stats = await provider.getStats(collectionId);

      // TODO: Aggregate by role and category from metadata
      return {
        totalDocuments: stats?.documentCount ?? 0,
        totalChunks: stats?.vectorCount ?? 0,
        documentsByRole: {},
        documentsByCategory: {},
      };
    } catch {
      return null;
    }
  }

  /**
   * Cleans up agency memory when agency is removed.
   *
   * @param agencyId - Agency to clean up
   * @returns Operation result
   */
  public async cleanupAgencyMemory(agencyId: string): Promise<AgencyMemoryOperationResult> {
    if (!this.vectorStoreManager) {
      return {
        success: false,
        documentsAffected: 0,
        error: 'VectorStoreManager not available',
      };
    }

    try {
      const provider = await this.vectorStoreManager.getDefaultProvider();
      if (!provider) {
        throw new Error('No default vector store provider available');
      }

      const collectionId = this.getCollectionId(agencyId);

      // Delete collection
      await provider.deleteCollection(collectionId);

      this.initializedAgencies.delete(agencyId);

      this.logger?.info?.('Cleaned up agency memory', { agencyId, collectionId });

      return {
        success: true,
        documentsAffected: 0,
        metadata: { collectionDeleted: collectionId },
      };
    } catch (error: any) {
      this.logger?.error?.('Failed to cleanup agency memory', {
        agencyId,
        error: error.message,
      });
      return {
        success: false,
        documentsAffected: 0,
        error: error.message,
      };
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Gets the collection ID for an agency's shared memory.
   */
  private getCollectionId(agencyId: string): string {
    return `${AgencyMemoryManager.COLLECTION_PREFIX}${agencyId}`;
  }

  /**
   * Resolves configuration with defaults.
   */
  private resolveConfig(config?: AgencyMemoryConfig): AgencyMemoryConfig {
    if (!config) {
      return AgencyMemoryManager.DEFAULT_CONFIG;
    }
    return {
      ...AgencyMemoryManager.DEFAULT_CONFIG,
      ...config,
      scoping: {
        ...AgencyMemoryManager.DEFAULT_CONFIG.scoping,
        ...config.scoping,
      },
    };
  }

  /**
   * Checks if agency memory is initialized.
   */
  public isInitialized(agencyId: string): boolean {
    return this.initializedAgencies.has(agencyId);
  }
}


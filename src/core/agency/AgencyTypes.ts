/**
 * @file AgencyTypes.ts
 * @description Type definitions for Agency (multi-GMI collective) management.
 * @module AgentOS/Agency
 */

// ============================================================================
// Seat State Types
// ============================================================================

/**
 * Captures the runtime state of a single seat within an Agency.
 * A seat represents a role filled by a specific GMI instance.
 */
export interface AgencySeatState {
  /** Unique role identifier within the agency */
  roleId: string;
  /** GMI instance currently filling this seat */
  gmiInstanceId: string;
  /** Persona configuration for this seat */
  personaId: string;
  /** ISO timestamp when GMI was attached to this seat */
  attachedAt: string;
  /** Custom metadata for this seat */
  metadata?: Record<string, unknown>;
  /** Historical record of seat activity */
  history?: AgencySeatHistoryEntry[];
}

/**
 * Single history entry for seat activity tracking.
 */
export interface AgencySeatHistoryEntry {
  /** Associated task identifier */
  taskId?: string;
  /** ISO timestamp of this entry */
  timestamp: string;
  /** Current status of the task */
  status?: 'pending' | 'running' | 'completed' | 'failed';
  /** Preview of task output */
  outputPreview?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Agency Memory Configuration
// ============================================================================

/**
 * Configuration for agency-level shared RAG memory.
 * Enables GMIs within an agency to share context and collaborate effectively.
 */
export interface AgencyMemoryConfig {
  /**
   * Enable shared RAG memory for the agency.
   * When enabled, all GMIs in the agency can read/write to shared collections.
   * @default false
   */
  enabled: boolean;

  /**
   * Dedicated data source ID for agency shared memory.
   * Auto-generated if not provided when enabled.
   */
  sharedDataSourceId?: string;

  /**
   * Control which roles can write to shared memory.
   * If empty/undefined, all roles can write.
   */
  writeRoles?: string[];

  /**
   * Control which roles can read from shared memory.
   * If empty/undefined, all roles can read.
   */
  readRoles?: string[];

  /**
   * Automatically ingest cross-GMI communications to shared memory.
   * @default false
   */
  autoIngestCommunications?: boolean;

  /**
   * Retention policy for shared memory documents.
   */
  retentionPolicy?: AgencyMemoryRetentionPolicy;

  /**
   * Memory scoping configuration.
   */
  scoping?: AgencyMemoryScopingConfig;
}

/**
 * Retention policy for agency shared memory.
 */
export interface AgencyMemoryRetentionPolicy {
  /** Maximum age of documents in days before eviction */
  maxAgeDays?: number;
  /** Maximum number of documents to retain */
  maxDocuments?: number;
  /** Maximum total storage in bytes */
  maxStorageBytes?: number;
  /** Strategy for eviction when limits are reached */
  evictionStrategy?: 'oldest_first' | 'least_accessed' | 'lowest_importance';
}

/**
 * Controls how GMIs scope their RAG queries within an agency.
 */
export interface AgencyMemoryScopingConfig {
  /**
   * Include agency shared memory in GMI RAG queries.
   * @default true when agency memory is enabled
   */
  includeSharedInQueries?: boolean;

  /**
   * Include other GMIs' personal memory in queries (with permission).
   * @default false
   */
  allowCrossGMIQueries?: boolean;

  /**
   * Priority weight for shared memory vs personal memory in results.
   * 0 = personal only, 1 = shared only, 0.5 = equal weight.
   * @default 0.3
   */
  sharedMemoryWeight?: number;
}

// ============================================================================
// Agency Session Types
// ============================================================================

/**
 * Represents a collective of GMIs collaborating under a single Agency identity.
 * Agencies enable multi-agent workflows with shared context and memory.
 */
export interface AgencySession {
  /** Unique agency identifier */
  agencyId: string;
  /** Associated workflow instance */
  workflowId: string;
  /** Conversation context for this agency */
  conversationId: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** GMI seats keyed by role ID */
  seats: Record<string, AgencySeatState>;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /**
   * Shared memory configuration for this agency.
   * @see AgencyMemoryConfig
   */
  memoryConfig?: AgencyMemoryConfig;
}

// ============================================================================
// Agency Operation Types
// ============================================================================

/**
 * Arguments for creating or updating an agency session.
 */
export interface AgencyUpsertArgs {
  /** Associated workflow instance */
  workflowId: string;
  /** Conversation context */
  conversationId: string;
  /** Explicit agency ID (auto-generated if omitted) */
  agencyId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Shared memory configuration */
  memoryConfig?: AgencyMemoryConfig;
}

/**
 * Arguments for registering a GMI to an agency seat.
 */
export interface AgencySeatRegistrationArgs {
  /** Target agency */
  agencyId: string;
  /** Role to fill */
  roleId: string;
  /** GMI instance to assign */
  gmiInstanceId: string;
  /** Persona configuration */
  personaId: string;
  /** Seat-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of an agency memory operation.
 */
export interface AgencyMemoryOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Number of documents affected */
  documentsAffected: number;
  /** Error message if failed */
  error?: string;
  /** Operation metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query options for agency shared memory.
 */
export interface AgencyMemoryQueryOptions {
  /** Query text */
  query: string;
  /** Requesting GMI instance ID */
  requestingGmiId: string;
  /** Requesting role ID */
  requestingRoleId: string;
  /** Maximum results */
  topK?: number;
  /** Minimum similarity threshold */
  threshold?: number;
  /** Include personal memory in results */
  includePersonalMemory?: boolean;
  /** Filter by specific roles' contributions */
  fromRoles?: string[];
}

/**
 * @file index.ts
 * @description Agency module exports - multi-GMI collective management.
 * @module AgentOS/Agency
 */

// Types
export type {
  AgencySeatState,
  AgencySeatHistoryEntry,
  AgencyMemoryConfig,
  AgencyMemoryRetentionPolicy,
  AgencyMemoryScopingConfig,
  AgencySession,
  AgencyUpsertArgs,
  AgencySeatRegistrationArgs,
  AgencyMemoryOperationResult,
  AgencyMemoryQueryOptions,
} from './AgencyTypes';

// Registry
export { AgencyRegistry } from './AgencyRegistry';

// Memory Manager
export { AgencyMemoryManager } from './AgencyMemoryManager';
export type {
  AgencyMemoryIngestInput,
  AgencyMemoryChunk,
  AgencyMemoryQueryResult,
  AgencyMemoryStats,
} from './AgencyMemoryManager';


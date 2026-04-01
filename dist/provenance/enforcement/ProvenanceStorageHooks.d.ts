/**
 * @file ProvenanceStorageHooks.ts
 * @description StorageHooks implementation that enforces provenance policies.
 * Integrates with sql-storage-adapter's onBeforeWrite/onAfterWrite hooks.
 *
 * @module AgentOS/Provenance/Enforcement
 */
import type { ProvenanceSystemConfig } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import type { RevisionManager } from './RevisionManager.js';
import type { TombstoneManager } from './TombstoneManager.js';
interface WriteContext {
    readonly operation: 'run' | 'batch';
    statement: string;
    parameters?: unknown[];
    affectedTables?: string[];
    readonly inTransaction?: boolean;
    operationId: string;
    startTime: number;
    adapterKind?: string;
    metadata?: Record<string, unknown>;
}
interface StorageRunResult {
    changes: number;
    lastInsertRowid?: string | number | null;
}
type WriteHookResult = WriteContext | undefined | void;
interface StorageHooks {
    onBeforeWrite?(context: WriteContext): Promise<WriteHookResult>;
    onAfterWrite?(context: WriteContext, result: StorageRunResult): Promise<void>;
}
/**
 * Create StorageHooks that enforce provenance policies.
 *
 * @param config - The provenance system configuration.
 * @param ledger - The signed event ledger (optional, for logging events).
 * @param revisionManager - For capturing revisions in revisioned mode.
 * @param tombstoneManager - For creating tombstones in revisioned mode.
 * @returns StorageHooks compatible with sql-storage-adapter's combineHooks().
 */
export declare function createProvenanceHooks(config: ProvenanceSystemConfig, ledger?: SignedEventLedger, revisionManager?: RevisionManager, tombstoneManager?: TombstoneManager): StorageHooks;
export {};
//# sourceMappingURL=ProvenanceStorageHooks.d.ts.map
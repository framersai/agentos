/**
 * @file TombstoneManager.ts
 * @description Manages soft-deletion via tombstone records.
 * In revisioned/sealed modes, DELETE operations are converted to tombstones.
 *
 * @module AgentOS/Provenance/Enforcement
 */
import type { TombstoneRecord } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
interface TombstoneStorageAdapter {
    run(statement: string, parameters?: unknown[]): Promise<{
        changes: number;
    }>;
    all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
    get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}
export declare class TombstoneManager {
    private readonly storageAdapter;
    private readonly ledger;
    private readonly tablePrefix;
    constructor(storageAdapter: TombstoneStorageAdapter, ledger?: SignedEventLedger | null, tablePrefix?: string);
    /**
     * Create a tombstone for records about to be deleted.
     * Call this INSTEAD of executing the DELETE.
     *
     * @param tableName - The table the records belong to.
     * @param whereClause - The WHERE clause from the DELETE statement.
     * @param parameters - Parameters for the WHERE clause.
     * @param reason - Reason for deletion.
     * @param initiator - Who initiated the deletion (agent ID or 'human').
     */
    createTombstone(tableName: string, whereClause: string, parameters?: unknown[], reason?: string, initiator?: string): Promise<TombstoneRecord[]>;
    /**
     * Check if a record has been tombstoned.
     */
    isTombstoned(tableName: string, recordId: string): Promise<boolean>;
    /**
     * Get the tombstone record for a specific record.
     */
    getTombstone(tableName: string, recordId: string): Promise<TombstoneRecord | null>;
    /**
     * Get all tombstones for a table.
     */
    getTombstones(tableName?: string): Promise<TombstoneRecord[]>;
}
export {};
//# sourceMappingURL=TombstoneManager.d.ts.map
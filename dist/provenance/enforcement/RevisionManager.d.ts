/**
 * @file RevisionManager.ts
 * @description Captures row snapshots before UPDATE operations in revisioned mode.
 * Creates revision records so the full history of every row is preserved.
 *
 * @module AgentOS/Provenance/Enforcement
 */
import type { RevisionRecord } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
interface RevisionStorageAdapter {
    run(statement: string, parameters?: unknown[]): Promise<{
        changes: number;
    }>;
    all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
    get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}
export declare class RevisionManager {
    private readonly storageAdapter;
    private readonly ledger;
    private readonly tablePrefix;
    constructor(storageAdapter: RevisionStorageAdapter, ledger?: SignedEventLedger | null, tablePrefix?: string);
    /**
     * Capture the current state of records that are about to be updated.
     * Call this BEFORE the UPDATE executes.
     *
     * @param tableName - The table being updated.
     * @param whereClause - The WHERE clause from the UPDATE statement (without "WHERE").
     * @param parameters - Parameters for the WHERE clause.
     */
    captureRevision(tableName: string, whereClause: string, parameters?: unknown[]): Promise<RevisionRecord[]>;
    /**
     * Get all revisions for a specific record.
     */
    getRevisions(tableName: string, recordId: string): Promise<RevisionRecord[]>;
    /**
     * Get the latest revision for a specific record.
     */
    getLatestRevision(tableName: string, recordId: string): Promise<RevisionRecord | null>;
}
export {};
//# sourceMappingURL=RevisionManager.d.ts.map
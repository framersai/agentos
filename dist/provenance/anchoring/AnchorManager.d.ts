/**
 * @file AnchorManager.ts
 * @description Periodic Merkle root anchoring for tamper evidence.
 * Computes Merkle roots over batches of signed events and signs them.
 *
 * @module AgentOS/Provenance/Anchoring
 */
import type { AnchorRecord, AnchorProvider, ProvenanceSystemConfig } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
interface AnchorStorageAdapter {
    run(statement: string, parameters?: unknown[]): Promise<{
        changes: number;
    }>;
    all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
    get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}
export declare class AnchorManager {
    private readonly storageAdapter;
    private readonly ledger;
    private readonly keyManager;
    private readonly config;
    private readonly tablePrefix;
    private readonly provider;
    private timer;
    private isRunning;
    constructor(storageAdapter: AnchorStorageAdapter, ledger: SignedEventLedger, keyManager: AgentKeyManager, config: ProvenanceSystemConfig, tablePrefix?: string, provider?: AnchorProvider);
    /**
     * Start periodic anchoring at the configured interval.
     */
    start(): void;
    /**
     * Stop periodic anchoring.
     */
    stop(): void;
    /**
     * Create an anchor if there are enough new events since the last anchor.
     * Returns the new anchor record, or null if no anchor was needed.
     */
    createAnchorIfNeeded(): Promise<AnchorRecord | null>;
    /**
     * Force-create an anchor for a specific event range.
     *
     * @param fromSequence - Start sequence (inclusive).
     * @param toSequence - End sequence (inclusive).
     * @returns The new anchor record.
     */
    createAnchor(fromSequence: number, toSequence: number): Promise<AnchorRecord>;
    /**
     * Publish an anchor to the external provider and update the DB with the result.
     * Designed to be called in a fire-and-forget manner.
     * Failures are logged but never propagated.
     */
    private publishExternally;
    /**
     * Get the current anchor provider, if any.
     */
    getProvider(): AnchorProvider | null;
    /**
     * Get the most recent anchor.
     */
    getLastAnchor(): Promise<AnchorRecord | null>;
    /**
     * Get all anchors (ordered by sequence range).
     */
    getAllAnchors(): Promise<AnchorRecord[]>;
    /**
     * Get the anchor covering a specific sequence number.
     */
    getAnchorForSequence(sequence: number): Promise<AnchorRecord | null>;
    /**
     * Verify an anchor's Merkle root against the actual events.
     */
    verifyAnchor(anchorId: string): Promise<{
        valid: boolean;
        anchor: AnchorRecord;
        errors: string[];
    }>;
    /**
     * Check if the manager is currently running periodic anchoring.
     */
    isActive(): boolean;
    private rowToAnchor;
}
export {};
//# sourceMappingURL=AnchorManager.d.ts.map
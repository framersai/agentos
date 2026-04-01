/**
 * @file SignedEventLedger.ts
 * @description Core append-only signed event log with hash chain and Ed25519 signatures.
 * All events are sequenced, hashed, and signed to create a tamper-evident chain.
 *
 * @module AgentOS/Provenance/Ledger
 */
import type { SignedEvent, ProvenanceEventType, ProvenanceConfig } from '../types.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
interface LedgerStorageAdapter {
    run(statement: string, parameters?: unknown[]): Promise<{
        changes: number;
    }>;
    all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
    get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}
export declare class SignedEventLedger {
    private readonly storageAdapter;
    private readonly keyManager;
    private readonly agentId;
    private readonly config;
    private readonly tablePrefix;
    private chain;
    private isInitialized;
    private appendQueue;
    constructor(storageAdapter: LedgerStorageAdapter, keyManager: AgentKeyManager, agentId: string, config: ProvenanceConfig, tablePrefix?: string);
    /**
     * Initialize the ledger: load the last sequence number and hash from the DB.
     */
    initialize(): Promise<void>;
    /**
     * Append a new event to the ledger.
     * Serialized via internal queue to maintain hash chain integrity.
     */
    appendEvent(type: ProvenanceEventType, payload: Record<string, unknown>): Promise<SignedEvent>;
    private doAppend;
    /**
     * Get a single event by ID.
     */
    getEvent(id: string): Promise<SignedEvent | null>;
    /**
     * Get events in a sequence range (inclusive).
     */
    getEventsByRange(fromSequence: number, toSequence: number): Promise<SignedEvent[]>;
    /**
     * Get events by type.
     */
    getEventsByType(type: ProvenanceEventType): Promise<SignedEvent[]>;
    /**
     * Get events matching a payload filter (searches JSON payload).
     */
    getEventsByPayloadFilter(filter: Record<string, unknown>, types?: ProvenanceEventType[]): Promise<SignedEvent[]>;
    /**
     * Get the latest event.
     */
    getLatestEvent(): Promise<SignedEvent | null>;
    /**
     * Get the total number of events for this agent.
     */
    getEventCount(): Promise<number>;
    /**
     * Get all events for this agent (ordered by sequence).
     */
    getAllEvents(): Promise<SignedEvent[]>;
    /**
     * Get the current chain state (for diagnostics).
     */
    getChainState(): {
        lastHash: string;
        sequence: number;
    };
    private rowToEvent;
}
export {};
//# sourceMappingURL=SignedEventLedger.d.ts.map
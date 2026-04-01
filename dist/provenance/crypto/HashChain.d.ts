/**
 * @file HashChain.ts
 * @description SHA-256 hash chain for provenance events.
 * Computes deterministic hashes using a canonical preimage format.
 *
 * @module AgentOS/Provenance/Crypto
 */
import type { ProvenanceEventType } from '../types.js';
export declare class HashChain {
    private lastHash;
    private sequence;
    constructor(initialHash?: string, initialSequence?: number);
    /**
     * Get the current sequence number.
     */
    getSequence(): number;
    /**
     * Get the hash of the last event in the chain.
     */
    getLastHash(): string;
    /**
     * Advance the chain: increment sequence, return the new sequence and prevHash.
     */
    advance(): {
        sequence: number;
        prevHash: string;
    };
    /**
     * Record a hash as the new chain head (call after event is persisted).
     */
    recordHash(hash: string): void;
    /**
     * Compute the SHA-256 hash of an event's preimage.
     * Preimage format: `${sequence}|${type}|${timestamp}|${agentId}|${prevHash}|${payloadHash}`
     */
    static computeEventHash(event: {
        sequence: number;
        type: ProvenanceEventType;
        timestamp: string;
        agentId: string;
        prevHash: string;
        payloadHash: string;
    }, algorithm?: string): string;
    /**
     * Compute the SHA-256 hash of a payload object using canonical JSON.
     * Canonical = sorted keys recursively for deterministic output.
     */
    static computePayloadHash(payload: Record<string, unknown>, algorithm?: string): string;
    /**
     * Produce canonical JSON: keys sorted lexicographically at every level.
     */
    static canonicalJSON(obj: unknown): string;
    /**
     * Compute a generic SHA-256 hash of a string.
     */
    static hash(data: string, algorithm?: string): string;
}
//# sourceMappingURL=HashChain.d.ts.map
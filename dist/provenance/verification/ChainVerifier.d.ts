/**
 * @file ChainVerifier.ts
 * @description Verifies the integrity of the signed event hash chain.
 * Checks sequence continuity, hash linkage, payload hashes, signatures,
 * and timestamp monotonicity.
 *
 * @module AgentOS/Provenance/Verification
 */
import type { SignedEvent, VerificationResult } from '../types.js';
export declare class ChainVerifier {
    /**
     * Verify an ordered array of signed events for chain integrity.
     *
     * Checks performed:
     * 1. Sequence continuity (monotonically increasing, no gaps)
     * 2. Hash linkage (each event's prevHash matches the prior event's hash)
     * 3. Payload hash integrity (recomputed hash matches stored payloadHash)
     * 4. Event hash integrity (recomputed hash matches stored hash)
     * 5. Ed25519 signature verification (if signatures present)
     * 6. Timestamp monotonicity (non-decreasing)
     *
     * @param events - Ordered array of SignedEvent objects (sorted by sequence ASC).
     * @param publicKeyBase64 - Optional public key for signature verification.
     *                          If omitted, uses each event's signerPublicKey field.
     * @param hashAlgorithm - Hash algorithm used (default: 'sha256').
     * @returns VerificationResult with validity status and any errors found.
     */
    static verify(events: SignedEvent[], publicKeyBase64?: string, hashAlgorithm?: 'sha256'): Promise<VerificationResult>;
    /**
     * Quick integrity check - returns true/false without detailed errors.
     */
    static isValid(events: SignedEvent[], publicKeyBase64?: string): Promise<boolean>;
    /**
     * Verify a sub-chain (range of events) within a larger chain.
     * The first event's prevHash is trusted as a starting point.
     */
    static verifySubChain(events: SignedEvent[], expectedStartPrevHash: string, publicKeyBase64?: string): Promise<VerificationResult>;
}
//# sourceMappingURL=ChainVerifier.d.ts.map
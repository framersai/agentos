/**
 * @file BundleExporter.ts
 * @description Export and import verification bundles for offline chain verification.
 * Bundles contain events, anchors, public key, and a bundle-level signature.
 *
 * @module AgentOS/Provenance/Verification
 */
import type { VerificationBundle, VerificationResult } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
interface AnchorStorageAdapter {
    all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
}
export declare class BundleExporter {
    private readonly ledger;
    private readonly keyManager;
    private readonly anchorStorage;
    private readonly tablePrefix;
    constructor(ledger: SignedEventLedger, keyManager: AgentKeyManager, anchorStorage?: AnchorStorageAdapter | null, tablePrefix?: string);
    /**
     * Export a verification bundle containing all events, anchors, and public key.
     * The bundle is signed for tamper evidence.
     *
     * @param fromSequence - Optional start sequence (inclusive). Defaults to 1.
     * @param toSequence - Optional end sequence (inclusive). Defaults to latest.
     * @returns A self-contained verification bundle.
     */
    exportBundle(fromSequence?: number, toSequence?: number): Promise<VerificationBundle>;
    /**
     * Export a bundle as a JSONL string (one JSON object per line).
     * Format:
     *   Line 1: Bundle metadata (version, agentId, publicKey, exportedAt, bundleHash, bundleSignature)
     *   Lines 2-N: One event per line
     *   Lines N+1-M: One anchor per line (prefixed with type: 'anchor')
     */
    exportAsJSONL(fromSequence?: number, toSequence?: number): Promise<string>;
    /**
     * Import and verify a bundle. Works completely offline (no DB required).
     *
     * @param bundle - The verification bundle to verify.
     * @returns Verification result.
     */
    static importAndVerify(bundle: VerificationBundle): Promise<VerificationResult>;
    /**
     * Parse a JSONL bundle string back into a VerificationBundle.
     */
    static parseJSONL(jsonl: string): VerificationBundle;
}
export {};
//# sourceMappingURL=BundleExporter.d.ts.map
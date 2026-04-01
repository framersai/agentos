/**
 * @file AgentKeyManager.ts
 * @description Ed25519 keypair generation, signing, and verification.
 * Uses Node.js `crypto` module on server; falls back to `@noble/ed25519` in browser.
 *
 * @module AgentOS/Provenance/Crypto
 */
import type { AgentKeySource } from '../types.js';
export declare class AgentKeyManager {
    private privateKey;
    private publicKey;
    readonly agentId: string;
    private constructor();
    /**
     * Generate a new Ed25519 keypair.
     */
    static generate(agentId: string): Promise<AgentKeyManager>;
    /**
     * Create from an imported key source configuration.
     */
    static fromKeySource(agentId: string, source: AgentKeySource): Promise<AgentKeyManager>;
    /**
     * Sign data and return a base64-encoded signature.
     */
    sign(data: string): Promise<string>;
    /**
     * Verify a signature against data using a public key.
     * Can verify using this instance's key or a provided external key.
     */
    verify(data: string, signatureBase64: string, publicKeyBase64?: string): Promise<boolean>;
    /**
     * Static verification using only a public key (no instance needed).
     */
    static verifySignature(data: string, signatureBase64: string, publicKeyBase64: string): Promise<boolean>;
    /**
     * Get the base64-encoded public key.
     */
    getPublicKeyBase64(): string;
    /**
     * Get the base64-encoded private key (for persistence).
     */
    getPrivateKeyBase64(): string;
    /**
     * Export as an AgentKeySource for serialization.
     */
    toKeySource(): AgentKeySource;
}
//# sourceMappingURL=AgentKeyManager.d.ts.map
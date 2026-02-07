/**
 * @file AgentKeyManager.ts
 * @description Ed25519 keypair generation, signing, and verification.
 * Uses Node.js `crypto` module on server; falls back to `@noble/ed25519` in browser.
 *
 * @module AgentOS/Provenance/Crypto
 */

import type { AgentKeySource } from '../types.js';

// =============================================================================
// Runtime Detection
// =============================================================================

let nodeCrypto: typeof import('node:crypto') | undefined;
try {
  // Dynamic import for Node.js runtime
  nodeCrypto = await import('node:crypto');
} catch {
  // Not in Node.js environment
}

// =============================================================================
// AgentKeyManager
// =============================================================================

export class AgentKeyManager {
  private privateKey: Buffer | Uint8Array;
  private publicKey: Buffer | Uint8Array;
  readonly agentId: string;

  private constructor(
    agentId: string,
    privateKey: Buffer | Uint8Array,
    publicKey: Buffer | Uint8Array,
  ) {
    this.agentId = agentId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  /**
   * Generate a new Ed25519 keypair.
   */
  static async generate(agentId: string): Promise<AgentKeyManager> {
    if (nodeCrypto) {
      const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
      return new AgentKeyManager(
        agentId,
        privateKey.export({ type: 'pkcs8', format: 'der' }),
        publicKey.export({ type: 'spki', format: 'der' }),
      );
    }

    // Browser fallback via @noble/ed25519
    // @ts-ignore -- optional peer dependency, only used in browser environments
    const noble = await import('@noble/ed25519');
    const privKey = noble.utils.randomPrivateKey();
    const pubKey = await noble.getPublicKeyAsync(privKey);
    return new AgentKeyManager(agentId, privKey, pubKey);
  }

  /**
   * Create from an imported key source configuration.
   */
  static async fromKeySource(agentId: string, source: AgentKeySource): Promise<AgentKeyManager> {
    if (source.type === 'generate') {
      return AgentKeyManager.generate(agentId);
    }

    if (!source.privateKeyBase64 || !source.publicKeyBase64) {
      throw new Error('AgentKeyManager: import requires both privateKeyBase64 and publicKeyBase64');
    }

    const privateKey = Buffer.from(source.privateKeyBase64, 'base64');
    const publicKey = Buffer.from(source.publicKeyBase64, 'base64');
    return new AgentKeyManager(agentId, privateKey, publicKey);
  }

  /**
   * Sign data and return a base64-encoded signature.
   */
  async sign(data: string): Promise<string> {
    const dataBuffer = Buffer.from(data, 'utf-8');

    if (nodeCrypto) {
      const keyObject = nodeCrypto.createPrivateKey({
        key: this.privateKey as Buffer,
        format: 'der',
        type: 'pkcs8',
      });
      const signature = nodeCrypto.sign(null, dataBuffer, keyObject);
      return signature.toString('base64');
    }

    // Browser fallback
    // @ts-ignore -- optional peer dependency, only used in browser environments
    const noble = await import('@noble/ed25519');
    const sig = await noble.signAsync(dataBuffer, this.privateKey);
    return Buffer.from(sig).toString('base64');
  }

  /**
   * Verify a signature against data using a public key.
   * Can verify using this instance's key or a provided external key.
   */
  async verify(data: string, signatureBase64: string, publicKeyBase64?: string): Promise<boolean> {
    const dataBuffer = Buffer.from(data, 'utf-8');
    const sigBuffer = Buffer.from(signatureBase64, 'base64');
    const pubKeyBytes = publicKeyBase64
      ? Buffer.from(publicKeyBase64, 'base64')
      : this.publicKey;

    if (nodeCrypto) {
      try {
        const keyObject = nodeCrypto.createPublicKey({
          key: pubKeyBytes as Buffer,
          format: 'der',
          type: 'spki',
        });
        return nodeCrypto.verify(null, dataBuffer, keyObject, sigBuffer);
      } catch {
        return false;
      }
    }

    // Browser fallback
    try {
      // @ts-ignore -- optional peer dependency, only used in browser environments
    const noble = await import('@noble/ed25519');
      return await noble.verifyAsync(sigBuffer, dataBuffer, pubKeyBytes);
    } catch {
      return false;
    }
  }

  /**
   * Static verification using only a public key (no instance needed).
   */
  static async verifySignature(
    data: string,
    signatureBase64: string,
    publicKeyBase64: string,
  ): Promise<boolean> {
    const dataBuffer = Buffer.from(data, 'utf-8');
    const sigBuffer = Buffer.from(signatureBase64, 'base64');
    const pubKeyBytes = Buffer.from(publicKeyBase64, 'base64');

    if (nodeCrypto) {
      try {
        const keyObject = nodeCrypto.createPublicKey({
          key: pubKeyBytes,
          format: 'der',
          type: 'spki',
        });
        return nodeCrypto.verify(null, dataBuffer, keyObject, sigBuffer);
      } catch {
        return false;
      }
    }

    try {
      // @ts-ignore -- optional peer dependency, only used in browser environments
    const noble = await import('@noble/ed25519');
      return await noble.verifyAsync(sigBuffer, dataBuffer, pubKeyBytes);
    } catch {
      return false;
    }
  }

  /**
   * Get the base64-encoded public key.
   */
  getPublicKeyBase64(): string {
    return Buffer.from(this.publicKey).toString('base64');
  }

  /**
   * Get the base64-encoded private key (for persistence).
   */
  getPrivateKeyBase64(): string {
    return Buffer.from(this.privateKey).toString('base64');
  }

  /**
   * Export as an AgentKeySource for serialization.
   */
  toKeySource(): AgentKeySource {
    return {
      type: 'import',
      privateKeyBase64: this.getPrivateKeyBase64(),
      publicKeyBase64: this.getPublicKeyBase64(),
    };
  }
}

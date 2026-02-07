/**
 * @file HashChain.ts
 * @description SHA-256 hash chain for provenance events.
 * Computes deterministic hashes using a canonical preimage format.
 *
 * @module AgentOS/Provenance/Crypto
 */

import { createHash } from 'node:crypto';
import type { SignedEvent, ProvenanceEventType } from '../types.js';

// =============================================================================
// HashChain
// =============================================================================

export class HashChain {
  private lastHash: string = '';
  private sequence: number = 0;

  constructor(initialHash: string = '', initialSequence: number = 0) {
    this.lastHash = initialHash;
    this.sequence = initialSequence;
  }

  /**
   * Get the current sequence number.
   */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Get the hash of the last event in the chain.
   */
  getLastHash(): string {
    return this.lastHash;
  }

  /**
   * Advance the chain: increment sequence, return the new sequence and prevHash.
   */
  advance(): { sequence: number; prevHash: string } {
    this.sequence += 1;
    return {
      sequence: this.sequence,
      prevHash: this.lastHash,
    };
  }

  /**
   * Record a hash as the new chain head (call after event is persisted).
   */
  recordHash(hash: string): void {
    this.lastHash = hash;
  }

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
  }, algorithm: string = 'sha256'): string {
    const preimage = `${event.sequence}|${event.type}|${event.timestamp}|${event.agentId}|${event.prevHash}|${event.payloadHash}`;
    return createHash(algorithm).update(preimage, 'utf-8').digest('hex');
  }

  /**
   * Compute the SHA-256 hash of a payload object using canonical JSON.
   * Canonical = sorted keys recursively for deterministic output.
   */
  static computePayloadHash(payload: Record<string, unknown>, algorithm: string = 'sha256'): string {
    const canonical = HashChain.canonicalJSON(payload);
    return createHash(algorithm).update(canonical, 'utf-8').digest('hex');
  }

  /**
   * Produce canonical JSON: keys sorted lexicographically at every level.
   */
  static canonicalJSON(obj: unknown): string {
    if (obj === null || obj === undefined) return JSON.stringify(obj);
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => HashChain.canonicalJSON(item)).join(',') + ']';
    }

    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const entries = sortedKeys.map(
      key => `${JSON.stringify(key)}:${HashChain.canonicalJSON(record[key])}`,
    );
    return '{' + entries.join(',') + '}';
  }

  /**
   * Compute a generic SHA-256 hash of a string.
   */
  static hash(data: string, algorithm: string = 'sha256'): string {
    return createHash(algorithm).update(data, 'utf-8').digest('hex');
  }
}

/**
 * @file ChainVerifier.ts
 * @description Verifies the integrity of the signed event hash chain.
 * Checks sequence continuity, hash linkage, payload hashes, signatures,
 * and timestamp monotonicity.
 *
 * @module AgentOS/Provenance/Verification
 */

import type { SignedEvent, VerificationResult, VerificationError } from '../types.js';
import { HashChain } from '../crypto/HashChain.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';

// =============================================================================
// ChainVerifier
// =============================================================================

export class ChainVerifier {
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
  static async verify(
    events: SignedEvent[],
    publicKeyBase64?: string,
    hashAlgorithm: 'sha256' = 'sha256',
  ): Promise<VerificationResult> {
    const errors: VerificationError[] = [];
    const warnings: string[] = [];

    if (events.length === 0) {
      return {
        valid: true,
        eventsVerified: 0,
        errors: [],
        warnings: ['Empty event chain provided.'],
        verifiedAt: new Date().toISOString(),
      };
    }

    // Check first event
    const first = events[0];
    if (first.sequence !== 1) {
      warnings.push(`Chain does not start at sequence 1 (starts at ${first.sequence}). Partial chain verification.`);
    }

    let previousEvent: SignedEvent | null = null;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // 1. Sequence continuity
      if (previousEvent && event.sequence !== previousEvent.sequence + 1) {
        errors.push({
          eventId: event.id,
          sequence: event.sequence,
          code: 'SEQUENCE_GAP',
          message: `Sequence gap: expected ${previousEvent.sequence + 1}, got ${event.sequence}`,
        });
      }

      // 2. Hash linkage
      const expectedPrevHash = previousEvent ? previousEvent.hash : '';
      if (event.prevHash !== expectedPrevHash) {
        // Allow first event in partial chain to have any prevHash
        if (i > 0) {
          errors.push({
            eventId: event.id,
            sequence: event.sequence,
            code: 'HASH_CHAIN_BROKEN',
            message: `Hash chain broken at sequence ${event.sequence}: prevHash does not match previous event's hash`,
          });
        }
      }

      // 3. Payload hash integrity
      const recomputedPayloadHash = HashChain.computePayloadHash(event.payload, hashAlgorithm);
      if (recomputedPayloadHash !== event.payloadHash) {
        errors.push({
          eventId: event.id,
          sequence: event.sequence,
          code: 'PAYLOAD_HASH_MISMATCH',
          message: `Payload hash mismatch at sequence ${event.sequence}: payload may have been tampered with`,
        });
      }

      // 4. Event hash integrity
      const recomputedEventHash = HashChain.computeEventHash(
        {
          sequence: event.sequence,
          type: event.type,
          timestamp: event.timestamp,
          agentId: event.agentId,
          prevHash: event.prevHash,
          payloadHash: event.payloadHash,
        },
        hashAlgorithm,
      );
      if (recomputedEventHash !== event.hash) {
        errors.push({
          eventId: event.id,
          sequence: event.sequence,
          code: 'EVENT_HASH_MISMATCH',
          message: `Event hash mismatch at sequence ${event.sequence}: event data may have been tampered with`,
        });
      }

      // 5. Signature verification
      if (event.signature && event.signature.length > 0) {
        const pubKey = publicKeyBase64 || event.signerPublicKey;
        if (pubKey) {
          try {
            const isValid = await AgentKeyManager.verifySignature(
              event.hash,
              event.signature,
              pubKey,
            );
            if (!isValid) {
              errors.push({
                eventId: event.id,
                sequence: event.sequence,
                code: 'SIGNATURE_INVALID',
                message: `Invalid signature at sequence ${event.sequence}`,
              });
            }
          } catch (e: any) {
            errors.push({
              eventId: event.id,
              sequence: event.sequence,
              code: 'SIGNATURE_INVALID',
              message: `Signature verification failed at sequence ${event.sequence}: ${e.message}`,
            });
          }
        } else {
          warnings.push(`Event ${event.id} (seq ${event.sequence}) has signature but no public key for verification.`);
        }
      }

      // 6. Timestamp monotonicity
      if (previousEvent) {
        const prevTime = new Date(previousEvent.timestamp).getTime();
        const currTime = new Date(event.timestamp).getTime();
        if (currTime < prevTime) {
          errors.push({
            eventId: event.id,
            sequence: event.sequence,
            code: 'TIMESTAMP_REGRESSION',
            message: `Timestamp regression at sequence ${event.sequence}: ${event.timestamp} is before ${previousEvent.timestamp}`,
          });
        }
      }

      previousEvent = event;
    }

    // Check agent ID consistency
    const agentIds = new Set(events.map(e => e.agentId));
    if (agentIds.size > 1) {
      warnings.push(`Multiple agent IDs found in chain: ${[...agentIds].join(', ')}. This may indicate events from different agents.`);
    }

    // Check signer key consistency
    const signerKeys = new Set(events.filter(e => e.signerPublicKey).map(e => e.signerPublicKey));
    if (signerKeys.size > 1) {
      warnings.push(`Multiple signer public keys found. Key rotation may have occurred.`);
    }

    return {
      valid: errors.length === 0,
      eventsVerified: events.length,
      errors,
      warnings,
      firstSequence: events[0].sequence,
      lastSequence: events[events.length - 1].sequence,
      agentId: events[0].agentId,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Quick integrity check - returns true/false without detailed errors.
   */
  static async isValid(
    events: SignedEvent[],
    publicKeyBase64?: string,
  ): Promise<boolean> {
    const result = await ChainVerifier.verify(events, publicKeyBase64);
    return result.valid;
  }

  /**
   * Verify a sub-chain (range of events) within a larger chain.
   * The first event's prevHash is trusted as a starting point.
   */
  static async verifySubChain(
    events: SignedEvent[],
    expectedStartPrevHash: string,
    publicKeyBase64?: string,
  ): Promise<VerificationResult> {
    if (events.length === 0) {
      return {
        valid: true,
        eventsVerified: 0,
        errors: [],
        warnings: ['Empty sub-chain provided.'],
        verifiedAt: new Date().toISOString(),
      };
    }

    const errors: VerificationError[] = [];

    // Verify the sub-chain connects to the expected starting point
    if (events[0].prevHash !== expectedStartPrevHash) {
      errors.push({
        eventId: events[0].id,
        sequence: events[0].sequence,
        code: 'HASH_CHAIN_BROKEN',
        message: `Sub-chain does not connect: expected prevHash '${expectedStartPrevHash}', got '${events[0].prevHash}'`,
      });
    }

    const chainResult = await ChainVerifier.verify(events, publicKeyBase64);

    return {
      ...chainResult,
      valid: chainResult.valid && errors.length === 0,
      errors: [...errors, ...chainResult.errors],
    };
  }
}

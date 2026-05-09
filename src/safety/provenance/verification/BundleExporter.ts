/**
 * @file BundleExporter.ts
 * @description Export and import verification bundles for offline chain verification.
 * Bundles contain events, anchors, public key, and a bundle-level signature.
 *
 * @module AgentOS/Provenance/Verification
 */

import type {
  SignedEvent,
  AnchorRecord,
  VerificationBundle,
  VerificationResult,
} from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
import { HashChain } from '../crypto/HashChain.js';
import { ChainVerifier } from './ChainVerifier.js';

// =============================================================================
// Anchor Storage Interface (subset)
// =============================================================================

interface AnchorStorageAdapter {
  all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
}

// =============================================================================
// BundleExporter
// =============================================================================

export class BundleExporter {
  private readonly ledger: SignedEventLedger;
  private readonly keyManager: AgentKeyManager;
  private readonly anchorStorage: AnchorStorageAdapter | null;
  private readonly tablePrefix: string;

  constructor(
    ledger: SignedEventLedger,
    keyManager: AgentKeyManager,
    anchorStorage: AnchorStorageAdapter | null = null,
    tablePrefix: string = '',
  ) {
    this.ledger = ledger;
    this.keyManager = keyManager;
    this.anchorStorage = anchorStorage;
    this.tablePrefix = tablePrefix;
  }

  /**
   * Export a verification bundle containing all events, anchors, and public key.
   * The bundle is signed for tamper evidence.
   *
   * @param fromSequence - Optional start sequence (inclusive). Defaults to 1.
   * @param toSequence - Optional end sequence (inclusive). Defaults to latest.
   * @returns A self-contained verification bundle.
   */
  async exportBundle(
    fromSequence?: number,
    toSequence?: number,
  ): Promise<VerificationBundle> {
    // Get events
    let events: SignedEvent[];
    if (fromSequence !== undefined && toSequence !== undefined) {
      events = await this.ledger.getEventsByRange(fromSequence, toSequence);
    } else {
      events = await this.ledger.getAllEvents();
    }

    // Get anchors
    let anchors: AnchorRecord[] = [];
    if (this.anchorStorage) {
      const rows = await this.anchorStorage.all<any>(
        `SELECT * FROM ${this.tablePrefix}anchors ORDER BY sequence_from ASC`,
      );
      anchors = rows.map(row => ({
        id: row.id,
        merkleRoot: row.merkle_root,
        sequenceFrom: row.sequence_from,
        sequenceTo: row.sequence_to,
        eventCount: row.event_count,
        signature: row.signature,
        timestamp: row.timestamp,
        externalRef: row.external_ref ?? undefined,
      }));

      // Filter anchors to the requested range
      if (fromSequence !== undefined || toSequence !== undefined) {
        anchors = anchors.filter(a => {
          if (fromSequence !== undefined && a.sequenceTo < fromSequence) return false;
          if (toSequence !== undefined && a.sequenceFrom > toSequence) return false;
          return true;
        });
      }
    }

    const publicKey = this.keyManager.getPublicKeyBase64();
    const exportedAt = new Date().toISOString();

    // Compute bundle hash (hash of all event hashes + anchor merkle roots)
    const contentHashes = [
      ...events.map(e => e.hash),
      ...anchors.map(a => a.merkleRoot),
    ];
    const bundleContentHash = HashChain.hash(contentHashes.join('|'));

    // Sign the bundle
    const bundleSignature = await this.keyManager.sign(bundleContentHash);

    const bundle: VerificationBundle = {
      version: '1.0.0',
      agentId: events.length > 0 ? events[0].agentId : '',
      publicKey,
      events,
      anchors,
      exportedAt,
      bundleHash: bundleContentHash,
      bundleSignature,
    };

    return bundle;
  }

  /**
   * Export a bundle as a JSONL string (one JSON object per line).
   * Format:
   *   Line 1: Bundle metadata (version, agentId, publicKey, exportedAt, bundleHash, bundleSignature)
   *   Lines 2-N: One event per line
   *   Lines N+1-M: One anchor per line (prefixed with type: 'anchor')
   */
  async exportAsJSONL(
    fromSequence?: number,
    toSequence?: number,
  ): Promise<string> {
    const bundle = await this.exportBundle(fromSequence, toSequence);
    const lines: string[] = [];

    // Metadata line
    lines.push(JSON.stringify({
      type: 'metadata',
      version: bundle.version,
      agentId: bundle.agentId,
      publicKey: bundle.publicKey,
      exportedAt: bundle.exportedAt,
      bundleHash: bundle.bundleHash,
      bundleSignature: bundle.bundleSignature,
      eventCount: bundle.events.length,
      anchorCount: bundle.anchors.length,
    }));

    // Event lines
    for (const event of bundle.events) {
      lines.push(JSON.stringify({ _line: 'event', ...event }));
    }

    // Anchor lines
    for (const anchor of bundle.anchors) {
      lines.push(JSON.stringify({ _line: 'anchor', ...anchor }));
    }

    return lines.join('\n');
  }

  /**
   * Import and verify a bundle. Works completely offline (no DB required).
   *
   * @param bundle - The verification bundle to verify.
   * @returns Verification result.
   */
  static async importAndVerify(bundle: VerificationBundle): Promise<VerificationResult> {
    const errors: VerificationResult['errors'] = [];
    const warnings: string[] = [];

    // 1. Verify bundle signature
    const contentHashes = [
      ...bundle.events.map(e => e.hash),
      ...bundle.anchors.map(a => a.merkleRoot),
    ];
    const recomputedBundleHash = HashChain.hash(contentHashes.join('|'));

    if (recomputedBundleHash !== bundle.bundleHash) {
      errors.push({
        eventId: '',
        sequence: 0,
        code: 'BUNDLE_HASH_MISMATCH',
        message: 'Bundle content hash does not match. Bundle may have been tampered with.',
      });
    }

    if (bundle.bundleSignature && bundle.publicKey) {
      try {
        const sigValid = await AgentKeyManager.verifySignature(
          bundle.bundleHash,
          bundle.bundleSignature,
          bundle.publicKey,
        );
        if (!sigValid) {
          errors.push({
            eventId: '',
            sequence: 0,
            code: 'BUNDLE_SIGNATURE_INVALID',
            message: 'Bundle signature is invalid.',
          });
        }
      } catch (e: any) {
        errors.push({
          eventId: '',
          sequence: 0,
          code: 'BUNDLE_SIGNATURE_INVALID',
          message: `Bundle signature verification failed: ${e.message}`,
        });
      }
    }

    // 2. Verify the event chain
    const chainResult = await ChainVerifier.verify(
      bundle.events,
      bundle.publicKey,
    );

    // 3. Verify anchors reference valid event ranges
    for (const anchor of bundle.anchors) {
      const anchorEvents = bundle.events.filter(
        e => e.sequence >= anchor.sequenceFrom && e.sequence <= anchor.sequenceTo,
      );

      if (anchorEvents.length !== anchor.eventCount) {
        warnings.push(
          `Anchor ${anchor.id}: expected ${anchor.eventCount} events in range [${anchor.sequenceFrom}, ${anchor.sequenceTo}], found ${anchorEvents.length} in bundle.`,
        );
      }

      // Verify anchor signature
      if (anchor.signature && bundle.publicKey) {
        try {
          const sigValid = await AgentKeyManager.verifySignature(
            anchor.merkleRoot,
            anchor.signature,
            bundle.publicKey,
          );
          if (!sigValid) {
            errors.push({
              eventId: anchor.id,
              sequence: anchor.sequenceFrom,
              code: 'ANCHOR_SIGNATURE_INVALID',
              message: `Anchor ${anchor.id} signature is invalid.`,
            });
          }
        } catch (e: any) {
          errors.push({
            eventId: anchor.id,
            sequence: anchor.sequenceFrom,
            code: 'ANCHOR_SIGNATURE_INVALID',
            message: `Anchor ${anchor.id} signature verification failed: ${e.message}`,
          });
        }
      }
    }

    return {
      valid: errors.length === 0 && chainResult.valid,
      eventsVerified: bundle.events.length,
      errors: [...errors, ...chainResult.errors],
      warnings: [...warnings, ...chainResult.warnings],
      firstSequence: bundle.events.length > 0 ? bundle.events[0].sequence : undefined,
      lastSequence: bundle.events.length > 0 ? bundle.events[bundle.events.length - 1].sequence : undefined,
      agentId: bundle.agentId,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse a JSONL bundle string back into a VerificationBundle.
   */
  static parseJSONL(jsonl: string): VerificationBundle {
    const lines = jsonl.trim().split('\n').filter(l => l.length > 0);
    if (lines.length === 0) {
      throw new Error('Empty JSONL bundle');
    }

    const metadataLine = JSON.parse(lines[0]);
    if (metadataLine.type !== 'metadata') {
      throw new Error('First line must be metadata');
    }

    const events: SignedEvent[] = [];
    const anchors: AnchorRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const obj = JSON.parse(lines[i]);
      if (obj._line === 'event') {
        const { _line, ...event } = obj;
        events.push(event as SignedEvent);
      } else if (obj._line === 'anchor') {
        const { _line, ...anchor } = obj;
        anchors.push(anchor as AnchorRecord);
      }
    }

    return {
      version: metadataLine.version,
      agentId: metadataLine.agentId,
      publicKey: metadataLine.publicKey,
      events,
      anchors,
      exportedAt: metadataLine.exportedAt,
      bundleHash: metadataLine.bundleHash,
      bundleSignature: metadataLine.bundleSignature,
    };
  }
}

/**
 * @file AnchorManager.ts
 * @description Periodic Merkle root anchoring for tamper evidence.
 * Computes Merkle roots over batches of signed events and signs them.
 *
 * @module AgentOS/Provenance/Anchoring
 */

import { v4 as uuidv4 } from 'uuid';
import type { AnchorRecord, AnchorProvider, ProvenanceSystemConfig } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { AgentKeyManager } from '../crypto/AgentKeyManager.js';
import { MerkleTree } from '../crypto/MerkleTree.js';

// =============================================================================
// Anchor Storage Interface (subset)
// =============================================================================

interface AnchorStorageAdapter {
  run(statement: string, parameters?: unknown[]): Promise<{ changes: number }>;
  all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
  get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}

// =============================================================================
// AnchorManager
// =============================================================================

export class AnchorManager {
  private readonly storageAdapter: AnchorStorageAdapter;
  private readonly ledger: SignedEventLedger;
  private readonly keyManager: AgentKeyManager;
  private readonly config: ProvenanceSystemConfig;
  private readonly tablePrefix: string;
  private readonly provider: AnchorProvider | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(
    storageAdapter: AnchorStorageAdapter,
    ledger: SignedEventLedger,
    keyManager: AgentKeyManager,
    config: ProvenanceSystemConfig,
    tablePrefix: string = '',
    provider?: AnchorProvider,
  ) {
    this.storageAdapter = storageAdapter;
    this.ledger = ledger;
    this.keyManager = keyManager;
    this.config = config;
    this.tablePrefix = tablePrefix;
    this.provider = provider ?? null;
  }

  /**
   * Start periodic anchoring at the configured interval.
   */
  start(): void {
    if (this.isRunning || this.config.anchorIntervalMs <= 0) {
      return;
    }

    this.isRunning = true;
    this.timer = setInterval(async () => {
      try {
        await this.createAnchorIfNeeded();
      } catch (e) {
        // Log but don't crash on anchor failures
        console.error('AnchorManager: Failed to create anchor:', e);
      }
    }, this.config.anchorIntervalMs);

    // Don't prevent process exit
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer as any).unref();
    }
  }

  /**
   * Stop periodic anchoring.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.provider?.dispose?.().catch(() => {});
  }

  /**
   * Create an anchor if there are enough new events since the last anchor.
   * Returns the new anchor record, or null if no anchor was needed.
   */
  async createAnchorIfNeeded(): Promise<AnchorRecord | null> {
    const lastAnchor = await this.getLastAnchor();
    const fromSequence = lastAnchor ? lastAnchor.sequenceTo + 1 : 1;

    // Get events since the last anchor
    const { sequence: currentSequence } = this.ledger.getChainState();
    if (currentSequence < fromSequence) {
      return null; // No new events
    }

    const eventCount = currentSequence - fromSequence + 1;
    if (eventCount < this.config.anchorBatchSize) {
      return null; // Not enough events for an anchor
    }

    return this.createAnchor(fromSequence, currentSequence);
  }

  /**
   * Force-create an anchor for a specific event range.
   *
   * @param fromSequence - Start sequence (inclusive).
   * @param toSequence - End sequence (inclusive).
   * @returns The new anchor record.
   */
  async createAnchor(fromSequence: number, toSequence: number): Promise<AnchorRecord> {
    const events = await this.ledger.getEventsByRange(fromSequence, toSequence);

    if (events.length === 0) {
      throw new Error(`No events found in range [${fromSequence}, ${toSequence}]`);
    }

    // Compute Merkle root from event hashes
    const leafHashes = events.map(e => e.hash);
    const merkleRoot = MerkleTree.computeRoot(leafHashes);

    // Sign the Merkle root
    const signature = await this.keyManager.sign(merkleRoot);

    const id = uuidv4();
    const timestamp = new Date().toISOString();

    const anchor: AnchorRecord = {
      id,
      merkleRoot,
      sequenceFrom: fromSequence,
      sequenceTo: toSequence,
      eventCount: events.length,
      signature,
      timestamp,
    };

    // Persist anchor
    await this.storageAdapter.run(
      `INSERT INTO ${this.tablePrefix}anchors
       (id, merkle_root, sequence_from, sequence_to, event_count, signature, timestamp, external_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        anchor.id,
        anchor.merkleRoot,
        anchor.sequenceFrom,
        anchor.sequenceTo,
        anchor.eventCount,
        anchor.signature,
        anchor.timestamp,
        anchor.externalRef ?? null,
      ],
    );

    // Log the anchor creation as an event in the ledger
    await this.ledger.appendEvent('anchor.created', {
      anchorId: anchor.id,
      merkleRoot: anchor.merkleRoot,
      sequenceFrom: anchor.sequenceFrom,
      sequenceTo: anchor.sequenceTo,
      eventCount: anchor.eventCount,
    });

    // Fire off external publishing (non-blocking)
    if (this.provider) {
      this.publishExternally(anchor).catch(err => {
        console.error('AnchorManager: External publish failed (non-blocking):', err);
      });
    }

    return anchor;
  }

  /**
   * Publish an anchor to the external provider and update the DB with the result.
   * Designed to be called in a fire-and-forget manner.
   * Failures are logged but never propagated.
   */
  private async publishExternally(anchor: AnchorRecord): Promise<void> {
    if (!this.provider) return;

    try {
      const result = await this.provider.publish(anchor);

      if (result.success && result.externalRef) {
        await this.storageAdapter.run(
          `UPDATE ${this.tablePrefix}anchors SET external_ref = ? WHERE id = ?`,
          [result.externalRef, anchor.id],
        );
        anchor.externalRef = result.externalRef;
      }
    } catch (err) {
      console.error(`AnchorManager: External publish error for anchor ${anchor.id}:`, err);
    }
  }

  /**
   * Get the current anchor provider, if any.
   */
  getProvider(): AnchorProvider | null {
    return this.provider;
  }

  /**
   * Get the most recent anchor.
   */
  async getLastAnchor(): Promise<AnchorRecord | null> {
    const row = await this.storageAdapter.get<any>(
      `SELECT * FROM ${this.tablePrefix}anchors ORDER BY sequence_to DESC LIMIT 1`,
    );
    return row ? this.rowToAnchor(row) : null;
  }

  /**
   * Get all anchors (ordered by sequence range).
   */
  async getAllAnchors(): Promise<AnchorRecord[]> {
    const rows = await this.storageAdapter.all<any>(
      `SELECT * FROM ${this.tablePrefix}anchors ORDER BY sequence_from ASC`,
    );
    return rows.map(r => this.rowToAnchor(r));
  }

  /**
   * Get the anchor covering a specific sequence number.
   */
  async getAnchorForSequence(sequence: number): Promise<AnchorRecord | null> {
    const row = await this.storageAdapter.get<any>(
      `SELECT * FROM ${this.tablePrefix}anchors
       WHERE sequence_from <= ? AND sequence_to >= ?
       LIMIT 1`,
      [sequence, sequence],
    );
    return row ? this.rowToAnchor(row) : null;
  }

  /**
   * Verify an anchor's Merkle root against the actual events.
   */
  async verifyAnchor(anchorId: string): Promise<{
    valid: boolean;
    anchor: AnchorRecord;
    errors: string[];
  }> {
    const row = await this.storageAdapter.get<any>(
      `SELECT * FROM ${this.tablePrefix}anchors WHERE id = ?`,
      [anchorId],
    );

    if (!row) {
      throw new Error(`Anchor not found: ${anchorId}`);
    }

    const anchor = this.rowToAnchor(row);
    const errors: string[] = [];

    // Get events in the anchor's range
    const events = await this.ledger.getEventsByRange(anchor.sequenceFrom, anchor.sequenceTo);

    // Check event count
    if (events.length !== anchor.eventCount) {
      errors.push(
        `Event count mismatch: anchor says ${anchor.eventCount}, found ${events.length}`,
      );
    }

    // Recompute Merkle root
    const leafHashes = events.map(e => e.hash);
    const recomputedRoot = MerkleTree.computeRoot(leafHashes);

    if (recomputedRoot !== anchor.merkleRoot) {
      errors.push('Merkle root mismatch: events may have been tampered with');
    }

    // Verify anchor signature
    if (anchor.signature) {
      try {
        const pubKey = this.keyManager.getPublicKeyBase64();
        const sigValid = await AgentKeyManager.verifySignature(
          anchor.merkleRoot,
          anchor.signature,
          pubKey,
        );
        if (!sigValid) {
          errors.push('Anchor signature is invalid');
        }
      } catch (e: any) {
        errors.push(`Anchor signature verification failed: ${e.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      anchor,
      errors,
    };
  }

  /**
   * Check if the manager is currently running periodic anchoring.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private rowToAnchor(row: any): AnchorRecord {
    return {
      id: row.id,
      merkleRoot: row.merkle_root,
      sequenceFrom: row.sequence_from,
      sequenceTo: row.sequence_to,
      eventCount: row.event_count,
      signature: row.signature,
      timestamp: row.timestamp,
      externalRef: row.external_ref ?? undefined,
    };
  }
}

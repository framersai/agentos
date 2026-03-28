/**
 * @file RevisionManager.ts
 * @description Captures row snapshots before UPDATE operations in revisioned mode.
 * Creates revision records so the full history of every row is preserved.
 *
 * @module AgentOS/Provenance/Enforcement
 */

import { v4 as uuidv4 } from 'uuid';
import type { RevisionRecord } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';
import { HashChain } from '../crypto/HashChain.js';

// =============================================================================
// Storage Adapter Interface (subset)
// =============================================================================

interface RevisionStorageAdapter {
  run(statement: string, parameters?: unknown[]): Promise<{ changes: number }>;
  all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
  get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}

// =============================================================================
// RevisionManager
// =============================================================================

export class RevisionManager {
  private readonly storageAdapter: RevisionStorageAdapter;
  private readonly ledger: SignedEventLedger | null;
  private readonly tablePrefix: string;

  constructor(
    storageAdapter: RevisionStorageAdapter,
    ledger: SignedEventLedger | null = null,
    tablePrefix: string = '',
  ) {
    this.storageAdapter = storageAdapter;
    this.ledger = ledger;
    this.tablePrefix = tablePrefix;
  }

  /**
   * Capture the current state of records that are about to be updated.
   * Call this BEFORE the UPDATE executes.
   *
   * @param tableName - The table being updated.
   * @param whereClause - The WHERE clause from the UPDATE statement (without "WHERE").
   * @param parameters - Parameters for the WHERE clause.
   */
  async captureRevision(
    tableName: string,
    whereClause: string,
    parameters: unknown[] = [],
  ): Promise<RevisionRecord[]> {
    // Fetch current rows that match the WHERE clause
    const rows = await this.storageAdapter.all<any>(
      `SELECT * FROM ${tableName} WHERE ${whereClause}`,
      parameters,
    );

    const revisions: RevisionRecord[] = [];

    for (const row of rows) {
      // Determine the record ID (use 'id' column by convention)
      const recordId = row.id ?? row.Id ?? row.ID ?? JSON.stringify(row);

      // Get the current revision number for this record
      const lastRevision = await this.storageAdapter.get<{ revision_number: number }>(
        `SELECT MAX(revision_number) as revision_number FROM ${this.tablePrefix}revisions
         WHERE table_name = ? AND record_id = ?`,
        [tableName, String(recordId)],
      );

      const revisionNumber = (lastRevision?.revision_number ?? 0) + 1;
      const snapshot = JSON.stringify(row);
      const timestamp = new Date().toISOString();
      const id = uuidv4();

      // Log to signed event ledger
      let eventId = id; // fallback
      if (this.ledger) {
        const event = await this.ledger.appendEvent('message.revised', {
          tableName,
          recordId: String(recordId),
          revisionNumber,
          previousContentHash: HashChain.computePayloadHash(row),
        });
        eventId = event.id;
      }

      // Insert revision record
      await this.storageAdapter.run(
        `INSERT INTO ${this.tablePrefix}revisions
         (id, table_name, record_id, revision_number, snapshot, event_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, tableName, String(recordId), revisionNumber, snapshot, eventId, timestamp],
      );

      revisions.push({
        id,
        tableName,
        recordId: String(recordId),
        revisionNumber,
        snapshot,
        eventId,
        timestamp,
      });
    }

    return revisions;
  }

  /**
   * Get all revisions for a specific record.
   */
  async getRevisions(tableName: string, recordId: string): Promise<RevisionRecord[]> {
    const rows = await this.storageAdapter.all<any>(
      `SELECT * FROM ${this.tablePrefix}revisions
       WHERE table_name = ? AND record_id = ?
       ORDER BY revision_number ASC`,
      [tableName, recordId],
    );

    return rows.map(row => ({
      id: row.id,
      tableName: row.table_name,
      recordId: row.record_id,
      revisionNumber: row.revision_number,
      snapshot: row.snapshot,
      eventId: row.event_id,
      timestamp: row.timestamp,
    }));
  }

  /**
   * Get the latest revision for a specific record.
   */
  async getLatestRevision(tableName: string, recordId: string): Promise<RevisionRecord | null> {
    const row = await this.storageAdapter.get<any>(
      `SELECT * FROM ${this.tablePrefix}revisions
       WHERE table_name = ? AND record_id = ?
       ORDER BY revision_number DESC LIMIT 1`,
      [tableName, recordId],
    );

    if (!row) return null;

    return {
      id: row.id,
      tableName: row.table_name,
      recordId: row.record_id,
      revisionNumber: row.revision_number,
      snapshot: row.snapshot,
      eventId: row.event_id,
      timestamp: row.timestamp,
    };
  }
}

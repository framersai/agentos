/**
 * @file TombstoneManager.ts
 * @description Manages soft-deletion via tombstone records.
 * In revisioned/sealed modes, DELETE operations are converted to tombstones.
 *
 * @module AgentOS/Provenance/Enforcement
 */

import { v4 as uuidv4 } from 'uuid';
import type { TombstoneRecord } from '../types.js';
import type { SignedEventLedger } from '../ledger/SignedEventLedger.js';

// =============================================================================
// Storage Adapter Interface (subset)
// =============================================================================

interface TombstoneStorageAdapter {
  run(statement: string, parameters?: unknown[]): Promise<{ changes: number }>;
  all<T = unknown>(statement: string, parameters?: unknown[]): Promise<T[]>;
  get<T = unknown>(statement: string, parameters?: unknown[]): Promise<T | null>;
}

// =============================================================================
// TombstoneManager
// =============================================================================

export class TombstoneManager {
  private readonly storageAdapter: TombstoneStorageAdapter;
  private readonly ledger: SignedEventLedger | null;
  private readonly tablePrefix: string;

  constructor(
    storageAdapter: TombstoneStorageAdapter,
    ledger: SignedEventLedger | null = null,
    tablePrefix: string = '',
  ) {
    this.storageAdapter = storageAdapter;
    this.ledger = ledger;
    this.tablePrefix = tablePrefix;
  }

  /**
   * Create a tombstone for records about to be deleted.
   * Call this INSTEAD of executing the DELETE.
   *
   * @param tableName - The table the records belong to.
   * @param whereClause - The WHERE clause from the DELETE statement.
   * @param parameters - Parameters for the WHERE clause.
   * @param reason - Reason for deletion.
   * @param initiator - Who initiated the deletion (agent ID or 'human').
   */
  async createTombstone(
    tableName: string,
    whereClause: string,
    parameters: unknown[] = [],
    reason: string = 'deleted',
    initiator: string = 'system',
  ): Promise<TombstoneRecord[]> {
    // Fetch the records that would be deleted
    const rows = await this.storageAdapter.all<any>(
      `SELECT * FROM ${tableName} WHERE ${whereClause}`,
      parameters,
    );

    const tombstones: TombstoneRecord[] = [];

    for (const row of rows) {
      const recordId = String(row.id ?? row.Id ?? row.ID ?? JSON.stringify(row));
      const timestamp = new Date().toISOString();
      const id = uuidv4();

      // Check if already tombstoned
      const existing = await this.storageAdapter.get<any>(
        `SELECT id FROM ${this.tablePrefix}tombstones WHERE table_name = ? AND record_id = ?`,
        [tableName, recordId],
      );

      if (existing) {
        // Already tombstoned, skip
        continue;
      }

      // Log to signed event ledger
      let eventId = id; // fallback
      if (this.ledger) {
        const eventType = tableName.includes('message')
          ? 'message.tombstoned' as const
          : tableName.includes('conversation')
            ? 'conversation.tombstoned' as const
            : 'memory.tombstoned' as const;

        const event = await this.ledger.appendEvent(eventType, {
          tableName,
          recordId,
          reason,
          initiator,
        });
        eventId = event.id;
      }

      // Insert tombstone record
      await this.storageAdapter.run(
        `INSERT INTO ${this.tablePrefix}tombstones
         (id, table_name, record_id, reason, event_id, initiator, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, tableName, recordId, reason, eventId, initiator, timestamp],
      );

      tombstones.push({
        id,
        tableName,
        recordId,
        reason,
        eventId,
        initiator,
        timestamp,
      });
    }

    return tombstones;
  }

  /**
   * Check if a record has been tombstoned.
   */
  async isTombstoned(tableName: string, recordId: string): Promise<boolean> {
    const row = await this.storageAdapter.get<any>(
      `SELECT id FROM ${this.tablePrefix}tombstones WHERE table_name = ? AND record_id = ?`,
      [tableName, recordId],
    );
    return row !== null;
  }

  /**
   * Get the tombstone record for a specific record.
   */
  async getTombstone(tableName: string, recordId: string): Promise<TombstoneRecord | null> {
    const row = await this.storageAdapter.get<any>(
      `SELECT * FROM ${this.tablePrefix}tombstones WHERE table_name = ? AND record_id = ?`,
      [tableName, recordId],
    );

    if (!row) return null;

    return {
      id: row.id,
      tableName: row.table_name,
      recordId: row.record_id,
      reason: row.reason,
      eventId: row.event_id,
      initiator: row.initiator,
      timestamp: row.timestamp,
    };
  }

  /**
   * Get all tombstones for a table.
   */
  async getTombstones(tableName?: string): Promise<TombstoneRecord[]> {
    let sql = `SELECT * FROM ${this.tablePrefix}tombstones`;
    const params: unknown[] = [];

    if (tableName) {
      sql += ' WHERE table_name = ?';
      params.push(tableName);
    }

    sql += ' ORDER BY timestamp DESC';

    const rows = await this.storageAdapter.all<any>(sql, params);
    return rows.map(row => ({
      id: row.id,
      tableName: row.table_name,
      recordId: row.record_id,
      reason: row.reason,
      eventId: row.event_id,
      initiator: row.initiator,
      timestamp: row.timestamp,
    }));
  }
}

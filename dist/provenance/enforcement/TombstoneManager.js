/**
 * @file TombstoneManager.ts
 * @description Manages soft-deletion via tombstone records.
 * In revisioned/sealed modes, DELETE operations are converted to tombstones.
 *
 * @module AgentOS/Provenance/Enforcement
 */
import { v4 as uuidv4 } from 'uuid';
// =============================================================================
// TombstoneManager
// =============================================================================
export class TombstoneManager {
    constructor(storageAdapter, ledger = null, tablePrefix = '') {
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
    async createTombstone(tableName, whereClause, parameters = [], reason = 'deleted', initiator = 'system') {
        // Fetch the records that would be deleted
        const rows = await this.storageAdapter.all(`SELECT * FROM ${tableName} WHERE ${whereClause}`, parameters);
        const tombstones = [];
        for (const row of rows) {
            const recordId = String(row.id ?? row.Id ?? row.ID ?? JSON.stringify(row));
            const timestamp = new Date().toISOString();
            const id = uuidv4();
            // Check if already tombstoned
            const existing = await this.storageAdapter.get(`SELECT id FROM ${this.tablePrefix}tombstones WHERE table_name = ? AND record_id = ?`, [tableName, recordId]);
            if (existing) {
                // Already tombstoned, skip
                continue;
            }
            // Log to signed event ledger
            let eventId = id; // fallback
            if (this.ledger) {
                const eventType = tableName.includes('message')
                    ? 'message.tombstoned'
                    : tableName.includes('conversation')
                        ? 'conversation.tombstoned'
                        : 'memory.tombstoned';
                const event = await this.ledger.appendEvent(eventType, {
                    tableName,
                    recordId,
                    reason,
                    initiator,
                });
                eventId = event.id;
            }
            // Insert tombstone record
            await this.storageAdapter.run(`INSERT INTO ${this.tablePrefix}tombstones
         (id, table_name, record_id, reason, event_id, initiator, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, tableName, recordId, reason, eventId, initiator, timestamp]);
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
    async isTombstoned(tableName, recordId) {
        const row = await this.storageAdapter.get(`SELECT id FROM ${this.tablePrefix}tombstones WHERE table_name = ? AND record_id = ?`, [tableName, recordId]);
        return row !== null;
    }
    /**
     * Get the tombstone record for a specific record.
     */
    async getTombstone(tableName, recordId) {
        const row = await this.storageAdapter.get(`SELECT * FROM ${this.tablePrefix}tombstones WHERE table_name = ? AND record_id = ?`, [tableName, recordId]);
        if (!row)
            return null;
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
    async getTombstones(tableName) {
        let sql = `SELECT * FROM ${this.tablePrefix}tombstones`;
        const params = [];
        if (tableName) {
            sql += ' WHERE table_name = ?';
            params.push(tableName);
        }
        sql += ' ORDER BY timestamp DESC';
        const rows = await this.storageAdapter.all(sql, params);
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
//# sourceMappingURL=TombstoneManager.js.map
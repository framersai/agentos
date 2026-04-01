/**
 * @file SignedEventLedger.ts
 * @description Core append-only signed event log with hash chain and Ed25519 signatures.
 * All events are sequenced, hashed, and signed to create a tamper-evident chain.
 *
 * @module AgentOS/Provenance/Ledger
 */
import { v4 as uuidv4 } from 'uuid';
import { HashChain } from '../crypto/HashChain.js';
// =============================================================================
// SignedEventLedger
// =============================================================================
export class SignedEventLedger {
    constructor(storageAdapter, keyManager, agentId, config, tablePrefix = '') {
        this.isInitialized = false;
        // Mutex for serialized appends (hash chain requires sequential writes)
        this.appendQueue = Promise.resolve();
        this.storageAdapter = storageAdapter;
        this.keyManager = keyManager;
        this.agentId = agentId;
        this.config = config;
        this.tablePrefix = tablePrefix;
        this.chain = new HashChain();
    }
    /**
     * Initialize the ledger: load the last sequence number and hash from the DB.
     */
    async initialize() {
        const lastEvent = await this.storageAdapter.get(`SELECT sequence, hash FROM ${this.tablePrefix}signed_events
       WHERE agent_id = ?
       ORDER BY sequence DESC LIMIT 1`, [this.agentId]);
        if (lastEvent) {
            this.chain = new HashChain(lastEvent.hash, lastEvent.sequence);
        }
        else {
            this.chain = new HashChain('', 0);
        }
        this.isInitialized = true;
    }
    /**
     * Append a new event to the ledger.
     * Serialized via internal queue to maintain hash chain integrity.
     */
    async appendEvent(type, payload) {
        if (!this.isInitialized) {
            throw new Error('SignedEventLedger: not initialized. Call initialize() first.');
        }
        return new Promise((resolve, reject) => {
            this.appendQueue = this.appendQueue.then(async () => {
                try {
                    const event = await this.doAppend(type, payload);
                    resolve(event);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    }
    async doAppend(type, payload) {
        const { sequence, prevHash } = this.chain.advance();
        const timestamp = new Date().toISOString();
        const id = uuidv4();
        // Compute payload hash
        const payloadHash = HashChain.computePayloadHash(payload, this.config.hashAlgorithm);
        // Compute event hash
        const hash = HashChain.computeEventHash({ sequence, type, timestamp, agentId: this.agentId, prevHash, payloadHash }, this.config.hashAlgorithm);
        // Sign the hash
        let signature = '';
        if (this.config.signatureMode === 'every-event') {
            signature = await this.keyManager.sign(hash);
        }
        const event = {
            id,
            type,
            timestamp,
            sequence,
            agentId: this.agentId,
            prevHash,
            hash,
            payloadHash,
            payload,
            signature,
            signerPublicKey: this.keyManager.getPublicKeyBase64(),
        };
        // Persist to database
        await this.storageAdapter.run(`INSERT INTO ${this.tablePrefix}signed_events
       (id, type, timestamp, sequence, agent_id, prev_hash, hash, payload_hash, payload, signature, signer_public_key, anchor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            event.id,
            event.type,
            event.timestamp,
            event.sequence,
            event.agentId,
            event.prevHash,
            event.hash,
            event.payloadHash,
            JSON.stringify(event.payload),
            event.signature,
            event.signerPublicKey,
            event.anchorId ?? null,
        ]);
        // Update chain state
        this.chain.recordHash(hash);
        return event;
    }
    /**
     * Get a single event by ID.
     */
    async getEvent(id) {
        const row = await this.storageAdapter.get(`SELECT * FROM ${this.tablePrefix}signed_events WHERE id = ?`, [id]);
        return row ? this.rowToEvent(row) : null;
    }
    /**
     * Get events in a sequence range (inclusive).
     */
    async getEventsByRange(fromSequence, toSequence) {
        const rows = await this.storageAdapter.all(`SELECT * FROM ${this.tablePrefix}signed_events
       WHERE agent_id = ? AND sequence >= ? AND sequence <= ?
       ORDER BY sequence ASC`, [this.agentId, fromSequence, toSequence]);
        return rows.map(r => this.rowToEvent(r));
    }
    /**
     * Get events by type.
     */
    async getEventsByType(type) {
        const rows = await this.storageAdapter.all(`SELECT * FROM ${this.tablePrefix}signed_events
       WHERE agent_id = ? AND type = ?
       ORDER BY sequence ASC`, [this.agentId, type]);
        return rows.map(r => this.rowToEvent(r));
    }
    /**
     * Get events matching a payload filter (searches JSON payload).
     */
    async getEventsByPayloadFilter(filter, types) {
        // Get all events (optionally filtered by type) and apply payload filter in memory
        let sql = `SELECT * FROM ${this.tablePrefix}signed_events WHERE agent_id = ?`;
        const params = [this.agentId];
        if (types && types.length > 0) {
            const placeholders = types.map(() => '?').join(', ');
            sql += ` AND type IN (${placeholders})`;
            params.push(...types);
        }
        sql += ' ORDER BY sequence ASC';
        const rows = await this.storageAdapter.all(sql, params);
        const events = rows.map(r => this.rowToEvent(r));
        // Filter by payload fields
        return events.filter(event => {
            for (const [key, value] of Object.entries(filter)) {
                if (event.payload[key] !== value)
                    return false;
            }
            return true;
        });
    }
    /**
     * Get the latest event.
     */
    async getLatestEvent() {
        const row = await this.storageAdapter.get(`SELECT * FROM ${this.tablePrefix}signed_events
       WHERE agent_id = ?
       ORDER BY sequence DESC LIMIT 1`, [this.agentId]);
        return row ? this.rowToEvent(row) : null;
    }
    /**
     * Get the total number of events for this agent.
     */
    async getEventCount() {
        const row = await this.storageAdapter.get(`SELECT COUNT(*) as count FROM ${this.tablePrefix}signed_events WHERE agent_id = ?`, [this.agentId]);
        return row?.count ?? 0;
    }
    /**
     * Get all events for this agent (ordered by sequence).
     */
    async getAllEvents() {
        const rows = await this.storageAdapter.all(`SELECT * FROM ${this.tablePrefix}signed_events
       WHERE agent_id = ?
       ORDER BY sequence ASC`, [this.agentId]);
        return rows.map(r => this.rowToEvent(r));
    }
    /**
     * Get the current chain state (for diagnostics).
     */
    getChainState() {
        return {
            lastHash: this.chain.getLastHash(),
            sequence: this.chain.getSequence(),
        };
    }
    // ===========================================================================
    // Internal
    // ===========================================================================
    rowToEvent(row) {
        return {
            id: row.id,
            type: row.type,
            timestamp: row.timestamp,
            sequence: row.sequence,
            agentId: row.agent_id,
            prevHash: row.prev_hash,
            hash: row.hash,
            payloadHash: row.payload_hash,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            signature: row.signature,
            signerPublicKey: row.signer_public_key,
            anchorId: row.anchor_id ?? undefined,
        };
    }
}
//# sourceMappingURL=SignedEventLedger.js.map
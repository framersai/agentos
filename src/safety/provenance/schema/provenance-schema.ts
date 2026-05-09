/**
 * @file provenance-schema.ts
 * @description SQL schema definitions for the provenance system.
 * Creates tables for signed events, revisions, tombstones, anchors, and agent keys.
 * Compatible with SQLite, PostgreSQL, and IndexedDB via sql-storage-adapter.
 *
 * @module AgentOS/Provenance/Schema
 */

/**
 * Generate the provenance schema SQL with an optional table prefix.
 */
export function getProvenanceSchema(prefix: string = ''): string {
  return `
    CREATE TABLE IF NOT EXISTS ${prefix}signed_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      signer_public_key TEXT NOT NULL,
      anchor_id TEXT,
      UNIQUE(agent_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_${prefix}signed_events_agent_seq
      ON ${prefix}signed_events(agent_id, sequence);

    CREATE INDEX IF NOT EXISTS idx_${prefix}signed_events_type
      ON ${prefix}signed_events(type);

    CREATE INDEX IF NOT EXISTS idx_${prefix}signed_events_timestamp
      ON ${prefix}signed_events(timestamp);

    CREATE INDEX IF NOT EXISTS idx_${prefix}signed_events_anchor
      ON ${prefix}signed_events(anchor_id);

    CREATE TABLE IF NOT EXISTS ${prefix}revisions (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      event_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(table_name, record_id, revision_number),
      FOREIGN KEY (event_id) REFERENCES ${prefix}signed_events(id)
    );

    CREATE INDEX IF NOT EXISTS idx_${prefix}revisions_record
      ON ${prefix}revisions(table_name, record_id);

    CREATE TABLE IF NOT EXISTS ${prefix}tombstones (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      event_id TEXT NOT NULL,
      initiator TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(table_name, record_id),
      FOREIGN KEY (event_id) REFERENCES ${prefix}signed_events(id)
    );

    CREATE INDEX IF NOT EXISTS idx_${prefix}tombstones_record
      ON ${prefix}tombstones(table_name, record_id);

    CREATE TABLE IF NOT EXISTS ${prefix}anchors (
      id TEXT PRIMARY KEY,
      merkle_root TEXT NOT NULL,
      sequence_from INTEGER NOT NULL,
      sequence_to INTEGER NOT NULL,
      event_count INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      signature TEXT NOT NULL,
      external_ref TEXT
    );

    CREATE TABLE IF NOT EXISTS ${prefix}agent_keys (
      agent_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      encrypted_private_key TEXT,
      created_at TEXT NOT NULL,
      key_algorithm TEXT NOT NULL DEFAULT 'Ed25519'
    );
  `;
}

/**
 * Generate SQL to drop all provenance tables (for testing/cleanup).
 */
export function getProvenanceDropSchema(prefix: string = ''): string {
  return `
    DROP TABLE IF EXISTS ${prefix}signed_events;
    DROP TABLE IF EXISTS ${prefix}revisions;
    DROP TABLE IF EXISTS ${prefix}tombstones;
    DROP TABLE IF EXISTS ${prefix}anchors;
    DROP TABLE IF EXISTS ${prefix}agent_keys;
  `;
}

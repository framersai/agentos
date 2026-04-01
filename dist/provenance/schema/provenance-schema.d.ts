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
export declare function getProvenanceSchema(prefix?: string): string;
/**
 * Generate SQL to drop all provenance tables (for testing/cleanup).
 */
export declare function getProvenanceDropSchema(prefix?: string): string;
//# sourceMappingURL=provenance-schema.d.ts.map
/**
 * @fileoverview Shared helpers for persisting trace metadata in SQLite-first
 * memory paths.
 *
 * The Phase 1 memory facade stores core retrieval counters in dedicated
 * columns, but richer decay state is persisted inside `memory_traces.metadata`
 * to avoid a schema expansion. These helpers keep that JSON contract
 * consistent across the facade, consolidation loop, feedback loop, and
 * agent-facing memory tools.
 *
 * @module memory/store/tracePersistence
 */
/**
 * Default stability for traces that do not yet have an explicit persisted
 * decay state.
 */
export declare const DEFAULT_TRACE_STABILITY_MS = 86400000;
/**
 * Default reinforcement interval for traces that do not yet have an explicit
 * persisted decay state.
 */
export declare const DEFAULT_TRACE_REINFORCEMENT_INTERVAL_MS = 86400000;
/**
 * Persisted decay state stored under `metadata.decay`.
 */
export interface PersistedDecayState {
    stability: number;
    accessCount: number;
    reinforcementInterval: number;
    nextReinforcementAt?: number;
}
/**
 * Parse a raw `metadata` JSON string into a plain object.
 */
export declare function parseTraceMetadata(raw: string | null | undefined): Record<string, unknown>;
/**
 * Read the persisted decay state from a metadata object, applying defaults
 * when fields are absent.
 */
export declare function readPersistedDecayState(metadata: Record<string, unknown>, retrievalCount?: number): PersistedDecayState;
/**
 * Merge a decay state payload into an existing metadata object.
 */
export declare function withPersistedDecayState(metadata: Record<string, unknown>, state: PersistedDecayState): Record<string, unknown>;
/**
 * Build initial metadata for a newly inserted memory trace.
 */
export declare function buildInitialTraceMetadata(baseMetadata?: Record<string, unknown>, options?: {
    contentHash?: string;
    entities?: string[];
    scopeId?: string;
    stability?: number;
    accessCount?: number;
    reinforcementInterval?: number;
    nextReinforcementAt?: number;
}): Record<string, unknown>;
/**
 * Compute a SHA-256 hex digest for trace content.
 */
export declare function sha256Hex(content: string): Promise<string>;
/**
 * Convert free-form natural language into a conservative FTS5 query.
 *
 * This avoids syntax errors when callers pass punctuation-heavy questions such
 * as "What are my workflow preferences?" into a raw `MATCH` clause.
 */
export declare function buildNaturalLanguageFtsQuery(query: string): string;
//# sourceMappingURL=tracePersistence.d.ts.map
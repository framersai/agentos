/**
 * CompactionLog — Transparency audit trail for context window compaction.
 *
 * Every compaction event is logged with full provenance: what was compressed,
 * the summary produced, entities preserved, content dropped, traces created.
 * The log is queryable so agents and users can trace what happened to any
 * piece of conversation history.
 */
import type { CompactionEntry, TransparencyLevel } from './types.js';
export declare class CompactionLog {
    private entries;
    private readonly maxEntries;
    private readonly level;
    constructor(maxEntries?: number, level?: TransparencyLevel);
    /** Record a compaction event. */
    append(entry: CompactionEntry): void;
    /** All entries, newest last. */
    getAll(): readonly CompactionEntry[];
    /** Get a single entry by ID. */
    getById(id: string): CompactionEntry | undefined;
    /** Find compaction entries that cover a specific turn index. */
    findByTurn(turnIndex: number): CompactionEntry[];
    /** Find entries that mention a specific entity. */
    findByEntity(entity: string): CompactionEntry[];
    /** Find entries within a time range. */
    findByTimeRange(startMs: number, endMs: number): CompactionEntry[];
    /** Search compaction summaries for a keyword. */
    search(keyword: string): CompactionEntry[];
    /** Aggregate statistics across all logged compactions. */
    getStats(): CompactionLogStats;
    /** Format a single entry for display in the agent's context or UI. */
    static formatEntry(entry: CompactionEntry): string;
    /** Format full log for display. */
    format(): string;
    /** Clear all entries. */
    clear(): void;
    get size(): number;
}
export interface CompactionLogStats {
    totalCompactions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgCompressionRatio: number;
    totalTracesCreated: number;
    totalEntitiesPreserved: number;
    avgDurationMs: number;
    oldestEntry: CompactionEntry | undefined;
    newestEntry: CompactionEntry | undefined;
}
//# sourceMappingURL=CompactionLog.d.ts.map
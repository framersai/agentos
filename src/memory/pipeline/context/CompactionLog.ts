/**
 * CompactionLog — Transparency audit trail for context window compaction.
 *
 * Every compaction event is logged with full provenance: what was compressed,
 * the summary produced, entities preserved, content dropped, traces created.
 * The log is queryable so agents and users can trace what happened to any
 * piece of conversation history.
 */

import type { CompactionEntry, TransparencyLevel } from './types.js';

export class CompactionLog {
  private entries: CompactionEntry[] = [];
  private readonly maxEntries: number;
  private readonly level: TransparencyLevel;

  constructor(maxEntries = 100, level: TransparencyLevel = 'summary') {
    this.maxEntries = maxEntries;
    this.level = level;
  }

  // ── Write ──────────────────────────────────────────────────────────

  /** Record a compaction event. */
  append(entry: CompactionEntry): void {
    if (this.level === 'silent') return;

    // In 'summary' mode strip verbose fields to save memory.
    const stored: CompactionEntry =
      this.level === 'summary'
        ? {
            ...entry,
            droppedContent: [], // omit detailed dropped fragments
            observationNotes: undefined,
          }
        : { ...entry };

    this.entries.push(stored);

    // Evict oldest if over retention limit.
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  // ── Read ───────────────────────────────────────────────────────────

  /** All entries, newest last. */
  getAll(): readonly CompactionEntry[] {
    return this.entries;
  }

  /** Get a single entry by ID. */
  getById(id: string): CompactionEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Find compaction entries that cover a specific turn index. */
  findByTurn(turnIndex: number): CompactionEntry[] {
    return this.entries.filter(
      (e) => turnIndex >= e.turnRange[0] && turnIndex <= e.turnRange[1],
    );
  }

  /** Find entries that mention a specific entity. */
  findByEntity(entity: string): CompactionEntry[] {
    const lower = entity.toLowerCase();
    return this.entries.filter((e) =>
      e.preservedEntities.some((pe) => pe.toLowerCase().includes(lower)),
    );
  }

  /** Find entries within a time range. */
  findByTimeRange(startMs: number, endMs: number): CompactionEntry[] {
    return this.entries.filter(
      (e) => e.timestamp >= startMs && e.timestamp <= endMs,
    );
  }

  /** Search compaction summaries for a keyword. */
  search(keyword: string): CompactionEntry[] {
    const lower = keyword.toLowerCase();
    return this.entries.filter((e) => e.summary.toLowerCase().includes(lower));
  }

  // ── Stats ──────────────────────────────────────────────────────────

  /** Aggregate statistics across all logged compactions. */
  getStats(): CompactionLogStats {
    if (this.entries.length === 0) {
      return {
        totalCompactions: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        avgCompressionRatio: 0,
        totalTracesCreated: 0,
        totalEntitiesPreserved: 0,
        avgDurationMs: 0,
        oldestEntry: undefined,
        newestEntry: undefined,
      };
    }

    let totalInput = 0;
    let totalOutput = 0;
    let totalTraces = 0;
    let totalDuration = 0;
    const entitySet = new Set<string>();

    for (const e of this.entries) {
      totalInput += e.inputTokens;
      totalOutput += e.outputTokens;
      totalTraces += e.tracesCreated.length;
      totalDuration += e.durationMs;
      for (const ent of e.preservedEntities) entitySet.add(ent);
    }

    return {
      totalCompactions: this.entries.length,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      avgCompressionRatio:
        totalOutput > 0 ? Math.round((totalInput / totalOutput) * 10) / 10 : 0,
      totalTracesCreated: totalTraces,
      totalEntitiesPreserved: entitySet.size,
      avgDurationMs: Math.round(totalDuration / this.entries.length),
      oldestEntry: this.entries[0],
      newestEntry: this.entries[this.entries.length - 1],
    };
  }

  // ── Formatting ─────────────────────────────────────────────────────

  /** Format a single entry for display in the agent's context or UI. */
  static formatEntry(entry: CompactionEntry): string {
    const lines: string[] = [
      `[Compaction ${entry.id}]`,
      `  Time: ${new Date(entry.timestamp).toISOString()}`,
      `  Turns: ${entry.turnRange[0]}–${entry.turnRange[1]}`,
      `  Strategy: ${entry.strategy}`,
      `  Compression: ${entry.inputTokens} → ${entry.outputTokens} tokens (${entry.compressionRatio.toFixed(1)}x)`,
      `  Duration: ${entry.durationMs}ms`,
    ];
    if (entry.preservedEntities.length > 0) {
      lines.push(`  Entities preserved: ${entry.preservedEntities.join(', ')}`);
    }
    if (entry.tracesCreated.length > 0) {
      lines.push(`  Memory traces created: ${entry.tracesCreated.length}`);
    }
    if (entry.droppedContent.length > 0) {
      lines.push(`  Dropped fragments: ${entry.droppedContent.length}`);
    }
    return lines.join('\n');
  }

  /** Format full log for display. */
  format(): string {
    if (this.entries.length === 0) return '[No compaction events recorded]';
    return this.entries.map(CompactionLog.formatEntry).join('\n\n');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Clear all entries. */
  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
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

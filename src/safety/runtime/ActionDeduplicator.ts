/**
 * @file ActionDeduplicator.ts
 * @description Hash-based tracking of recent actions within a configurable time window.
 * Prevents identical actions from being executed twice in rapid succession.
 * Caller computes the key string — this class is intentionally generic.
 */

export interface ActionDeduplicatorConfig {
  /** Time window in ms to track actions. @default 3600000 (1 hour) */
  windowMs: number;
  /** Maximum tracked entries before LRU eviction. @default 10000 */
  maxEntries: number;
}

export interface DeduplicatorEntry {
  key: string;
  firstSeenAt: number;
  count: number;
  lastSeenAt: number;
}

const DEFAULT_CONFIG: ActionDeduplicatorConfig = {
  windowMs: 3_600_000,
  maxEntries: 10_000,
};

export class ActionDeduplicator {
  private entries: Map<string, DeduplicatorEntry> = new Map();
  private config: ActionDeduplicatorConfig;

  constructor(config?: Partial<ActionDeduplicatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isDuplicate(key: string): boolean {
    this.cleanup();
    const entry = this.entries.get(key);
    if (!entry) return false;
    return (Date.now() - entry.lastSeenAt) < this.config.windowMs;
  }

  record(key: string): DeduplicatorEntry {
    this.cleanup();
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing && (now - existing.lastSeenAt) < this.config.windowMs) {
      existing.count++;
      existing.lastSeenAt = now;
      return existing;
    }

    const entry: DeduplicatorEntry = {
      key,
      firstSeenAt: now,
      count: 1,
      lastSeenAt: now,
    };

    // LRU eviction if at capacity
    if (this.entries.size >= this.config.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    this.entries.set(key, entry);
    return entry;
  }

  checkAndRecord(key: string): { isDuplicate: boolean; entry: DeduplicatorEntry } {
    const isDup = this.isDuplicate(key);
    const entry = this.record(key);
    return { isDuplicate: isDup, entry };
  }

  cleanup(): number {
    const cutoff = Date.now() - this.config.windowMs;
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.lastSeenAt < cutoff) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

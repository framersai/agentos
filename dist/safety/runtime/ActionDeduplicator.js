/**
 * @file ActionDeduplicator.ts
 * @description Hash-based tracking of recent actions within a configurable time window.
 * Prevents identical actions from being executed twice in rapid succession.
 * Caller computes the key string — this class is intentionally generic.
 */
const DEFAULT_CONFIG = {
    windowMs: 3600000,
    maxEntries: 10000,
};
export class ActionDeduplicator {
    constructor(config) {
        this.entries = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    isDuplicate(key) {
        this.cleanup();
        const entry = this.entries.get(key);
        if (!entry)
            return false;
        return (Date.now() - entry.lastSeenAt) < this.config.windowMs;
    }
    record(key) {
        this.cleanup();
        const now = Date.now();
        const existing = this.entries.get(key);
        if (existing && (now - existing.lastSeenAt) < this.config.windowMs) {
            existing.count++;
            existing.lastSeenAt = now;
            return existing;
        }
        const entry = {
            key,
            firstSeenAt: now,
            count: 1,
            lastSeenAt: now,
        };
        // LRU eviction if at capacity
        if (this.entries.size >= this.config.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined)
                this.entries.delete(oldest);
        }
        this.entries.set(key, entry);
        return entry;
    }
    checkAndRecord(key) {
        const isDup = this.isDuplicate(key);
        const entry = this.record(key);
        return { isDuplicate: isDup, entry };
    }
    cleanup() {
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
    clear() {
        this.entries.clear();
    }
    get size() {
        return this.entries.size;
    }
}
//# sourceMappingURL=ActionDeduplicator.js.map
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
export declare class ActionDeduplicator {
    private entries;
    private config;
    constructor(config?: Partial<ActionDeduplicatorConfig>);
    isDuplicate(key: string): boolean;
    record(key: string): DeduplicatorEntry;
    checkAndRecord(key: string): {
        isDuplicate: boolean;
        entry: DeduplicatorEntry;
    };
    cleanup(): number;
    clear(): void;
    get size(): number;
}
//# sourceMappingURL=ActionDeduplicator.d.ts.map